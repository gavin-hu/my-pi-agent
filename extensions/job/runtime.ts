/**
 * Job runtime: the session-scoped job table and process lifecycle.
 *
 * Owns the in-memory `Job` map, live child handles, log streams, callbacks, and
 * the repaint clock, and composes the smaller pieces: `store.ts` (durable
 * registry), `logs.ts` (log tails), `status.ts` (exit-status recovery),
 * `ui.ts` (status chips), and `waiters.ts`.
 *
 * Registry model: each session is the sole writer of its own
 * `registry-<hash>.json`. `load` merges every session's file and adopts the
 * records of dead peer sessions (so a detached server reattaches and a crashed
 * session's history survives) before reconciling pids. The process/spawn/clock
 * functions are injectable so the whole runtime can be driven by a fake child in
 * tests.
 *
 * Concurrency: the runtime assumes the tool is `executionMode: "sequential"`,
 * but job completion is asynchronous, so `finalize` is guarded against running
 * twice and listeners/waiters are removed on cleanup.
 */

import { createWriteStream, existsSync, mkdirSync, unlinkSync, writeFileSync, type WriteStream } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { loadConfig, type JobsConfig } from "./config.ts";
import { clipLabel, formatLogs, sanitizeLogLine } from "./format.ts";
import { readLogTail } from "./logs.ts";
import {
	defaultKillTree,
	defaultLiveness,
	defaultSpawn,
	defaultStartToken,
	type KillTreeFn,
	type LivenessFn,
	type SpawnFn,
	type SpawnedProcess,
	type StartTokenFn,
} from "./process.ts";
import {
	loadRegistries,
	mergeRecords,
	planReconcile,
	registryDirFor,
	removeLegacyRegistry,
	removeRegistry,
	settleGone,
} from "./registry.ts";
import {
	isSessionAlive,
	pruneSessionMarkers,
	readSessionMarker,
	removeSessionMarker,
	touchSessionMarker,
} from "./session.ts";
import { STATUS_ENV, readExitStatus, withExitTrap } from "./status.ts";
import { toRecord, type Job, type JobRecord, type JobStatus, type KillSignal } from "./types.ts";
import { createUiController } from "./ui.ts";
import { createJobStore } from "./store.ts";
import { createWaiters } from "./waiters.ts";

/** Characters of sanitized log sent to the model. */
const LOG_MODEL_CHARS = 16 * 1024;
/** Cap on the buffered partial line used to track the latest output. */
const MAX_PENDING = 16 * 1024;
/** Default `wait` timeout. */
const DEFAULT_WAIT_MS = 30_000;

export interface StartOptions {
	command: string;
	cwd?: string;
	label?: string;
	wake?: boolean;
	detached?: boolean;
	/** Auto-kill the job after this many milliseconds (SIGTERM, escalating to SIGKILL). */
	timeoutMs?: number;
}

export interface LogResult {
	job: Job;
	/** Model-facing render of the tail, including status header/truncation note. */
	text: string;
	/** Sanitized tail lines, for the `/jobs` log pane. */
	lines: string[];
	truncated: boolean;
	/** True when earlier log lines exist beyond the returned window. */
	more: boolean;
}

export interface WaitResult {
	job: Job;
	timedOut: boolean;
	cancelled: boolean;
}

export interface RuntimeOptions {
	spawn?: SpawnFn;
	liveness?: LivenessFn;
	killTree?: KillTreeFn;
	startToken?: StartTokenFn;
	now?: () => number;
	/** Fixed config, for tests; production loads it per cwd. */
	config?: JobsConfig;
}

interface Handle {
	stream: WriteStream;
	pending: string;
	killTimer?: ReturnType<typeof setTimeout>;
	timeoutTimer?: ReturnType<typeof setTimeout>;
}

