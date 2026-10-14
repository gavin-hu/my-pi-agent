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
 * when the payload is the whole contract, which is the case here.
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
