/**
 * Shared types for the jobs extension.
 *
 * A job is one background shell command owned by a session. Its durable form
 * (`JobRecord`) is what the on-disk registry stores; the in-memory `Job` adds
 * `owned`, which is true only while this process holds a live child handle.
 */

export const JOB_STATUSES = ["running", "exited", "killed", "failed", "unknown"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ACTIONS = ["start", "list", "status", "logs", "kill", "wait", "clear"] as const;

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
	/** Leave running when the session ends, so a later session can reattach. */
	detached: boolean;
	/** Wake the agent with one triggered turn when the job finishes. */
	wake: boolean;
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

/** Strip runtime-only fields for persistence. */
export function toRecord(job: Job): JobRecord {
	const { owned: _owned, ...record } = job;
	return record;
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
	/** True when `wait` hit its timeout. */
	timedOut?: boolean;
	/** True when `wait` was cancelled by the tool's abort signal. */
	cancelled?: boolean;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
