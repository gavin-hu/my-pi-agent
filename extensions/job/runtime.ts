/**
 * Job runtime: the session-scoped job table and the durable record.
 *
 * Owns the in-memory `Job` map and its transitions, and composes the smaller
 * pieces: `child.ts` (a job's process and its output), `clock.ts` (the repaint
 * clock and the reattached-job sweep), `store.ts` (the durable registry),
 * `ui.ts` (status chips), and `waiters.ts`.
 *
 * Registry model: each session is the sole writer of its own
 * `registry-<hash>.json`. `load` merges every session's file and adopts the
 * records of dead peer sessions (so a detached server reattaches and a crashed
 * session's history survives) before reconciling pids. The process seams are
 * injectable so the whole runtime can be driven by a fake child in tests.
 *
 * Concurrency: the runtime assumes the tool is `executionMode: "sequential"`,
 * but job completion is asynchronous, so `finalize` is guarded against running
 * twice and listeners/waiters are removed on cleanup.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KILL_GRACE_MS } from "../../lib/child.ts";
import { abortableSleep } from "../../lib/timer.ts";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import type { KillTreeFn, SpawnFn } from "../../lib/spawn.ts";
import { createJobChildren, type JobSeams } from "./child.ts";
import { createExternalSweep, createRepaintClock } from "./clock.ts";
import { DEFAULT_CONFIG, loadConfig, type JobsConfig } from "./config.ts";
import { compareJobs } from "./format.ts";
import {
	loadRegistries,
	mergeRecords,
	planReconcile,
	registryDirFor,
	removeLegacyRegistry,
	removeRegistry,
	settleGone,
} from "./registry.ts";
import { createOwnership, removeSessionMarker } from "./session.ts";
import {
	type Job,
	type JobRecord,
	type JobStatus,
	type KillSignal,
	type LogResult,
	type SendOptions,
	type SendResult,
	type StartOptions,
	type WaitResult,
} from "./types.ts";
import { createUiController } from "./ui.ts";
import { createJobStore, type JobStore, toRecord } from "./store.ts";
import { createWaiters, waitFor } from "./waiters.ts";

export interface RuntimeOptions {
	spawn?: SpawnFn;
	liveness?: (pid: number) => boolean;
	killTree?: KillTreeFn;
	startToken?: (pid: number) => string | undefined;
	now?: () => number;
	/** Platform seam: whether this is Windows. Defaults to the running platform. */
	isWindows?: () => boolean;
	/** Fixed config, for tests; production loads it per cwd. */
	config?: JobsConfig;
	/** How long to wait before a shutdown's SIGKILL; the grace, injectable so a test need not sleep. */
	sleep?: (ms: number) => Promise<void>;
}

export interface JobsRuntime {
	readonly config: JobsConfig;
	/** This session's id, so a caller can tell its own records from a peer's. */
	readonly sessionId: string;
	/** Effective working directory, honoring an active worktree root. */
	effectiveCwd(ctx: ExtensionContext): string;
	/** Load and reconcile the registry, then paint the UI. */
	load(ctx: ExtensionContext): Promise<void>;
	start(options: StartOptions, ctx: ExtensionContext): Promise<Job>;
	list(): JobRecord[];
	get(id: string): Job | undefined;
	logs(id: string, lines?: number): LogResult | undefined;
	/**
	 * Write to a running job's stdin. Throws a model-readable error when the job is
	 * gone, was started without `stdin: true`, or belongs to another session.
	 */
	send(id: string, options: SendOptions): SendResult;
	kill(id: string, signal?: KillSignal): Promise<Job | undefined>;
	wait(
		id: string,
		timeoutMs: number | undefined,
		signal: AbortSignal | undefined,
		onUpdate?: () => void,
	): Promise<WaitResult | undefined>;
	clear(id: string | undefined, all: boolean): { cleared: number; refused?: string };
	/** Finished, unreported jobs for this session; does not mark them. */
	pendingCompletions(): JobRecord[];
	/** Mark jobs as reported to the model. */
	markReported(ids: Iterable<string>): void;
	runningCount(): number;
	/** Publish the footer status chips. */
	setStatus(ctx: ExtensionContext): void;
	/** Kill session-owned jobs (unless detached), stop the clock, persist. */
	shutdown(): Promise<void>;
	/** Called when a `wake` job finishes; the index triggers one turn. */
	onFinish?: (job: Job) => void;
	/**
	 * Called when any job reaches a terminal state, whether it was watched to
	 * completion or observed gone on the clock. The index bridges it to the event
	 * bus; the runtime itself never reaches for a listener.
	 */
	onComplete?: (job: JobRecord) => void;
}

