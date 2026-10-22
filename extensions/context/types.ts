/**
 * The report's data contract.
 *
 * `ContextInputs` is what the host hands over: the effective system prompt, the
 * tool surface, the host's usage estimate, the messages that will be sent, and
 * the branch the compaction history is read from. `ContextReport` is what the
 * pure builder derives from it and what the text detail and the screen render.
 *
 * Host types that the package root does not re-export are named through the
 * extension surface (`ReturnType<…>`) rather than a deep import, so a peer
 * version change fails to typecheck instead of resolving a second copy.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The host's context-usage estimate (`ctx.getContextUsage()`). */
export type ContextUsage = NonNullable<ReturnType<ExtensionContext["getContextUsage"]>>;

/** The active branch entries (`sessionManager.getBranch()`). */
export type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

/** Merged global and project settings (`pi.getSettings()`). */
export type ContextSettings = ReturnType<ExtensionAPI["getSettings"]>;

/** Everything the pure report needs; collected once per open or refresh. */
export interface ContextInputs {
	/** The model in effect, or `null` before one is selected. */
	model: { provider: string; id: string } | null;
	/** The active model's context window, or `0` when unknown. */
	window: number;
	/** The effective system prompt for this turn (`ctx.getSystemPrompt()`). */
	systemPrompt: string;
	/** The active tool surface, with the definition estimate already computed. */
	tools: { active: number; total: number; tokens: number };
	/** The host's estimate; `tokens` is `null` between a compaction and the next reply. */
	usage: ContextUsage | undefined;
	/** The model-visible messages for the next request. */
	messages: readonly AgentMessage[];
	/** The branch the latest compaction entry and its count are read from. */
	branch: BranchEntries;
	/** Merged settings, for the compaction threshold. */
	settings: ContextSettings;
}

/** One row of the composition table. */
export interface ContextBucket {
	/** Stable id; an injected child is `injected:<customType>`. */
	id: string;
	/** Display label, already plain text. */
	label: string;
	/** Estimated tokens. */
	tokens: number;
	/** Share of the composition estimate, `0..100`. */
	share: number;
	/** `0` for a top-level bucket, `1` for an injected child. */
	depth: number;
	/** A short factual suffix: `18 active of 24`, a message count. */
	note?: string;
}

/** The latest compaction's effect. */
export interface CompactionSummary {
	/** `YYYY-MM-DD HH:MMZ` from the entry's ISO timestamp, in UTC. */
	at: string;
	/** The estimate the host recorded before compacting. */
	tokensBefore: number;
	/** The summary's own estimate. */
	summaryTokens: number;
	/** `tokensBefore - summaryTokens`, floored at zero. */
	freed: number;
}

/** What the branch remembers about compaction. */
export interface CompactionHistory {
	/** How many compaction entries the branch holds. */
	count: number;
	/** The newest one, or `null` when the branch has never been compacted. */
	last: CompactionSummary | null;
}

/** One of the largest single messages in the projected context. */
export interface LargestBlock {
	/** Estimated tokens. */
	tokens: number;
	/** What kind of message it is: `user`, `assistant`, `tool result`, … */
	role: string;
	/** Sanitized, clipped descriptor (a tool name, the first line, a custom type). */
	label: string;
}

/** The finished report. */
export interface ContextReport {
	/** The context window, `0` when unknown. */
	window: number;
	/** The host's estimate, `null` between a compaction and the next reply. */
	tokens: number | null;
	/** `tokens / window`, `null` when either is unknown. */
	percent: number | null;
	/** `window - tokens`, `null` when `tokens` is unknown. */
	free: number | null;
	/** `window - reserve - tokens`, `null` when `tokens` is unknown or automatic compaction is off. */
	headroom: number | null;
	/** The resolved `reserveTokens` for the active model. */
	reserve: number;
	/** The resolved `keepRecentTokens` for the active model. */
	keepRecentTokens: number;
	/** Whether the host's automatic compaction is on. */
	enabled: boolean;
	/** `max(0, window - reserve)`: where the host would compact. */
	autoCompactAt: number;
	/** The composition rows, ordered for display. */
	buckets: ContextBucket[];
	/** Sum of the bucket estimates. */
	estimate: number;
	/** `tokens - estimate` when the host's estimate is known, else `null`. */
	drift: number | null;
	/** True when the projection holds no assistant message: Pi's total is its message-only fallback. */
	beforeFirstReply: boolean;
	/** The branch's compaction history. */
	compaction: CompactionHistory;
	/** The largest projected messages, biggest first. */
	largest: LargestBlock[];
}
