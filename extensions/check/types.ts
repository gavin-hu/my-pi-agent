/**
 * Shared types for the check extension.
 *
 * The extension is deliberately language-neutral: a command is a shell string,
 * a failure is a location plus a message, and nothing here names an ecosystem.
 * Detection and parsing are the only places that know about manifests or test
 * runner output.
 */

/** The targets `/check` and `run_check` accept. */
export type CheckTarget = "test" | "lint" | "typecheck" | "all";

/** A command the detector or the config selected. */
export interface CommandSpec {
	/** Shell command, run in the project root. */
	command: string;
	/** The same text for display and model-facing results. */
	label: string;
}

/** The commands detected for one project, keyed by target. */
export type DetectedCommands = Partial<Record<Exclude<CheckTarget, "all">, CommandSpec>> & {
	all?: CommandSpec;
};

/** One parsed failure, independent of the runner that produced it. */
export interface Failure {
	/** Repository-relative or absolute path, when the runner printed one. */
	path?: string;
	line?: number;
	column?: number;
	/** Test name, when the runner prints a name without a location. */
	test?: string;
	/** The human-readable reason, already collapsed to one line. */
	message: string;
	/** The command that produced this failure. */
	command: string;
}

/** The terminal state of a check run. */
export type CheckStatus = "passed" | "failed" | "timeout" | "cancelled" | "error";

/** What one command did. */
export interface CommandRun {
	command: string;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	cancelled: boolean;
	output: string;
	truncated: boolean;
	durationMs: number;
	error?: string;
}

/** The aggregate result of one `/check` or `run_check` call. */
export interface CheckResult {
	target: CheckTarget;
	status: CheckStatus;
	commands: string[];
	/** Last non-null exit code, or null for timeout/cancel/spawn failure. */
	exitCode: number | null;
	durationMs: number;
	truncated: boolean;
	failures: Failure[];
	/** Sanitized tail of the bounded output, for a detail view or fallback. */
	tail: string;
	error?: string;
}

/** The model-facing details and structuredContent mirror. */
export interface RunCheckDetails {
	target: CheckTarget;
	status: CheckStatus;
	commands: string[];
	exitCode: number | null;
	durationMs: number;
	truncated: boolean;
	failures: Failure[];
	/** Extra detail for the transcript renderer; not in structuredContent. */
	tail?: string;
}

/** A run that can be observed while it is still active. */
export interface ActiveCheck {
	target: CheckTarget;
	commands: string[];
	/** Sanitized lines for the live screen, oldest first. */
	lines(): readonly string[];
	/** Milliseconds since the run started. */
	elapsedMs(): number;
	/** Resolves once the run settles; never rejects. */
	promise: Promise<CheckResult>;
	/** Kill the active process tree and settle as cancelled. */
	cancel(): void;
}