export function createJobsRuntime(options: RuntimeOptions = {}): JobsRuntime {
	/**
	 * The process seam, loaded when a session first loads the registry.
	 *
	 * Building the runtime is registration: it happens on every Pi start, and
	 * `lib/spawn.ts` pulls `node:child_process` with it. The load itself has to answer
	 * whether recorded pids are alive, so the seam arrives with the first `load`
	 * rather than with the factory — and a runtime whose pids are all its own never
	 * needs the platform's default at all.
	 */
	let seams: Promise<JobSeams> | undefined;
	const jobSeams = (): Promise<JobSeams> => {
		seams ??= Promise.all([import("../../lib/spawn.ts"), import("../../lib/lines.ts")]).then(([spawn, lines]) => ({
			spawn: options.spawn ?? spawn.defaultSpawn,
			liveness: options.liveness ?? spawn.isPidAlive,
			killTree: options.killTree ?? spawn.defaultKillTree,
			startToken: options.startToken ?? spawn.startTokenOf,
			newSplitter: () => new lines.LineSplitter(),
		}));
		return seams;
	};
	/** The seam once it has loaded; every path that asks about a pid has awaited it. */
	let syncSeams: JobSeams | undefined;

	/** Load the seam when it is not here yet, so a pid question can be asked. */
	const openSeam = async (): Promise<void> => {
		syncSeams ??= await jobSeams();
	};

	const now = options.now ?? (() => Date.now());
	const sleep = options.sleep ?? abortableSleep;
	const isWindows = options.isWindows ?? (() => process.platform === "win32");

	// The config is read by `load`, once the session has a cwd; until then the shipped
	// defaults answer, and a test's fixed config overrides both.
	let config: JobsConfig = options.config ?? DEFAULT_CONFIG;
	let jobStore: JobStore | undefined;
	const store = (): JobStore => {
		jobStore ??= createJobStore();
		return jobStore;
	};

	const jobs = new Map<string, Job>();
	const waiters = createWaiters();
	let sessionId = "session";
	let disposed = false;

	/** Jobs this session owns (a dead session's adopted records included). */
	const ownJobs = (): Job[] => [...jobs.values()].filter((job) => job.sessionId === sessionId);

	/** Footer status chips; owns the attached context. */
	const ui = createUiController({ getJobs: ownJobs, getConfig: () => config });

	const effectiveCwd = (ctx: ExtensionContext): string => resolveEffectiveCwd(ctx.cwd);

	const persist = (): void => store().persist(jobs.values());

	/** A fresh line splitter for one job's log, loaded with the seam that starts it. */
	const newSplitter = (): ReturnType<JobSeams["newSplitter"]> => {
		if (syncSeams === undefined) throw new Error("the job process seam is not loaded yet.");
		return syncSeams.newSplitter();
	};

	/** The process seam once it has loaded; a pid question before then answers as it always did. */
	const jobSeam = (): JobSeams | undefined => syncSeams;

	/** Recover an exit code from a job's status file, guarded by the trusted path. */
	/** A completion listener, published from the index; `undefined` after shutdown. */
	let onCompleteHandler: ((job: JobRecord) => void) | undefined;

	/** Publish a terminal transition unless the runtime is shutting down or was reloaded. */
	const announceComplete = (job: Job): void => {
		if (disposed) return;
		try {
			onCompleteHandler?.(toRecord(job));
		} catch {
			// A completion listener must not break the process bookkeeping.
		}
	};

	/** Move a record to a settled status, resolving any waiters and announcing it. */
	const settle = (job: Job, patch: { status: JobStatus; exitCode?: number | null; signal?: string | null }): void => {
		job.status = patch.status;
		job.exitCode = patch.exitCode ?? null;
		job.signal = patch.signal ?? null;
		job.finishedAt = now();
		waiters.resolve(job.id);
		announceComplete(job);
	};

	/**
	 * Settle a job whose process is observed gone, recovering its exit code.
	 *
	 * Returns `true` only when the record actually left `running`: `settleGone`
	 * keeps a record with no pid to judge unchanged, and re-announcing that on
	 * every clock tick would be a notification storm.
	 */
	const settleGoneJob = (job: Job): boolean => {
		Object.assign(
			job,
			settleGone(job, {
				isAlive: children.alive,
				tokenMatches: children.owns,
				readExitCode: children.exitCode,
				now: now(),
			}),
		);
		if (job.status === "running") return false;
		announceComplete(job);
		return true;
	};

	const pruneFinished = (): void => {
		// Only this session's records are ours to drop; a live peer manages its own.
		// Prefer dropping already-reported jobs; an unseen completion is only pruned
		// when there is nothing else left.
		const rank = (job: JobRecord): number => (job.seen ? 0 : 1);
		const finished = [...jobs.values()]
			.filter((job) => job.status !== "running" && job.sessionId === sessionId)
			.sort((a, b) => rank(a) - rank(b) || a.startedAt - b.startedAt);
		while (finished.length > config.maxJobs) {
			const job = finished.shift();
			if (!job) break;
			jobs.delete(job.id);
			children.removeArtifacts(job);
		}
	};

	const finalize = (id: string, code: number | null, signal: string | null): void => {
		const job = jobs.get(id);
		if (!children.get(id) || !job || job.status !== "running") return;
		// Commit the child's buffered output, then let its handle go.
		children.flush(job);
		children.dispose(id, { endStream: true });

		const status: JobStatus = signal ? "killed" : code === 0 ? "exited" : "failed";
		settle(job, { status, exitCode: signal ? null : code, signal });
		// The close event already carried the code, so the status file is redundant.
		children.removeStatus(job);

		pruneFinished();
		persist();
		clock.paint();
		if (!disposed && status === "failed") ui.notifyFailure(job);
		if (job.wake && !disposed) {
			try {
				onFinishHandler?.(job);
			} catch {
				// Wake is best-effort.
			}
		}
	};

	/**
	 * A job's process and its output, over `lib/child.ts`'s supervisor.
	 *
	 * The record's questions — is this pid still ours, what did it exit with, what
	 * does this log say — stay in this module; the handle, the log stream, stdin and
	 * the escalation are the child's.
	 */
	const children = createJobChildren({
		seams: jobSeam,
		store,
		config: () => config,
		now,
		newSplitter,
		table: {
			record: (id) => jobs.get(id),
			ids: () => jobs.keys(),
			insert: (job) => jobs.set(job.id, job),
			settle,
			sessionId: () => sessionId,
			changed: () => {
				persist();
				clock.paint();
			},
		},
		onSettled: (id, outcome) => {
			if (outcome.kind === "closed") finalize(id, outcome.code, outcome.signal);
			else finalize(id, 1, null);
		},
		onPaint: () => clock.paint(),
	});

	/**
	 * Who owns a job: `live`, `quiet`, or `gone`, and this session's own marker. `quiet` is
	 * not dead — the heartbeat only ticks while a job runs, so a peer that has finished its
	 * work stops writing one, and reading that as death adopted a live session's records.
	 */
	const ownership = createOwnership({
		directory: () => store().directory(),
		sessionId: () => sessionId,
		now,
		ttlMs: () => config.sessionTtlMs,
		alive: (pid) => children.alive(pid),
		startToken: (pid) => children.startToken(pid),
	});

	let onFinishHandler: ((job: Job) => void) | undefined;

	/** Fire the one wake turn for an unowned `wake` job that just finished. */
	const wakeIfNeeded = (job: Job): void => {
		if (!job.wake || disposed) return;
		try {
			onFinishHandler?.(job);
		} catch {
			// Wake is best-effort.
		}
	};

	/** Poll the jobs this session reattached, which have no `close` event to observe. */
	const pollExternal = createExternalSweep({
		records: () => jobs.values(),
		sessionId: () => sessionId,
		ownerPresent: (owner) => ownership.state(owner) !== "gone",
		alive: (pid) => children.alive(pid),
		owns: (job) => children.owns(job),
		settleGone: settleGoneJob,
		settle,
		wake: wakeIfNeeded,
		signal: (pid) => children.signal({ pid }, "SIGTERM"),
		touchMarker: () => ownership.touch(),
		changed: () => {
			pruneFinished();
			persist();
			if (!disposed) ui.paint();
		},
	});

	/**
	 * The repaint clock: the only periodic hook the runtime arms.
	 *
	 * Its tick touches this session's liveness marker, polls the jobs it
	 * reattached, and re-asserts the chip — which is otherwise only set on a job
	 * transition, so anything that clears extension statuses (a session reload,
	 * another UI path) would hide a still-running job's chip.
	 */
	const clock = createRepaintClock({
		repaintMs: () => config.repaintMs,
		running: () => [...jobs.values()].some((job) => job.status === "running"),
		disposed: () => disposed,
		touchMarker: () => ownership.touch(),
		tick: () => {
			ownership.touch();
			pollExternal();
			ui.setStatus();
		},
		repaint: () => ui.paint(),
	});

	const runtime: JobsRuntime = {
		get config() {
			return config;
		},
		get sessionId() {
			return sessionId;
		},
		effectiveCwd,
		load,
		start,
		list: () => [...jobs.values()].sort(compareJobs).map(toRecord),
		get: (id) => jobs.get(id),
		logs: (id, lines) => children.logs(id, lines),
		send: (id, options) => children.send(id, options),
		kill: (id, signal) => children.kill(id, signal),
		wait,
		clear,
		pendingCompletions,
		markReported,
		runningCount: () => ownJobs().filter((job) => job.status === "running").length,
		setStatus: (ctx) => ui.setStatus(ctx),
		shutdown,
		get onFinish() {
			return onFinishHandler;
		},
		set onFinish(handler: ((job: Job) => void) | undefined) {
			onFinishHandler = handler;
		},
		get onComplete() {
			return onCompleteHandler;
		},
		set onComplete(handler: ((job: JobRecord) => void) | undefined) {
			onCompleteHandler = handler;
		},
	};

	async function load(ctx: ExtensionContext): Promise<void> {
		// The seam comes with the first load: this is the first path that asks whether a
		// recorded pid is still alive, and the only one that needs `child_process`.
		await openSeam();
		// A reload or session replacement can reuse this runtime after `shutdown`,
		// so reset all session state before re-reading the registry.
		disposed = false;
		clock.stop();
		children.disposeAll();
		waiters.resolveAll();

		// The durable registry is keyed by the session's own cwd, not the active
		// worktree root: entering or leaving a worktree mid-session must not move it
		// out from under the records already collected here. Jobs still run in the
		// effective root (`start` uses `effectiveCwd`).
		config = options.config ?? loadConfig(ctx.cwd);
		store().setDirectory(registryDirFor(ctx.cwd, config.registryDir));
		sessionId = ctx.sessionManager.getSessionId();
		store().setSession(sessionId);
		ui.attach(ctx);

		// Announce this session, and drop markers for sessions that are gone.
		ownership.touch();
		ownership.prune();

		const { files, counter } = loadRegistries(store().directory());
		store().setCounter(counter);

		// Merge every session's records. A file whose owner is gone is adopted: its
		// records will be rewritten under this session and its file deleted.
		const merged = new Map<string, JobRecord>();
		const deadSessions = new Set<string>();
		for (const file of files) {
			if (file.sessionId !== sessionId && ownership.state(file.sessionId) === "gone") deadSessions.add(file.sessionId);
			for (const record of file.jobs) {
				const existing = merged.get(record.id);
				merged.set(record.id, existing ? mergeRecords(existing, record, sessionId) : record);
			}
		}

		// Resolve dead pids (recovering exit codes), then classify the survivors.
		const settled = [...merged.values()].map((record) =>
			settleGone(record, {
				isAlive: children.alive,
				tokenMatches: children.owns,
				readExitCode: children.exitCode,
				now: now(),
			}),
		);
		const { jobs: reconciled, orphans } = planReconcile(settled, children.alive, now(), {
			ownerState: ownership.state,
			currentSessionId: sessionId,
		});

		for (const record of orphans) {
			if (record.pid !== null) children.signal({ pid: record.pid }, "SIGTERM");
			record.status = "killed";
			record.signal = "SIGTERM";
			record.finishedAt = now();
		}

		jobs.clear();
		for (const record of reconciled) {
			const adopted = deadSessions.has(record.sessionId) ? { ...record, sessionId } : record;
			jobs.set(adopted.id, { ...adopted, owned: false });
		}

		// The adopted records now live in this session's file; drop the peers' files.
		for (const dead of deadSessions) removeRegistry(store().directory(), dead);
		removeLegacyRegistry(store().directory());
		// Ids now committed to a registry no longer need their reservation.
		store().pruneReservations(jobs.keys());

		pruneFinished();
		persist();
		clock.paint();
	}

	async function start(startOptions: StartOptions, ctx: ExtensionContext): Promise<Job> {
		if (!config.enabled) throw new Error("jobs are disabled.");
		ui.attach(ctx);
		const cwd = startOptions.cwd ? startOptions.cwd : effectiveCwd(ctx);
		// A start before `load` still needs the seam; load it rather than refusing.
		await openSeam();
		const job = children.start(startOptions, { cwd, windows: isWindows() });
		persist();
		clock.paint();
		return job;
	}

	function wait(
		id: string,
		timeoutMs: number | undefined,
		signal: AbortSignal | undefined,
		onUpdate?: () => void,
	): Promise<WaitResult | undefined> {
		const job = jobs.get(id);
		if (!job) return Promise.resolve(undefined);
		if (job.status !== "running") {
			return Promise.resolve({ job, timedOut: false, cancelled: false });
		}
		onUpdate?.();
		// The record is read again at settle time, so the answer carries the job as it
		// finished rather than as it was when the wait began.
		return waitFor(waiters, id, { timeoutMs, signal }).then((outcome) => ({
			job: jobs.get(id) ?? job,
			...outcome,
		}));
	}

	function clear(id: string | undefined, all: boolean): { cleared: number; refused?: string } {
		if (id) {
			const job = jobs.get(id);
			if (!job) return { cleared: 0, refused: `no job "${id}".` };
			if (job.status === "running") return { cleared: 0, refused: `job ${id} is still running; kill it first.` };
			if (job.sessionId !== sessionId) {
				return { cleared: 0, refused: `job ${id} belongs to another live session.` };
			}
			jobs.delete(id);
			waiters.resolve(id);
			children.removeArtifacts(job);
			persist();
			clock.paint();
			return { cleared: 1 };
		}

		let cleared = 0;
		for (const job of [...jobs.values()]) {
			// A live peer owns its file; its records are not ours to remove.
			if (job.sessionId !== sessionId) continue;
			if (job.status === "running") {
				// Without `all`, running jobs are left alone; with `all`, force-remove them.
				if (!all) continue;
				if (job.pid !== null) children.signal({ pid: job.pid }, "SIGKILL");
				// Drop the handle too: the child will not deliver a `close` we want.
				children.dispose(job.id, { endStream: true });
			}
			jobs.delete(job.id);
			waiters.resolve(job.id);
			children.removeArtifacts(job);
			cleared++;
		}
		persist();
		clock.paint();
		return { cleared };
	}

	function pendingCompletions(): JobRecord[] {
		// Only our own (or adopted) records are persisted as seen, so only those are
		// reported; a live peer reports its own completions.
		return [...jobs.values()]
			.filter((job) => !job.seen && job.finishedAt !== null && job.sessionId === sessionId)
			.map(toRecord);
	}

	function markReported(ids: Iterable<string>): void {
		let changed = false;
		for (const id of ids) {
			const job = jobs.get(id);
			if (job && !job.seen) {
				job.seen = true;
				changed = true;
			}
		}
		if (changed) persist();
	}

	async function shutdown(): Promise<void> {
		disposed = true;
		clock.stop();
		const running = [...jobs.values()].filter(
			(job) => job.status === "running" && !job.detached && job.sessionId === sessionId,
		);
		for (const job of running) await children.kill(job.id, "SIGTERM");
		if (running.length > 0) {
			// The grace is the same for every running job, handled or not: a reattached job has
			// no child to watch, so a close-driven wait would SIGKILL it on the heels of its
			// SIGTERM. The cap is the shared default, not a second literal.
			await sleep(Math.min(config.killGraceMs, KILL_GRACE_MS));
		}
		for (const job of running) {
			if (jobs.get(job.id)?.status === "running") await children.kill(job.id, "SIGKILL");
		}
		children.disposeAll();
		waiters.resolveAll();
		persist();
		removeSessionMarker(store().directory(), sessionId);
		ui.detach();
	}

	return runtime;
}
