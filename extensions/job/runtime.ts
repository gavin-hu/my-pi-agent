/**
 * Job runtime: the session-scoped job table and process lifecycle.
 *
 * Owns the in-memory `Job` map, live child handles, callbacks, and the repaint
 * clock, and composes the smaller pieces: `store.ts` (durable registry),
 * `logs.ts` (log tails), `log-writer.ts` (the per-job stream, line split, and
 * rotation), `status.ts` (exit-status recovery), `ui.ts` (status chips), and
 * `waiters.ts`.
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

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import {
	defaultKillTree,
	defaultSpawn,
	isPidAlive,
	type KillTreeFn,
	type SpawnedProcess,
	type SpawnFn,
	type StdinSink,
} from "../../lib/spawn.ts";
import { loadConfig, type JobsConfig } from "./config.ts";
import { createLogWriter, type LogHandle } from "./log-writer.ts";
import { sanitizeUntrustedLine } from "../../lib/format.ts";
import { defaultInterval } from "../../lib/timer.ts";
import { clipLabel } from "../../lib/tui/columns.ts";
import { compareJobs, formatLogs } from "./format.ts";
import { readLogTail } from "./logs.ts";
import { defaultStartToken, type LivenessFn, type StartTokenFn } from "./process.ts";
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
import { LOG_ENV, STATUS_ENV, readExitStatus, withExitTrap } from "./status.ts";
import { type Job, type JobRecord, type JobStatus, type KillSignal } from "./types.ts";
import { createUiController } from "./ui.ts";
import { createJobStore, toRecord } from "./store.ts";
import { createWaiters } from "./waiters.ts";

/** Characters of sanitized log sent to the model. */
const LOG_MODEL_CHARS = 16 * 1024;
/** Default `wait` timeout. */
const DEFAULT_WAIT_MS = 30_000;

export interface StartOptions {
	command: string;
	cwd?: string;
	label?: string;
	wake?: boolean;
	detached?: boolean;
	/** Give the child a stdin pipe, so `send` can write to it while it runs here. */
	stdin?: boolean;
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

export interface SendOptions {
	/** Text written to the job's stdin. */
	input?: string;
	/** Append a newline to `input`; defaults to true. */
	newline?: boolean;
	/** End the job's stdin after writing, so the child sees EOF. */
	eof?: boolean;
}

export interface SendResult {
	job: Job;
	/** Characters of `input` written, excluding any newline this call added. */
	sent: number;
	/** True when this call ended the job's stdin. */
	closed: boolean;
}

export interface RuntimeOptions {
	spawn?: SpawnFn;
	liveness?: LivenessFn;
	killTree?: KillTreeFn;
	startToken?: StartTokenFn;
	now?: () => number;
	/** Platform seam: whether this is Windows. Defaults to the running platform. */
	isWindows?: () => boolean;
	/** Fixed config, for tests; production loads it per cwd. */
	config?: JobsConfig;
}

interface Handle {
	/** The job's log: stream, line split, rotation, and the repaint window. */
	log: LogHandle;
	killTimer?: ReturnType<typeof setTimeout>;
	timeoutTimer?: ReturnType<typeof setTimeout>;
	/** The child's stdin pipe, present only for a job started with `stdin: true`. */
	stdin?: StdinSink | null;
	/** True once stdin was ended, or the child closed its end. */
	stdinClosed?: boolean;
}

export interface JobsRuntime {
	readonly config: JobsConfig;
	/** This session's id, so a caller can tell its own records from a peer's. */
	readonly sessionId: string;
	/** Effective working directory, honoring an active worktree root. */
	effectiveCwd(ctx: ExtensionContext): string;
	/** Load and reconcile the registry, then paint the UI. */
	load(ctx: ExtensionContext): void;
	start(options: StartOptions, ctx: ExtensionContext): Job;
	list(): JobRecord[];
	get(id: string): Job | undefined;
	logs(id: string, lines?: number): LogResult | undefined;
	/**
	 * Write to a running job's stdin. Throws a model-readable error when the job is
	 * gone, was started without `stdin: true`, or belongs to another session.
	 */
	send(id: string, options: SendOptions): SendResult;
	kill(id: string, signal?: KillSignal): Job | undefined;
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
	const spawn = options.spawn ?? defaultSpawn;
	const liveness = options.liveness ?? isPidAlive;
	const killTree = options.killTree ?? defaultKillTree;
	const startToken = options.startToken ?? defaultStartToken;
	const now = options.now ?? (() => Date.now());
	const isWindows = options.isWindows ?? (() => process.platform === "win32");