export interface JobsRuntime {
	readonly config: JobsConfig;
	/** Effective working directory, honoring an active worktree root. */
	effectiveCwd(ctx: ExtensionContext): string;
	/** Load and reconcile the registry, then paint the UI. */
	load(ctx: ExtensionContext): void;
	start(options: StartOptions, ctx: ExtensionContext): Job;
	list(): JobRecord[];
	get(id: string): Job | undefined;
	logs(id: string, lines?: number): LogResult | undefined;
	kill(id: string, signal?: KillSignal): Job | undefined;
	wait(
		id: string,
		timeoutMs: number | undefined,
		signal: AbortSignal | undefined,
		onUpdate?: () => void,
	): Promise<WaitResult | undefined>;
	clear(id: string | undefined, all: boolean): { cleared: number; refused?: string };
	/** Finished jobs not yet reported to the model; marks them seen. */
	takePending(): JobRecord[];
	runningCount(): number;
	/** Publish the footer status chips. */
	setStatus(ctx: ExtensionContext): void;
	/** Kill session-owned jobs (unless detached), stop the clock, persist. */
	shutdown(): Promise<void>;
	/** Called when a `wake` job finishes; the index triggers one turn. */
	onFinish?: (job: Job) => void;
}

export function createJobsRuntime(options: RuntimeOptions = {}): JobsRuntime {
	const spawn = options.spawn ?? defaultSpawn;
	const liveness = options.liveness ?? defaultLiveness;
	const killTree = options.killTree ?? defaultKillTree;
	const startToken = options.startToken ?? defaultStartToken;
	const now = options.now ?? (() => Date.now());

	const jobs = new Map<string, Job>();
	const handles = new Map<string, Handle>();
	const waiters = createWaiters();
	const store = createJobStore();
	let config: JobsConfig = options.config ?? loadConfig(process.cwd());
	let sessionId = "session";
	let disposed = false;
	let clock: ReturnType<typeof setInterval> | undefined;
	let lastPaint = 0;

	/** Jobs this session owns (a dead session's adopted records included). */
	const ownJobs = (): Job[] => [...jobs.values()].filter((job) => job.sessionId === sessionId);

	/** Footer status chips; owns the attached context. */
	const ui = createUiController({ getJobs: ownJobs, getConfig: () => config });

	const effectiveCwd = (ctx: ExtensionContext): string => resolveEffectiveCwd(ctx.cwd);

	const persist = (): void => store.persist(jobs.values());

	/** Delete a job's log file, best-effort. */
	const removeLog = (job: JobRecord): void => {
		try {
			const path = store.safeLogPath(job);
			if (path && existsSync(path)) unlinkSync(path);
		} catch {
			// Log cleanup is best-effort.
		}
	};

	/** Delete a job's status file once its code has been observed, best-effort. */
	const removeStatus = (job: JobRecord): void => {
		try {
			const path = store.safeStatusPath(job);
			if (path && existsSync(path)) unlinkSync(path);
		} catch {
			// Status cleanup is best-effort.
		}
	};

	/** Remove every durable artifact a job leaves behind. */
	const removeArtifacts = (job: JobRecord): void => {
		store.releaseId(job.id);
		removeStatus(job);
		removeLog(job);
	};

	/** Refresh this session's liveness marker while it runs jobs. */
	const touchMarker = (): void => {
		if (disposed) return;
		touchSessionMarker(store.directory(), sessionId, process.pid, now());
	};

	/** Whether the session that owns a job is still alive. */
	const ownerAlive = (owner: string): boolean =>
		owner === sessionId ||
		isSessionAlive(readSessionMarker(store.directory(), owner), now(), config.sessionTtlMs, liveness);

	const stopClock = (): void => {
		if (clock) {
			clearInterval(clock);
			clock = undefined;
		}
	};

	const ensureClock = (): void => {
		const running = [...jobs.values()].some((job) => job.status === "running");
		if (disposed || !running) {
			stopClock();
			return;
		}
		if (clock) return;
		clock = setInterval(() => {
			touchMarker();
			pollExternal();
			// Re-assert the chip every tick. It is otherwise only set on a job
			// transition, so anything that clears extension statuses (a session reload,
			// another UI path) would hide a still-running job's chip until the next
			// transition. The clock is the only periodic hook while jobs run.
			ui.setStatus();
		}, config.repaintMs);
		clock.unref?.();
	};

	const paint = (): void => {
		ensureClock();
		touchMarker();
		if (disposed) return;
		ui.paint();
	};

	/**
	 * Whether a persisted start-time token still matches the live pid.
	 * Returns true when either side is unavailable, so callers fall back to
	 * liveness alone; a mismatch means the pid was reused and must not be signalled.
	 */
	const tokenMatches = (job: JobRecord): boolean => {
		if (!job.startToken || job.pid === null) return true;
		const current = startToken(job.pid);
		return !current || current === job.startToken;
	};

	/** Recover an exit code from a job's status file, guarded by the trusted path. */
	const exitCodeFor = (job: JobRecord): number | undefined => readExitStatus(store.safeStatusPath(job));

	/** Move a record to a settled status, resolving any waiters. */
	const settle = (job: Job, patch: { status: JobStatus; exitCode?: number | null; signal?: string | null }): void => {
		job.status = patch.status;
		job.exitCode = patch.exitCode ?? null;
		job.signal = patch.signal ?? null;
		job.finishedAt = now();
		waiters.resolve(job.id);
	};

	/** Settle a job whose process is observed gone, recovering its exit code. */
	const settleGoneJob = (job: Job): void => {
		Object.assign(job, settleGone(job, { isAlive: liveness, tokenMatches, readExitCode: exitCodeFor, now: now() }));
	};

	/** Poll reattached (unowned) jobs, which have no `close` event to observe. */
	const pollExternal = (): void => {
		touchMarker();
		let changed = false;
		for (const job of jobs.values()) {
			if (job.status !== "running" || job.owned) continue;
			const peer = job.sessionId !== sessionId;
			const alive = peer ? ownerAlive(job.sessionId) : true;
			// A live peer session owns this job; leave its state to that owner.
			if (peer && alive) continue;
			if (job.pid === null || !liveness(job.pid)) {
				settleGoneJob(job);
				changed = true;
				continue;
			}
			// The owner is gone and the job is not detached: reap the abandoned
			// process, guarding against pid reuse with the start token.
			if (peer && !job.detached) {
				if (tokenMatches(job)) {
					try {
						killTree(job.pid, "SIGTERM");
					} catch {
						// Already gone.
					}
					settle(job, { status: "killed", signal: "SIGTERM" });
				} else {
					settle(job, { status: "unknown" });
				}
				changed = true;
			}
		}
		if (!changed) return;
		pruneFinished();
		persist();
		if (!disposed) ui.paint();
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
			removeArtifacts(job);
		}
	};

	const consume = (handle: Handle, job: Job): void => {
		const text = handle.pending;
		const lastBreak = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
		if (lastBreak === -1) return;
		handle.pending = text.slice(lastBreak + 1);
		for (const line of text.slice(0, lastBreak).split(/[\r\n]+/)) {
			const clean = sanitizeLogLine(line);
			if (clean) job.lastLine = clean;
		}
	};

	const onChunk = (id: string, chunk: Buffer): void => {
		const handle = handles.get(id);
		const job = jobs.get(id);
		if (!handle || !job) return;
		try {
			handle.stream.write(chunk);
		} catch {
			// A closed stream must not break output handling.
		}
		handle.pending += chunk.toString("utf8");
		if (handle.pending.length > MAX_PENDING) handle.pending = handle.pending.slice(-MAX_PENDING);
		consume(handle, job);
		const time = now();
		if (time - lastPaint >= config.repaintMs) {
			lastPaint = time;
			paint();
		}
	};

	const finalize = (id: string, code: number | null, signal: string | null): void => {
		const handle = handles.get(id);
		const job = jobs.get(id);
		if (!handle || !job || job.status !== "running") return;
		if (handle.killTimer) clearTimeout(handle.killTimer);
		if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
		// Commit any buffered output, including a final line without a newline.
		consume(handle, job);
		const tail = sanitizeLogLine(handle.pending);
		if (tail) job.lastLine = tail;
		try {
			handle.stream.end();
		} catch {
			// Already closed.
		}
		handles.delete(id);

		const status: JobStatus = signal ? "killed" : code === 0 ? "exited" : "failed";
		settle(job, { status, exitCode: signal ? null : code, signal });
		// The close event already carried the code, so the status file is redundant.
		removeStatus(job);

		pruneFinished();
		persist();
		paint();
		if (!disposed && status === "failed") ui.notifyFailure(job);
		if (job.wake && !disposed) {
			try {
				onFinishHandler?.(job);
			} catch {
				// Wake is best-effort.
			}
		}
	};

	let onFinishHandler: ((job: Job) => void) | undefined;

	const runtime: JobsRuntime = {
		get config() {
			return config;
		},
		effectiveCwd,
		load,
		start,
		list: () => ownJobs().map(toRecord),
		get: (id) => jobs.get(id),
		logs,
		kill,
		wait,
		clear,
		takePending,
		runningCount: () => ownJobs().filter((job) => job.status === "running").length,
		setStatus: (ctx) => ui.setStatus(ctx),
		shutdown,
		get onFinish() {
			return onFinishHandler;
		},
		set onFinish(handler: ((job: Job) => void) | undefined) {
			onFinishHandler = handler;
		},
	};

	function load(ctx: ExtensionContext): void {
		// A reload or session replacement can reuse this runtime after `shutdown`,
		// so reset all session state before re-reading the registry.
		disposed = false;
		stopClock();
		for (const handle of handles.values()) {
			if (handle.killTimer) clearTimeout(handle.killTimer);
			if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
			try {
				handle.stream.end();
			} catch {
				// Already closed.
			}
		}
		handles.clear();
		waiters.resolveAll();
		lastPaint = 0;

		config = options.config ?? loadConfig(effectiveCwd(ctx));
		store.setDirectory(registryDirFor(effectiveCwd(ctx), config.registryDir));
		sessionId = ctx.sessionManager.getSessionId();
		store.setSession(sessionId);
		ui.attach(ctx);

		// Announce this session, and drop markers for sessions that are gone.
		touchMarker();
		pruneSessionMarkers(store.directory(), now(), config.sessionTtlMs, liveness);

		const { files, counter } = loadRegistries(store.directory());
		store.setCounter(counter);

		// Merge every session's records. A file whose owner is gone is adopted: its
		// records will be rewritten under this session and its file deleted.
		const merged = new Map<string, JobRecord>();
		const deadSessions = new Set<string>();
		for (const file of files) {
			if (file.sessionId !== sessionId && !ownerAlive(file.sessionId)) deadSessions.add(file.sessionId);
			for (const record of file.jobs) {
				const existing = merged.get(record.id);
				merged.set(record.id, existing ? mergeRecords(existing, record, sessionId) : record);
			}
		}

		// Resolve dead pids (recovering exit codes), then classify the survivors.
		const settled = [...merged.values()].map((record) =>
			settleGone(record, { isAlive: liveness, tokenMatches, readExitCode: exitCodeFor, now: now() }),
		);
		const { jobs: reconciled, orphans } = planReconcile(settled, liveness, now(), {
			isOwnerAlive: ownerAlive,
			currentSessionId: sessionId,
		});

		for (const record of orphans) {
			if (record.pid !== null) {
				try {
					killTree(record.pid, "SIGTERM");
				} catch {
					// The process may already be gone.
				}
			}
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
		for (const dead of deadSessions) removeRegistry(store.directory(), dead);
		removeLegacyRegistry(store.directory());
		// Ids now committed to a registry no longer need their reservation.
		store.pruneReservations(jobs.keys());

		pruneFinished();
		persist();
		paint();
	}

	function start(startOptions: StartOptions, ctx: ExtensionContext): Job {
		if (!config.enabled) throw new Error("jobs are disabled.");
		ui.attach(ctx);
		const cwd = startOptions.cwd ? startOptions.cwd : effectiveCwd(ctx);
		// The registry directory must exist before `nextId`, which reserves the id
		// with an `O_EXCL` lock file inside it.
		mkdirSync(store.directory(), { recursive: true });
		// `store.nextId` folds in the on-disk counters and ids from every session,
		// so a peer that advanced the shared counter cannot hand us a live job's id.
		const id = store.nextId(jobs.keys());
		const logPath = store.logPath(id);
		const statusPath = process.platform === "win32" ? null : store.statusPath(id);

		// Wrap the command so a POSIX shell records its exit status; the path travels
		// in the environment so the shell never has to quote it.
		const program = withExitTrap(startOptions.command, process.platform === "win32");
		const env = statusPath ? { ...process.env, [STATUS_ENV]: statusPath } : undefined;
		let process_: SpawnedProcess;
		try {
			process_ = spawn(program, { cwd, env });
		} catch (error) {
			// A failed spawn must not leave the reserved id behind.
			store.releaseId(id);
			throw error;
		}
		const pid = process_.pid ?? null;
		// Create the file eagerly so `logs` works before the first write, then
		// append through a stream. Errors (for example after the session's registry
		// is cleaned up) must not surface as unhandled stream errors.
		try {
			writeFileSync(logPath, "", { flag: "a" });
		} catch {
			// A missing directory was already handled by mkdirSync above.
		}
		const stream = createWriteStream(logPath, { flags: "a" });
		stream.on("error", () => {});
		const job: Job = {
			id,
			label: sanitizeLogLine((startOptions.label ?? "").trim()) || clipLabel(startOptions.command),
			command: startOptions.command,
			cwd,
			pid,
			status: "running",
			exitCode: null,
			signal: null,
			startedAt: now(),
			finishedAt: null,
			logPath,
			statusPath,
			detached: startOptions.detached ?? config.detachedByDefault,
			wake: startOptions.wake ?? config.wakeOnFinish,
			sessionId,
			seen: false,
			lastLine: "",
			startToken: pid !== null ? (startToken(pid) ?? null) : null,
			owned: true,
		};

		const handle: Handle = { stream, pending: "" };
		handles.set(id, handle);
		jobs.set(id, job);

		if (startOptions.timeoutMs !== undefined) {
			handle.timeoutTimer = setTimeout(() => {
				if (jobs.get(id)?.status === "running") kill(id, "SIGTERM");
			}, startOptions.timeoutMs);
			handle.timeoutTimer.unref?.();
		}

		process_.stdout?.on("data", (chunk: Buffer) => onChunk(id, chunk));
		process_.stderr?.on("data", (chunk: Buffer) => onChunk(id, chunk));
		process_.on("close", (code, signal) => finalize(id, code, signal));
		process_.on("error", () => finalize(id, 1, null));

		persist();
		paint();
		return job;
	}

	function logs(id: string, lines = config.maxLogLines): LogResult | undefined {
		const job = jobs.get(id);
		if (!job) return undefined;
		const tail = readLogTail(store.safeLogPath(job), lines);
		const formatted = formatLogs(job, tail.lines, LOG_MODEL_CHARS);
		return {
			job,
			text: formatted.text,
			lines: tail.lines,
			truncated: formatted.truncated || tail.truncated,
			more: tail.more,
		};
	}

	function kill(id: string, signal: KillSignal = "SIGTERM"): Job | undefined {
		const job = jobs.get(id);
		if (!job) return undefined;
		if (job.status !== "running") return job;
		const pid = job.pid;
		if (pid === null) {
			settle(job, { status: "unknown" });
			persist();
			paint();
			return job;
		}

		// A reattached pid may have been reused; if the start token disagrees, stop
		// rather than signal an unrelated process.
		if (!tokenMatches(job)) {
			settle(job, { status: "unknown" });
			persist();
			paint();
			return job;
		}

		// Adopt a peer's job so the outcome persists in our file; the peer's stale
		// file is dropped on a later load.
		job.sessionId = sessionId;

		try {
			killTree(pid, signal, signal === "SIGKILL");
		} catch {
			// Best-effort; liveness below decides the final state.
		}

		const handle = handles.get(id);
		if (handle) {
			if (signal !== "SIGKILL") {
				if (handle.killTimer) clearTimeout(handle.killTimer);
				handle.killTimer = setTimeout(() => {
					if (jobs.get(id)?.status === "running") {
						try {
							killTree(pid, "SIGKILL", true);
						} catch {
							// Already gone.
						}
					}
				}, config.killGraceMs);
				handle.killTimer.unref?.();
			}
		} else {
			// Reattached/external Job: no `close` event will arrive, so reconcile
			// after the grace period instead of waiting forever.
			setTimeout(() => {
				const current = jobs.get(id);
				if (current?.status !== "running") return;
				if (!liveness(pid)) {
					settle(current, { status: "killed", signal });
				} else {
					try {
						killTree(pid, "SIGKILL", true);
					} catch {
						// Best-effort.
					}
					settle(current, { status: "killed", signal: "SIGKILL" });
				}
				persist();
				paint();
			}, config.killGraceMs).unref?.();
		}
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

		return new Promise<WaitResult>((resolve) => {
			let settled = false;
			let remove = (): void => {};
			const finish = (timedOut: boolean, cancelled: boolean): void => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				remove();
				resolve({ job: jobs.get(id) ?? job, timedOut, cancelled });
			};
			const resolveWaiter = (): void => finish(false, false);
			const onAbort = (): void => finish(false, true);
			const timer =
				timeoutMs === undefined
					? setTimeout(() => finish(true, false), DEFAULT_WAIT_MS)
					: setTimeout(() => finish(true, false), timeoutMs);

			remove = waiters.add(id, resolveWaiter);
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		});
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
			removeArtifacts(job);
			persist();
			paint();
			return { cleared: 1 };
		}

		let cleared = 0;
		for (const job of [...jobs.values()]) {
			// A live peer owns its file; its records are not ours to remove.
			if (job.sessionId !== sessionId) continue;
			if (job.status === "running") {
				// Without `all`, running jobs are left alone; with `all`, force-remove them.
				if (!all) continue;
				if (job.pid !== null) {
					try {
						killTree(job.pid, "SIGKILL", true);
					} catch {
						// Best-effort.
					}
				}
				// Drop the handle too: the child will not deliver a `close` we want.
				const handle = handles.get(job.id);
				if (handle) {
					if (handle.killTimer) clearTimeout(handle.killTimer);
					if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
					try {
						handle.stream.end();
					} catch {
						// Already closed.
					}
					handles.delete(job.id);
				}
			}
			jobs.delete(job.id);
			waiters.resolve(job.id);
			removeArtifacts(job);
			cleared++;
		}
		persist();
		paint();
		return { cleared };
	}

	function takePending(): JobRecord[] {
		// Only our own (or adopted) records are persisted as seen, so only those are
		// reported; a live peer reports its own completions.
		const pending = [...jobs.values()].filter(
			(job) => !job.seen && job.finishedAt !== null && job.sessionId === sessionId,
		);
		for (const job of pending) job.seen = true;
		if (pending.length > 0) persist();
		return pending.map(toRecord);
	}

	async function shutdown(): Promise<void> {
		disposed = true;
		stopClock();
		const running = [...jobs.values()].filter(
			(job) => job.status === "running" && !job.detached && job.sessionId === sessionId,
		);
		for (const job of running) kill(job.id, "SIGTERM");
		if (running.length > 0) {
			await new Promise((resolve) => setTimeout(resolve, Math.min(config.killGraceMs, 2000)));
		}
		for (const job of running) {
			if (jobs.get(job.id)?.status === "running") kill(job.id, "SIGKILL");
		}
		for (const handle of handles.values()) {
			if (handle.killTimer) clearTimeout(handle.killTimer);
			if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
			try {
				handle.stream.end();
			} catch {
				// Already closed.
			}
		}
		handles.clear();
		waiters.resolveAll();
		persist();
		removeSessionMarker(store.directory(), sessionId);
		ui.detach();
	}

	return runtime;
}
