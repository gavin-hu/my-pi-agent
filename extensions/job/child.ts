/**
 * A job's process and its output: the spawn policy, the handle, the log, stdin,
 * the signal and its escalation, and the pid questions a durable record asks.
 *
 * The process side is `lib/child.ts`'s supervisor, which `watch` drives too, so
 * the spawn, the merge of both output streams, the escalation timer, and the
 * drain have one owner. What stays here is everything a *job* adds to that: the
 * `EXIT`-trap program and its status file, a log the runtime can tail, a stdin
 * pipe a later `send` writes to, and the start-time token that tells a reused pid
 * from the one this record named.
 *
 * The table is the runtime's: this module asks for a record by id, hands back the
 * one it started, and asks the runtime to settle one — it never holds the table.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createChildSupervisor, type ChildOutcome, type ChildSlot, type ChildSupervisor } from "../../lib/child.ts";
import { sanitizeUntrustedLine } from "../../lib/format.ts";
import type { LineSplitter } from "../../lib/lines.ts";
import type { KillTreeFn, SpawnFn, StartTokenFn, StdinSink } from "../../lib/spawn.ts";
import { clipLabel } from "../../lib/tui/columns.ts";
import type { JobsConfig } from "./config.ts";
import { formatLogs } from "./format.ts";
import { createLogWriter, type LogHandle, type LogWriter } from "./log-writer.ts";
import { readLogTail } from "./logs.ts";
import { LOG_ENV, STATUS_ENV, readExitStatus, withExitTrap } from "./status.ts";
import type { JobStore } from "./store.ts";
import type {
	Job,
	JobRecord,
	JobStatus,
	KillSignal,
	LogResult,
	SendOptions,
	SendResult,
	StartOptions,
} from "./types.ts";

/** Characters of a job's log a model-facing tail may carry. */
const LOG_MODEL_CHARS = 16 * 1024;

/**
 * The process seam a started job uses: the spawn, the three questions about a pid,
 * and the log splitter. It arrives with `load`, because asking whether a recorded
 * pid is alive is the first thing a session does.
 */
export interface JobSeams {
	spawn: SpawnFn;
	liveness: (pid: number) => boolean;
	killTree: KillTreeFn;
	startToken: StartTokenFn;
	newSplitter: () => LineSplitter;
}

/**
 * A live job's process fields.
 *
 * The supervisor mutates `pid`/`child`/`killTimer` in place, so the handle and
 * the module cannot disagree about whether the child is still live.
 */
export interface Handle extends ChildSlot {
	/** The job's log: stream, line split, rotation, and the repaint window. */
	log: LogHandle;
	/** Escalates the job when it outlives its `timeoutMs`. */
	timeoutTimer?: ReturnType<typeof setTimeout>;
	/** The child's stdin pipe, present only for a job started with `stdin: true`. */
	stdin?: StdinSink | null;
	/** True once stdin was ended, or the child closed its end. */
	stdinClosed?: boolean;
}

/** What a job's process asks of the runtime's table, and never answers itself. */
export interface JobTable {
	/** One record from the table, by id. */
	record(id: string): Job | undefined;
	/** Every id the table holds, so a new one cannot collide with a record not yet pruned. */
	ids(): Iterable<string>;
	/** Put a record this module just started into the table. */
	insert(job: Job): void;
	/** Move a record to a settled status: waiters, listeners, and the event bus. */
	settle(job: Job, patch: { status: JobStatus; exitCode?: number | null; signal?: string | null }): void;
	/** This session's id, recorded as the owner of every job it starts or adopts. */
	sessionId(): string;
	/** Persist the table and repaint, after a record changed. */
	changed(): void;
}

export interface JobChildrenDeps {
	/**
	 * The process seam, once it has loaded: `lib/spawn.ts`'s spawn, tree-kill, liveness and
	 * start token. Undefined before `load`, where a pid question answers as it always did.
	 */
	seams: () => JobSeams | undefined;
	/** The durable store, for a job's log, its rotated segment, and the id it is filed under. */
	store: () => JobStore;
	/** The live config, read per call so a reload lands. */
	config: () => JobsConfig;
	now: () => number;
	/** A fresh line splitter, which arrives with the process seam. */
	newSplitter: () => LineSplitter;
	table: JobTable;
	/** The child closed or failed to spawn; the runtime settles the record. */
	onSettled: (id: string, outcome: ChildOutcome) => void;
	/** Repaint, at most once per repaint window while output arrives. */
	onPaint: () => void;
}

