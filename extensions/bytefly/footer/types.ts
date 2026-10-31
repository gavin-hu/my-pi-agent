/**
 * The footer's data model.
 *
 * The bar is built in three stages: a `StatusSnapshot` gathers the data, the
 * snapshot becomes `LineSpec`s of `Segment`s, and the layout engine renders
 * each line for the available width. Price-configuration types live in
 * `./price/types.ts`.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Currency } from "./price/types.ts";

/** One usage-bearing session entry, reduced to what pricing needs. */
export interface UsageRecord {
	provider: string | null;
	model: string | null;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Pi's recorded cost for this record, in USD. */
	recordedCost: number;
	/** Epoch milliseconds, or `null` when the entry carries no usable timestamp. */
	at: number | null;
	/** Only an assistant call sets a cache hit rate. */
	isAssistant: boolean;
}

/** Cumulative token/cost totals across the session branch. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Cost in the configured currency: rated in CNY mode, Pi's recorded amount in USD mode. */
	cost: number;
}

/**
 * One model this session could not price, as the key that would price it.
 *
 * The key is the `price.rates` vocabulary — `provider/model`, with `*` standing in
 * for a side the record does not name — so it is copy-pasteable into the config.
 */
export interface UnpricedModel {
	key: string;
	/** How many records in this session carried it. */
	records: number;
}

/**
 * The totals plus the records the mode had no rate for.
 *
 * CNY has no fallback, so those records contribute no cost at all. USD falls back
 * to Pi's recorded amount — except when that amount is `0`, which is what Pi
 * records for a model its own catalog cannot price, and then nothing has priced
 * the record either. Both cases want the same fix, so they are one list: the
 * models, and the key that would price each. `unpriced` is summed from it, so the
 * count and the names cannot disagree.
 */
export interface PricedUsage extends UsageTotals {
	unpriced: number;
	unpricedModels: UnpricedModel[];
}

/** Context-window usage for the active model. */
export interface ContextInfo {
	/** Estimated tokens, or `null` when unknown (for example right after compaction). */
	tokens: number | null;
	contextWindow: number;
	/** Usage as a percentage of the window, or `null` when unknown. */
	percent: number | null;
}

/** The active model, reduced to what the bar shows. */
export interface ModelInfo {
	id: string;
	provider: string;
	reasoning: boolean;
}

/** Everything the bar needs, gathered once per render. */
export interface StatusSnapshot {
	cwd: string;
	/** Session name set by the user, `null` when unnamed. */
	sessionName: string | null;
	/**
	 * The name peers address this session by, when the bus has recorded one.
	 *
	 * `null` means no record — bytefly runs without the bus and the bar keeps Pi's own
	 * session name, which is all a session that never joined has.
	 */
	rosterLabel: string | null;
	/** Branch name, `null` when not in a repository, `"detached"` on detached HEAD. */
	branch: string | null;
	/** Extension status texts (from `ctx.ui.setStatus`), including `worktree`. */
	statuses: ReadonlyMap<string, string>;
	model: ModelInfo | null;
	thinkingLevel: ThinkingLevel | null;
	context: ContextInfo;
	/** The session's totals, with the records nothing could price riding along. */
	usage: PricedUsage;
	/** How `usage.cost` is rendered. */
	currency: Currency;
	/**
	 * The session's configured spend ceiling in `currency`; `0` means no ceiling.
	 *
	 * The bar pairs it with the cost (`$0.31/$5`) so the allowance is a fact on the
	 * screen, not something the one budget notice alone carries.
	 */
	budget: number;
	/** Latest cache hit rate as a percentage, or `null` when unknown. */
	cacheHitRate: number | null;
	providerCount: number;
	/**
	 * What this session's delegated child runs spent, priced like `usage` but kept
	 * apart from it: the session total never includes child spend.
	 */
	delegation: DelegationTotals;
}

/** Child-run totals: how many runs finished, and what the retained window spent. */
export interface DelegationTotals {
	runs: number;
	usage: UsageTotals;
}

/** One renderable piece of a line. */
export interface Segment {
	id: string;
	/** Higher numbers shrink and drop first. `1` is kept longest. */
	weight: number;
	/** Detailed to minimal forms; the last form is the floor. */
	forms: string[];
	/** Whether the segment may disappear once its last form is reached. */
	droppable: boolean;
	/** Styled separator printed before this segment when it is not first. */
	separator: string;
}

/** A footer line split into a left and an optional right zone. */
export interface LineSpec {
	left: Segment[];
	right: Segment[];
}

/** The subset of `ReadonlyFooterDataProvider` the bar consumes. */
export interface FooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

/** The subset of `TUI` the bar consumes. */
export interface TuiLike {
	requestRender(): void;
}
