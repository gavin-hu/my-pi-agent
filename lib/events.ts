/**
 * Inter-extension `pi.events` channels and their payloads.
 *
 * Pi loads each extension with an isolated module cache and forbids importing
 * another extension's modules, so a channel name and the shape of what travels
 * on it are one contract: the emitting extension and the listening extension
 * must agree on both. Keep the literal and the payload interface here, never
 * re-typed on either side — a rename has to break the build, not a notification
 * at runtime.
 *
 * The bus carries no state. `rails.ts` and `worktree` publish their own channels
 * from the modules that own them; a channel crosses an extension boundary only
 * when the payload is the whole contract, which is the case here: `job` publishes
 * a finished job for bytefly's notify capability, and `subagent` publishes a
 * finished child run for bytefly's footer roll-up.
 */

/** EventBus channel: a background job reached a terminal state. */
export const JOB_FINISHED_CHANNEL = "my-pi-agent/job-finished";

/**
 * The terminal statuses a finished job can report.
 *
 * Mirrors the non-`running` members of `extensions/job/types.ts` `JobStatus`;
 * `lib/` cannot import from an extension, so the subset is restated. A `running`
 * job never appears on this channel.
 */
export type FinishedJobStatus = "exited" | "failed" | "killed" | "unknown";

/** EventBus channel: one subagent run finished (a child `pi` process exited). */
export const SUBAGENT_FINISHED_CHANNEL = "my-pi-agent/subagent-finished";

/**
 * Payload on {@link SUBAGENT_FINISHED_CHANNEL}: what one finished child run spent.
 *
 * It carries the *pricing inputs* rather than a total, because the consumer prices
 * them with the same rate table and currency as the session's own cost, and a
 * currency change must re-price them rather than leave a figure in the old unit.
 * `recordedCost` is Pi's own dollar figure for the child's assistant calls.
 *
 * A run that produced no assistant message (an unknown agent, a spawn failure)
 * publishes nothing: there is no spend to account for.
 */
export interface SubagentFinishedEvent {
	/** Agent that ran, e.g. `explorer`. */
	agent: string;
	/** Provider and model the child reported, when it reported one. */
	provider: string | null;
	model: string | null;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Pi's recorded cost for the child's calls, in USD. */
	recordedCost: number;
	/** Epoch ms when the run finished, or `null` when unknown. */
	at: number | null;
	/** Child process exit code; a model-level failure still exits 0. */
	exitCode: number;
}

/** Payload on {@link JOB_FINISHED_CHANNEL}: one job that just stopped. */
export interface JobFinishedEvent {
	/** Job id, e.g. `j3`. */
	id: string;
	/** Sanitized one-line display label. */
	label: string;
	/** How it stopped: clean exit, non-zero exit, signal, or unobservable. */
	status: FinishedJobStatus;
	/** Exit code for `exited`/`failed`, else `null`. */
	exitCode: number | null;
	/** Signal name for `killed`, else `null`. */
	signal: string | null;
}