	const jobs = new Map<string, Job>();
	const handles = new Map<string, Handle>();
	const waiters = createWaiters();
	const store = createJobStore();
	let config: JobsConfig = options.config ?? loadConfig(process.cwd());
	let sessionId = "session";
	let disposed = false;
	let clock: (() => void) | undefined;

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
			// Both segments are the job's own log; drop the rotated one too.
			const rotated = store.safeRotatedLogPath(job);
			if (rotated && existsSync(rotated)) unlinkSync(rotated);
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
		clock?.();
		clock = undefined;
	};

	const ensureClock = (): void => {
		const running = [...jobs.values()].some((job) => job.status === "running");
		if (disposed || !running) {
			stopClock();
			return;
		}
		if (clock) return;
		clock = defaultInterval(config.repaintMs, () => {
			touchMarker();
			pollExternal();
			// Re-assert the chip every tick. It is otherwise only set on a job
			// transition, so anything that clears extension statuses (a session reload,
			// another UI path) would hide a still-running job's chip until the next
			// transition. The clock is the only periodic hook while jobs run.
			ui.setStatus();
		});
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
		Object.assign(job, settleGone(job, { isAlive: liveness, tokenMatches, readExitCode: exitCodeFor, now: now() }));
		if (job.status === "running") return false;
		announceComplete(job);
		return true;
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
				// A record with no pid cannot be judged gone; leave it alone rather than
				// announcing (and waking) on every tick.
				if (!settleGoneJob(job)) continue;
				// A reattached `wake` job has no `close` event, so this is the only place
				// its completion can trigger the one wake turn.
				wakeIfNeeded(job);
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

	/** Remember the newest non-empty output line, which `status`/`wait` report. */
	const recordLine = (job: Job, line: string): void => {
		const clean = sanitizeUntrustedLine(line);
		if (clean) job.lastLine = clean;
	};

	/** The per-job log sink: stream, line split, rotation, and the repaint window. */
	const logWriter = createLogWriter({
		now,
		logPath: (job) => store.safeLogPath(job),
		rotatedPath: (job) => store.safeRotatedLogPath(job),
		maxBytes: () => config.maxLogBytes,
		repaintMs: () => config.repaintMs,
		onLine: recordLine,
		onPaint: paint,
	});

	/** Clear a handle's timers, close its log stream, and drop it. */
	const disposeHandle = (id: string, options: { endStream: boolean }): void => {
		const handle = handles.get(id);
		if (!handle) return;
		if (handle.killTimer) clearTimeout(handle.killTimer);
		if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
		logWriter.dispose(handle.log, options);
		// Release the stdin pipe so a child waiting on input sees EOF instead of a
		// half-open pipe nobody can write to.
		if (handle.stdin && !handle.stdinClosed) {
			try {
				handle.stdin.end();
			} catch {
				// Already closed.
			}
		}
		handle.stdin = null;
		handle.stdinClosed = true;
		handles.delete(id);
	};

	const onChunk = (id: string, chunk: Buffer): void => {
		const handle = handles.get(id);
		const job = jobs.get(id);
		if (!handle || !job) return;
		logWriter.write(handle.log, job, chunk);
	};

	const finalize = (id: string, code: number | null, signal: string | null): void => {
		const handle = handles.get(id);
		const job = jobs.get(id);
		if (!handle || !job || job.status !== "running") return;
		// Commit any buffered output, including a final line without a newline.
		for (const line of logWriter.flush(handle.log)) recordLine(job, line);
		// A detached job keeps no parent stream; read its last line from the log.
		if (!handle.log.stream) {
			const last = readLogTail(store.safeLogPath(job), 1).lines.at(-1);
			if (last) job.lastLine = last;
		}
		disposeHandle(id, { endStream: true });

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

	/** Fire the one wake turn for an unowned `wake` job that just finished. */
	const wakeIfNeeded = (job: Job): void => {
		if (!job.wake || disposed) return;
		try {
			onFinishHandler?.(job);
		} catch {
			// Wake is best-effort.
		}
	};

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
		logs,
		send,
		kill,
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

	function load(ctx: ExtensionContext): void {
		// A reload or session replacement can reuse this runtime after `shutdown`,
		// so reset all session state before re-reading the registry.
		disposed = false;
		stopClock();
		for (const id of [...handles.keys()]) disposeHandle(id, { endStream: true });
		waiters.resolveAll();

		// The durable registry is keyed by the session's own cwd, not the active
		// worktree root: entering or leaving a worktree mid-session must not move it
		// out from under the records already collected here. Jobs still run in the
		// effective root (`start` uses `effectiveCwd`).
		config = options.config ?? loadConfig(ctx.cwd);
		store.setDirectory(registryDirFor(ctx.cwd, config.registryDir));
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
		const wantsStdin = startOptions.stdin === true;
		// Windows has no process group to leave and no shell `EXIT` trap to record an
		// exit code, so a job there cannot outlive the session: refusing an explicit
		// detach is the honest answer, and it happens before any id is reserved.
		// `detachedByDefault` stays inert instead of failing every start with a config
		// the user set on another machine; `doctor` names that.
		const windows = isWindows();
		if (windows && startOptions.detached === true) {
			throw new Error(
				"A detached job cannot outlive the session on Windows: there is no process group to leave " +
					"and no shell EXIT trap to record its exit code. Start it with `detached: false`, " +
					"run it under WSL, or move the work into a `subagent`.",
			);
		}
		const detached = windows ? false : (startOptions.detached ?? config.detachedByDefault);
		// A detached job outlives this process, so a stdin pipe owned by this session
		// would hand it EOF the moment the session ends; refuse instead of silently
		// dropping the pipe (or the detach).
		if (wantsStdin && detached) {
			throw new Error("a detached job cannot take stdin; start it with `detached: false`.");
		}
		const cwd = startOptions.cwd ? startOptions.cwd : effectiveCwd(ctx);
		// The registry directory must exist before `nextId`, which reserves the id
		// with an `O_EXCL` lock file inside it.
		mkdirSync(store.directory(), { recursive: true });
		// `store.nextId` folds in the on-disk counters and ids from every session,
		// so a peer that advanced the shared counter cannot hand us a live job's id.
		const id = store.nextId(jobs.keys());
		const logPath = store.logPath(id);
		// Only a POSIX shell has an `EXIT` trap to record a status, and only a detached
		// job points its own output at the log so it keeps logging after this process
		// ends (which on Windows is never: `detached` is false there).
		const statusPath = windows ? null : store.statusPath(id);
		const detachOutput = detached;

		// Wrap the command so a POSIX shell records its exit status; the path travels
		// in the environment so the shell never has to quote it.
		const program = withExitTrap(startOptions.command, windows, detachOutput);
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (statusPath) env[STATUS_ENV] = statusPath;
		if (detachOutput) env[LOG_ENV] = logPath;
		let process_: SpawnedProcess;
		try {
			process_ = spawn(program, { cwd, env, detachOutput, stdin: wantsStdin });
		} catch (error) {
			// A failed spawn must not leave the reserved id behind.
			store.releaseId(id);
			throw error;
		}
		const pid = process_.pid ?? null;
		if (detachOutput) process_.unref?.();
		// Create the file eagerly so `logs` works before the first write, then
		// append through a stream. A detached job's shell writes the file directly.
		try {
			writeFileSync(logPath, "", { flag: "a" });
		} catch {
			// A missing directory was already handled by mkdirSync above.
		}
		const job: Job = {
			id,
			label: sanitizeUntrustedLine((startOptions.label ?? "").trim()) || clipLabel(startOptions.command),
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
			detached,
			wake: startOptions.wake ?? config.wakeOnFinish,
			stdin: wantsStdin,
			sessionId,
			seen: false,
			lastLine: "",
			startToken: pid !== null ? (startToken(pid) ?? null) : null,
			owned: true,
		};

		const handle: Handle = {
			log: logWriter.create(detachOutput ? undefined : logPath),
		};
		if (wantsStdin) {
			const sink = process_.stdin ?? null;
			handle.stdin = sink;
			handle.stdinClosed = sink === null;
			// A child that exits can emit `error`/`close` on the pipe; record it so a
			// later `send` reports the truth instead of throwing an unhandled stream error.
			const markClosed = (): void => {
				const current = handles.get(id);
				if (current) current.stdinClosed = true;
			};
			sink?.on("error", markClosed);
			sink?.on("close", markClosed);
		}
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
		const current = readLogTail(store.safeLogPath(job), lines);
		let all = current.lines;
		let more = current.more;
		let truncated = current.truncated;
		// Keep `logs` continuous across a rotation: fill the request from the
		// previous segment when the live one holds fewer lines.
		if (all.length < lines) {
			const previous = readLogTail(store.safeRotatedLogPath(job), lines - all.length);
			if (previous.lines.length > 0) {
				all = [...previous.lines, ...all];
				more = more || previous.more;
				truncated = truncated || previous.truncated;
			}
		}
		const last = all.at(-1);
		if (last) job.lastLine = last;
		const formatted = formatLogs(job, all, LOG_MODEL_CHARS);
		// A rotation that outran its drain drops the oldest queued chunks; say so once
		// rather than letting the gap look like a program that skipped output.
		const dropped = handles.get(id)?.log.droppedBytes ?? 0;
		const text = dropped > 0 ? `${formatted.text}\n… ${dropped} bytes dropped while the log rotated.` : formatted.text;
		return {
			job,
			text,
			lines: all,
			truncated: formatted.truncated || truncated,
			more,
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

	function send(id: string, options: SendOptions): SendResult {
		const job = jobs.get(id);
		if (!job) throw new Error(`no job "${id}".`);
		if (job.status !== "running") throw new Error(`job ${id} is ${job.status}; stdin is closed.`);
		if (!job.stdin) throw new Error(`job ${id} was not started with stdin; restart it with \`stdin: true\`.`);
		const handle = handles.get(id);
		// A pipe this session opened but that is closed is a different fact from one
		// that was never ours, so state it first.
		if (handle?.stdinClosed) throw new Error(`job ${id} closed its stdin.`);
		if (!handle?.stdin) throw new Error(`job ${id}'s stdin belongs to the session that started it.`);

		const input = options.input ?? "";
		const payload = input && options.newline !== false ? `${input}\n` : input;
		try {
			if (payload) handle.stdin.write(payload);
			if (options.eof) {
				handle.stdin.end();
				handle.stdinClosed = true;
			}
		} catch {
			// The child closed its end; record it so the next `send` says so.
			handle.stdinClosed = true;
			handle.stdin = null;
			throw new Error(`job ${id} closed its stdin.`);
		}
		return { job, sent: input.length, closed: options.eof === true };
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
			const timer = setTimeout(() => finish(true, false), timeoutMs ?? DEFAULT_WAIT_MS);

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
				disposeHandle(job.id, { endStream: true });
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
		for (const id of [...handles.keys()]) disposeHandle(id, { endStream: true });
		waiters.resolveAll();
		persist();
		removeSessionMarker(store.directory(), sessionId);
		ui.detach();
	}

	return runtime;
}