export interface JobChildren {
	/** Spawn a job's process, record its handle, and answer the record to insert. */
	start(options: StartOptions, placement: { cwd: string; windows: boolean }): Job;
	/** SIGTERM a job and escalate to SIGKILL after the grace, or reconcile a reattached one. */
	kill(id: string, signal?: KillSignal): Promise<Job | undefined>;
	/** Whether a pid is still running, asked through the loaded seam. */
	alive(pid: number): boolean;
	/**
	 * Whether a persisted start-time token still matches the live pid.
	 * True when either side is unavailable, so a caller falls back to liveness alone.
	 */
	owns(job: JobRecord): boolean;
	/** A pid's start time, when the platform can say; undefined before the seam loads. */
	startToken(pid: number): string | undefined;
	get(id: string): Handle | undefined;
	/** Clear a handle's timers, close its log stream, and drop it. */
	dispose(id: string, options: { endStream: boolean }): void;
	/** Dispose every handle, for a session that is starting over. */
	disposeAll(): void;
	/** Signal a job's process, or a bare pid no handle holds (a reattached job). */
	signal(slot: ChildSlot, signal: NodeJS.Signals): void;
	/** Write to a running job's stdin, or throw the model-readable refusal. */
	send(id: string, options: SendOptions): SendResult;
	/** A job's log across both segments, formatted for the model. */
	logs(id: string, lines?: number): LogResult | undefined;
	/** Commit a settled job's buffered output and record its last line. */
	flush(job: Job): void;
	/** Recover an exit code from a job's status file, guarded by the trusted path. */
	exitCode(job: JobRecord): number | undefined;
	/** Delete a job's status file once its code has been observed, best-effort. */
	removeStatus(job: JobRecord): void;
	/** Delete a job's log file and any rotated segment, best-effort. */
	removeLog(job: JobRecord): void;
	/** Remove every durable artifact a job leaves behind, its id reservation included. */
	removeArtifacts(job: JobRecord): void;
}

