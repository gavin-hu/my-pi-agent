/**
 * Shared types for the status-bar extension.
 *
 * The bar is built in three stages: a `StatusSnapshot` gathers the data, the
 * snapshot becomes `LineSpec`s of `Segment`s, and the layout engine renders
 * each line for the available width.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** How a cost is rendered. */
export interface Currency {
	/** Printed before the number, e.g. `$` or `¥`. */
	symbol: string;
	/** Digits after the decimal point. */
	decimals: number;
}

/** Per-million-token rates for one model, expressed in the configured currency. */
export interface ModelRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Multiplier applied outside every peak window; `1` means no discount. */
	offPeakMultiplier: number;
}

/** One peak window in local time, as minutes since midnight. */
export interface PeakWindow {
	/** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
	days: readonly number[];
	/** Inclusive start, in minutes since local midnight. */
	from: number;
	/** Exclusive end; a value `<= from` wraps past midnight. */
	to: number;
}

/** When a provider charges its peak rate. */
export interface PeakSchedule {
	/** IANA zone the windows are stated in. */
	timezone: string;
	/** No windows means every moment is peak, so a rate is flat. */
	windows: readonly PeakWindow[];
}

/** Everything the price calculation is configured with. */
export interface StatusBarConfig {
	currency: Currency;
	/** Fall back to Pi's recorded cost for a record that no rate matches. */
	fallbackToRecordedCost: boolean;
	/** Rates keyed by `provider/model`, matched through wildcards. */
	rates: Readonly<Record<string, ModelRates>>;
	peak: PeakSchedule;
}

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
	cost: number;
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
	/** Branch name, `null` when not in a repository, `"detached"` on detached HEAD. */
	branch: string | null;
	/** Extension status texts (from `ctx.ui.setStatus`), including `worktree`. */
	statuses: ReadonlyMap<string, string>;
	model: ModelInfo | null;
	thinkingLevel: ThinkingLevel | null;
	context: ContextInfo;
	usage: UsageTotals;
	/** How `usage.cost` is rendered. */
	currency: Currency;
	/** Latest cache hit rate as a percentage, or `null` when unknown. */
	cacheHitRate: number | null;
	providerCount: number;
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
