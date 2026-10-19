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

/** EventBus channel: a `watch` wake match fired while the agent was idle. */
export const WATCH_MATCH_CHANNEL = "my-pi-agent/watch-match";

/**
 * Payload on {@link WATCH_MATCH_CHANNEL}: what a wake match saw.
 *
 * Emitted by `watch` and consumed by bytefly's notify capability, so the two can
 * agree on an alert without `watch` learning about delivery methods. The line is
 * **raw** — the matched text is arbitrary file or process output — and the
 * consumer sanitizes it before it reaches a notification, exactly as it does for a
 * job label. `count` covers the whole wake cycle, so one notification can say how
 * many lines matched while the body describes the newest one.
 */
export interface WatchMatchEvent {
	/** How many matches were pending when the wake fired. */
	count: number;
	/** The watcher that matched, e.g. `w3`. */
	watcherId: string;
	/** Its label, e.g. `build`. */
	label: string;
	/** The newest matched line, unsanitized. */
	line: string;
}

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

/** EventBus channel: `web-access` resolved its search provider for this session. */
export const WEB_SEARCH_PROVIDER_CHANNEL = "my-pi-agent/web-search-provider";

/**
 * Payload on {@link WEB_SEARCH_PROVIDER_CHANNEL}: what `web_search` will use.
 *
 * `web-access` owns the provider registry, each provider's `isConfigured`, and the
 * `auto` resolution rule, so it is the only place those facts can come from: this
 * event is how `doctor` learns them without importing an extension. The key
 * itself is never published — only the variable name and whether a literal key is
 * configured — so a diagnostic can never leak a secret into a log or a notice.
 */
export interface WebSearchProviderEvent {
	/** Resolved backend id, e.g. `searxng`. */
	provider: string;
	/** Why this provider won: an explicit choice, one that is configured, or the keyless default. */
	reason: "explicit" | "configured" | "default";
	/** Whether the resolved provider's configuration is enough to call it. */
	configured: boolean;
	/** URL a refresh may probe, when the provider has a configurable endpoint. */
	endpoint: string | null;
	/** Environment variable a key would come from, when the provider takes one. */
	apiKeyEnv: string | null;
	/** Whether a literal key is configured, so a missing variable is not the whole story. */
	keyConfigured: boolean;
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
