/**
 * Shared types for the jobs extension.
 *
 * A job is one background shell command owned by a session. Its durable form
 * (`JobRecord`) is what the on-disk registry stores; the in-memory `Job` adds
 * `owned`, which is true only while this process holds a live child handle.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KillTreeFn, SpawnFn } from "../../lib/spawn.ts";
import type { JobsConfig } from "./config.ts";

export const JOB_STATUSES = ["running", "exited", "killed", "failed", "unknown"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ACTIONS = ["start", "list", "status", "logs", "send", "kill", "wait", "clear"] as const;

export type JobAction = (typeof JOB_ACTIONS)[number];

export const KILL_SIGNALS = ["SIGTERM", "SIGKILL", "SIGINT"] as const;

export type KillSignal = (typeof KILL_SIGNALS)[number];

/** Durable state for one job, as persisted in this session's `registry-<hash>.json`. */
export interface JobRecord {
	id: string;
	/** Sanitized one-line display label; defaults to a preview of `command`. */
	label: string;
	/** The command exactly as given, for display and re-running. */
	command: string;
	cwd: string;
	pid: number | null;
	status: JobStatus;
	/** Exit code for `exited`/`failed`; null otherwise. */
	exitCode: number | null;
	/** Signal name for `killed`; null otherwise. */
	signal: string | null;
	startedAt: number;
	finishedAt: number | null;
	/** Absolute path of the append-only log file. */
	logPath: string;
	/** Bytes this job's log dropped, so `logs` can say so once the live handle is gone. */
	droppedBytes: number;
	/** Leave running when the session ends, so a later session can reattach. */
	detached: boolean;
	/** Wake the agent with one triggered turn when the job finishes. */
	wake: boolean;
	/** Started with a stdin pipe, so `send` can write to it while this session holds the child. */
	stdin: boolean;
	/** Session that started the job. */
	sessionId: string;
	/** Whether the completion has already been reported to the model. */
	seen: boolean;
	/** Cached, sanitized most recent output line (never the whole log). */
	lastLine: string;
	/** Absolute path of the file the job writes its exit code to (POSIX only). */
	statusPath: string | null;
	/** Best-effort OS start-time token, used to detect pid reuse before signaling. */
	startToken: string | null;
}

/** In-memory job: the durable record plus whether we hold its child handle. */
export interface Job extends JobRecord {
	owned: boolean;
}

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

/** A `wait` the cap shortened: the block it asked for and the one it got. */
export interface WaitCap {
	askedMs: number;
	usedMs: number;
}

export interface WaitResult {
	job: Job;
	timedOut: boolean;
	cancelled: boolean;
	/** Present when the timeout won after the block was capped. */
	capped?: WaitCap;
}

/** A job's log as `logs` returns it: the model-facing render plus the raw tail. */
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

/** Registry file contents. One file exists per session. */
export interface RegistryFile {
	version: 1;
	/** Session that owns (and is the sole writer of) this file. */
	sessionId: string;
	/** Next free numeric id suffix. */
	counter: number;
	jobs: JobRecord[];
}

/** Structured result carried in the tool's `details`. */
export interface JobDetails {
	action: JobAction;
	/** Jobs relevant to the call; `list` returns all, others usually one. */
	jobs?: JobRecord[];
	job?: JobRecord;
	/** Sanitized tail of the log, for `logs`. */
	logs?: string;
	/** Whether `logs` was truncated to a tail. */
	truncated?: boolean;
	/** Number of jobs removed by `clear`. */
	cleared?: number;
	/** True when `kill` sent a signal but the process had not yet closed. */
	signalled?: boolean;
	/** Signal sent by `kill`; defaults to SIGTERM. */
	signal?: KillSignal;
	/** Characters of `input` written by `send`, excluding the added newline. */
	sent?: number;
	/** True when `send` ended the job's stdin (EOF). */
	stdinClosed?: boolean;
	/** True when `wait` hit its timeout. */
	timedOut?: boolean;
	/** True when `wait` was cancelled by the tool's abort signal. */
	cancelled?: boolean;
	/** What a capped `wait` asked for and what it used, when the timeout won. */
	capped?: WaitCap;
	/** Session that made the call, so a transcript can mark another session's rows. */
	sessionId?: string;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}

/** One session's job runtime, as the entry and its tools see it. */
export interface RuntimeOptions {
	/**
	 * The host, for the one call that needs git: which repository's `repos/<id>` this store files
	 * under. Absent is a runtime with no repository to ask about, and its directory is computed from
	 * the path alone — the same layout, under `repos/local-<pathKey>/jobs`.
	 */
	pi?: Pick<ExtensionAPI, "exec">;
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
	/** Load and reconcile the registry, then paint the UI; `ready` is the same work as a handle. */
	load(ctx: ExtensionContext): Promise<void>;
	ready(): Promise<void>;
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
	onFinish?: (job: JobRecord) => void;
	/**
	 * Called when any job reaches a terminal state, however it settled. The index bridges
	 * it to the event bus; the runtime itself never reaches for a listener.
	 */
	onComplete?: (job: JobRecord) => void;
}