export function createJobChildren(deps: JobChildrenDeps): JobChildren {
	const handles = new Map<string, Handle>();

	/** The seam a spawn or a signal needs; a caller that reaches here has awaited `load`. */
	const requireSeams = (): JobSeams => {
		const seams = deps.seams();
		if (seams === undefined) throw new Error("the job process seam is not loaded yet.");
		return seams;
	};

	/** One supervisor per grace, so a reloaded config re-arms the escalation at its own speed. */
	let supervisor: ChildSupervisor | undefined;
	let supervisorGrace: number | undefined;
	const supervisorFor = (): ChildSupervisor => {
		const grace = deps.config().killGraceMs;
		if (supervisor === undefined || supervisorGrace !== grace) {
			const { spawn, killTree } = requireSeams();
			supervisor = createChildSupervisor({ spawn, killTree, graceMs: grace });
			supervisorGrace = grace;
		}
		return supervisor;
	};

	/** A pid question before `load` answers `true`, which is what the runtime always said. */
	const alive = (pid: number): boolean => deps.seams()?.liveness(pid) ?? true;

	/** A mismatch means the pid was reused by another program, so it must not be signalled. */
	const owns = (job: JobRecord): boolean => {
		if (!job.startToken || job.pid === null) return true;
		const current = deps.seams()?.startToken(job.pid);
		return !current || current === job.startToken;
	};

	/** A pid's start time, for the ownership rule's own marker. */
	const startToken = (pid: number): string | undefined => deps.seams()?.startToken(pid);

	/** Remember the newest non-empty output line, which `status`/`wait` report. */
	const recordLine = (job: Job, line: string): void => {
		const clean = sanitizeUntrustedLine(line);
		if (clean) job.lastLine = clean;
	};

	/**
	 * The per-job log sink: stream, line split, rotation, and the repaint window.
	 *
	 * Built on first use, because the line splitter arrives with the process seam: a
	 * session that never starts a job never writes one.
	 */
	let sink: LogWriter | undefined;
	const logWriter = (): LogWriter => {
		sink ??= createLogWriter({
			now: deps.now,
			newSplitter: deps.newSplitter,
			logPath: (job) => deps.store().safeLogPath(job),
			rotatedPath: (job) => deps.store().safeRotatedLogPath(job),
			maxBytes: () => deps.config().maxLogBytes,
			repaintMs: () => deps.config().repaintMs,
			onLine: recordLine,
			onPaint: deps.onPaint,
		});
		return sink;
	};

	const writeChunk = (id: string, chunk: Buffer): void => {
		const handle = handles.get(id);
		const job = deps.table.record(id);
		if (!handle || !job) return;
		logWriter().write(handle.log, job, chunk);
	};

	const start = (options: StartOptions, placement: { cwd: string; windows: boolean }): Job => {
		const { windows } = placement;
		const config = deps.config();
		const wantsStdin = options.stdin === true;
		// Windows has no process group to leave and no shell `EXIT` trap to record an
		// exit code, so a job there cannot outlive the session: refusing an explicit
		// detach is the honest answer, and it happens before any id is reserved.
		// `detachedByDefault` stays inert instead of failing every start with a config
		// the user set on another machine; `doctor` names that.
		if (windows && options.detached === true) {
			throw new Error(
				"A detached job cannot outlive the session on Windows: there is no process group to leave " +
					"and no shell EXIT trap to record its exit code. Start it with `detached: false`, " +
					"run it under WSL, or move the work into a `subagent`.",
			);
		}
		const detached = windows ? false : (options.detached ?? config.detachedByDefault);
		// A detached job outlives this process, so a stdin pipe owned by this session
		// would hand it EOF the moment the session ends; refuse instead of silently
		// dropping the pipe (or the detach).
		if (wantsStdin && detached) {
			throw new Error("a detached job cannot take stdin; start it with `detached: false`.");
		}
		const store = deps.store();
		// The registry directory must exist before `nextId`, which reserves the id
		// with an `O_EXCL` lock file inside it.
		mkdirSync(store.directory(), { recursive: true });
		// `nextId` folds in the on-disk counters and ids from every session, so a peer
		// that advanced the shared counter cannot hand us a live job's id — and the table's
		// ids cover a record this session started and has not pruned yet.
		const id = store.nextId(deps.table.ids());
		const logPath = store.logPath(id);
		// Only a POSIX shell has an `EXIT` trap to record a status, and only a detached
		// job points its own output at the log so it keeps logging after this process
		// ends (which on Windows is never: `detached` is false there).
		const statusPath = windows ? null : store.statusPath(id);

		// Wrap the command so a POSIX shell records its exit status; the path travels
		// in the environment so the shell never has to quote it.
		const program = withExitTrap(options.command, windows, detached);
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (statusPath) env[STATUS_ENV] = statusPath;
		if (detached) env[LOG_ENV] = logPath;
		const handle: Handle = { log: logWriter().create(detached ? undefined : logPath) };
		let error: string | undefined;
		try {
			error = supervisorFor().start(
				handle,
				program,
				{ cwd: placement.cwd, env, detachOutput: detached, stdin: wantsStdin },
				{
					onData: (chunk) => writeChunk(id, chunk),
					onSettled: (outcome) => deps.onSettled(id, outcome),
				},
			);
		} catch (thrown) {
			logWriter().dispose(handle.log, { endStream: true });
			throw thrown;
		}
		if (error !== undefined) {
			// A failed spawn must not leave the reserved id or a log stream behind.
			logWriter().dispose(handle.log, { endStream: true });
			store.releaseId(id);
			throw new Error(error);
		}
		handles.set(id, handle);
		if (detached) handle.child?.unref?.();
		// Create the file eagerly so `logs` works before the first write, then append
		// through the stream. A detached job's shell writes the file directly.
		try {
			writeFileSync(logPath, "", { flag: "a" });
		} catch {
			// An unwritable log leaves `logs` empty; the job still runs.
		}
		if (wantsStdin) {
			const pipe = handle.child?.stdin ?? null;
			handle.stdin = pipe;
			handle.stdinClosed = pipe === null;
			// A child that exits can emit `error`/`close` on the pipe; record it so a
			// later `send` reports the truth instead of throwing an unhandled stream error.
			const markClosed = (): void => {
				const current = handles.get(id);
				if (current) current.stdinClosed = true;
			};
			pipe?.on("error", markClosed);
			pipe?.on("close", markClosed);
		}
		const pid = handle.pid ?? null;
		const job: Job = {
			id,
			label: sanitizeUntrustedLine((options.label ?? "").trim()) || clipLabel(options.command),
			command: options.command,
			cwd: placement.cwd,
			pid,
			status: "running",
			exitCode: null,
			signal: null,
			startedAt: deps.now(),
			finishedAt: null,
			logPath,
			statusPath,
			detached,
			wake: options.wake ?? config.wakeOnFinish,
			stdin: wantsStdin,
			sessionId: deps.table.sessionId(),
			seen: false,
			lastLine: "",
			startToken: pid !== null ? (requireSeams().startToken(pid) ?? null) : null,
			owned: true,
		};
		deps.table.insert(job);

		if (options.timeoutMs !== undefined) {
			handle.timeoutTimer = setTimeout(() => {
				if (deps.table.record(id)?.status === "running") void kill(id, "SIGTERM");
			}, options.timeoutMs);
			handle.timeoutTimer.unref?.();
		}
		return job;
	};

	const kill = async (id: string, signal: KillSignal = "SIGTERM"): Promise<Job | undefined> => {
		const job = deps.table.record(id);
		if (!job) return undefined;
		if (job.status !== "running") return job;
		const pid = job.pid;
		if (pid === null) {
			deps.table.settle(job, { status: "unknown" });
			deps.table.changed();
			return job;
		}
		// A reattached pid may have been reused; if the start token disagrees, stop
		// rather than signal an unrelated process.
		if (!owns(job)) {
			deps.table.settle(job, { status: "unknown" });
			deps.table.changed();
			return job;
		}
		// Adopt a peer's job so the outcome persists in our file; the peer's stale
		// file is dropped on a later load.
		job.sessionId = deps.table.sessionId();

		const handle = handles.get(id);
		if (handle) {
			// The supervisor owns the escalation: the signal the caller asked for now (SIGINT
			// included), then SIGKILL at the configured grace unless the child closes first —
			// and no escalation behind a SIGKILL, which is already final.
			supervisorFor().terminate(handle, signal);
			return job;
		}

		// Reattached/external Job: no handle, so no `close` event will arrive either. Signal the
		// pid and reconcile after the grace whatever the signal was — SIGKILL is final for a
		// child we hold, not for one whose ending nothing reports.
		supervisorFor().kill({ pid }, signal);
		setTimeout(() => {
			const current = deps.table.record(id);
			if (current?.status !== "running") return;
			if (!alive(pid)) {
				deps.table.settle(current, { status: "killed", signal });
			} else {
				supervisorFor().kill({ pid }, "SIGKILL");
				deps.table.settle(current, { status: "killed", signal: "SIGKILL" });
			}
			deps.table.changed();
		}, deps.config().killGraceMs).unref?.();
		return job;
	};

	const dispose = (id: string, options: { endStream: boolean }): void => {
		const handle = handles.get(id);
		if (!handle) return;
		if (handle.killTimer) clearTimeout(handle.killTimer);
		if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
		logWriter().dispose(handle.log, options);
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

	/** Commit any buffered output, including a final line without a newline. */
	const flush = (job: Job): void => {
		const handle = handles.get(job.id);
		if (!handle) return;
		for (const line of logWriter().flush(handle.log)) recordLine(job, line);
		// A detached job keeps no parent stream; read its last line from the log.
		if (!handle.log.stream) {
			const last = readLogTail(deps.store().safeLogPath(job), 1).lines.at(-1);
			if (last) job.lastLine = last;
		}
	};

	const logs = (id: string, lines?: number): LogResult | undefined => {
		const job = deps.table.record(id);
		if (!job) return undefined;
		const count = lines ?? deps.config().maxLogLines;
		const current = readLogTail(deps.store().safeLogPath(job), count);
		let all = current.lines;
		let more = current.more;
		let truncated = current.truncated;
		// Keep `logs` continuous across a rotation: fill the request from the
		// previous segment when the live one holds fewer lines.
		if (all.length < count) {
			const previous = readLogTail(deps.store().safeRotatedLogPath(job), count - all.length);
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
	};

	const send = (id: string, options: SendOptions): SendResult => {
		const job = deps.table.record(id);
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
	};

	const exitCode = (job: JobRecord): number | undefined => readExitStatus(deps.store().safeStatusPath(job));

	const removeStatus = (job: JobRecord): void => {
		try {
			const path = deps.store().safeStatusPath(job);
			if (path && existsSync(path)) unlinkSync(path);
		} catch {
			// Status cleanup is best-effort.
		}
	};

	const removeLog = (job: JobRecord): void => {
		try {
			const path = deps.store().safeLogPath(job);
			if (path && existsSync(path)) unlinkSync(path);
			// Both segments are the job's own log; drop the rotated one too.
			const rotated = deps.store().safeRotatedLogPath(job);
			if (rotated && existsSync(rotated)) unlinkSync(rotated);
		} catch {
			// Log cleanup is best-effort.
		}
	};

	const removeArtifacts = (job: JobRecord): void => {
		deps.store().releaseId(job.id);
		removeStatus(job);
		removeLog(job);
	};

	return {
		start,
		kill,
		alive,
		startToken,
		owns,
		get: (id) => handles.get(id),
		dispose,
		disposeAll: () => {
			for (const id of [...handles.keys()]) dispose(id, { endStream: true });
		},
		signal: (slot, signal) => supervisorFor().kill(slot, signal),
		send,
		logs,
		flush,
		exitCode,
		removeStatus,
		removeLog,
		removeArtifacts,
	};
}
