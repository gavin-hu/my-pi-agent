/**
 * The pure half of the report: turn collected inputs into the numbers a reader
 * sees, with no host access and no theme.
 *
 * Two rules keep the report honest. First, the headline is the host's number
 * (`ctx.getContextUsage()`), and the composition is this module's estimate, so
 * the difference is reported as `drift` instead of being hidden by forcing the
 * parts to add up. Second, the compaction threshold is resolved the way the host
 * resolves it — per-model override, then the shared setting, then Pi's default —
 * because the point of the report is to predict when Pi will compact.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_COMPACTION_SETTINGS, estimateTokens, getLatestCompactionEntry } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import type {
	CompactionHistory,
	CompactionSummary,
	ContextBucket,
	ContextInputs,
	ContextReport,
	ContextSettings,
	LargestBlock,
} from "./types.ts";

/** The host's chars/4 heuristic, for text that is not a `message` (system prompt, schemas). */
export function estimateText(text: string): number {
	return estimateChars(text.length);
}

/** {@link estimateText} when only a character count is known, without building the string. */
export function estimateChars(chars: number): number {
	return Math.ceil(chars / 4);
}

/** The compaction numbers in effect for one model. */
export interface ResolvedCompaction {
	enabled: boolean;
	reserve: number;
	keepRecentTokens: number;
}

/** A token setting as the host reads it: a finite, non-negative whole number. */
function tokenSetting(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
	return Math.floor(value);
}

/**
 * Resolve the compaction settings for `model` exactly as Pi does:
 * `compaction.modelOverrides["provider/id"]`, then `compaction`, then the default.
 */
export function resolveCompactionSettings(
	settings: ContextSettings,
	model: { provider: string; id: string } | null,
): ResolvedCompaction {
	const compaction = settings.compaction;
	const override = model ? compaction?.modelOverrides?.[`${model.provider}/${model.id}`] : undefined;
	return {
		enabled: compaction?.enabled ?? DEFAULT_COMPACTION_SETTINGS.enabled,
		reserve: tokenSetting(
			override?.reserveTokens,
			tokenSetting(compaction?.reserveTokens, DEFAULT_COMPACTION_SETTINGS.reserveTokens),
		),
		keepRecentTokens: tokenSetting(
			override?.keepRecentTokens,
			tokenSetting(compaction?.keepRecentTokens, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens),
		),
	};
}

/** A message's role; custom roles are matched by name, never by a host type. */
function roleOf(message: AgentMessage): string {
	const role = (message as { role?: unknown }).role;
	return typeof role === "string" ? role : "";
}

/** The `customType` an injected message carries; the pack tags every injection. */
function customTypeOf(message: AgentMessage): string {
	const customType = (message as { customType?: unknown }).customType;
	return typeof customType === "string" && customType.trim() ? sanitizeLine(customType) : "injected";
}

/** The text a message's content starts with, for a descriptor. */
function firstText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		if ((block as { type?: unknown }).type !== "text") continue;
		const text = (block as { text?: unknown }).text;
		if (typeof text === "string" && text.trim()) return text;
	}
	return "";
}

/** A one-line, bounded descriptor for the "largest messages" list. */
function boundedLabel(text: string, maxLength = 40): string {
	const line = sanitizeLine(text);
	return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

/** What kind of message a block is, in the report's vocabulary. */
const ROLE_LABELS: Readonly<Record<string, string>> = {
	toolResult: "tool result",
	assistant: "assistant",
	user: "user",
	custom: "injected",
	bashExecution: "shell",
	branchSummary: "summary",
	compactionSummary: "summary",
	system: "system",
};

function roleLabel(message: AgentMessage): string {
	return ROLE_LABELS[roleOf(message)] ?? "message";
}

/** The descriptor under a block's role: a tool name, a first line, a custom type. */
function descriptorOf(message: AgentMessage): string {
	switch (roleOf(message)) {
		case "toolResult": {
			const name = (message as { toolName?: unknown }).toolName;
			return typeof name === "string" && name ? sanitizeLine(name) : "result";
		}
		case "custom":
			return customTypeOf(message);
		case "bashExecution": {
			const command = (message as { command?: unknown }).command;
			return boundedLabel(typeof command === "string" ? command : "command");
		}
		case "branchSummary":
		case "compactionSummary": {
			const summary = (message as { summary?: unknown }).summary;
			return boundedLabel(typeof summary === "string" ? summary : "summary");
		}
		default: {
			const text = firstText((message as { content?: unknown }).content);
			return text ? boundedLabel(text) : roleLabel(message);
		}
	}
}

/** `YYYY-MM-DD HH:MMZ` from an entry's ISO timestamp, without locale formatting. */
export function compactTimestamp(timestamp: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(timestamp);
	return match ? `${match[1]} ${match[2]}Z` : boundedLabel(timestamp, 24);
}

/** The branch's compaction history, newest last in the entry list. */
function compactionHistory(inputs: ContextInputs): CompactionHistory {
	const count = inputs.branch.filter((entry) => entry.type === "compaction").length;
	const latest = getLatestCompactionEntry(inputs.branch);
	if (!latest) return { count, last: null };
	const summaryTokens = estimateText(latest.summary);
	const last: CompactionSummary = {
		at: compactTimestamp(latest.timestamp),
		tokensBefore: latest.tokensBefore,
		summaryTokens,
		freed: Math.max(0, latest.tokensBefore - summaryTokens),
	};
	return { count, last };
}

/** A top-level row before shares and nesting are applied. */
interface BucketDraft {
	id: string;
	label: string;
	tokens: number;
	note?: string;
}

/** Round a share so the text and the screen cannot disagree about precision. */
function shareOf(tokens: number, total: number): number {
	if (total <= 0) return 0;
	return Math.round((tokens / total) * 1000) / 10;
}

/** Build the report from collected inputs. Pure: the same inputs give the same numbers. */
export function buildReport(inputs: ContextInputs): ContextReport {
	const resolved = resolveCompactionSettings(inputs.settings, inputs.model);
	const window = inputs.window > 0 ? inputs.window : (inputs.usage?.contextWindow ?? 0);
	const tokens = inputs.usage?.tokens ?? null;
	const percent = inputs.usage?.percent ?? (tokens !== null && window > 0 ? (tokens / window) * 100 : null);
	const free = tokens !== null && window > 0 ? window - tokens : null;
	const autoCompactAt = window > 0 ? Math.max(0, window - resolved.reserve) : 0;
	const headroom = resolved.enabled && tokens !== null && window > 0 ? autoCompactAt - tokens : null;
	// Pi's total is a message-only estimate until an assistant reply reports real
	// usage, so the drift row names that cause instead of calling the gap noise.
	const beforeFirstReply = !inputs.messages.some((message) => roleOf(message) === "assistant");

	const messageCounts = new Map<string, number>();
	const messageTokens = new Map<string, number>();
	const injectedTokens = new Map<string, number>();
	const injectedCounts = new Map<string, number>();
	let systemTokens = 0;
	const largestCandidates: Array<{ message: AgentMessage; tokens: number }> = [];

	const add = (id: string, estimate: number): void => {
		messageTokens.set(id, (messageTokens.get(id) ?? 0) + estimate);
		messageCounts.set(id, (messageCounts.get(id) ?? 0) + 1);
	};

	for (const message of inputs.messages) {
		const estimate = estimateTokens(message);
		if (estimate > 0) largestCandidates.push({ message, tokens: estimate });
		switch (roleOf(message)) {
			case "system":
				systemTokens += estimate;
				break;
			case "user":
				add("user", estimate);
				break;
			case "assistant":
				add("assistant", estimate);
				break;
			case "toolResult":
				add("toolResults", estimate);
				break;
			case "custom": {
				const customType = customTypeOf(message);
				injectedTokens.set(customType, (injectedTokens.get(customType) ?? 0) + estimate);
				injectedCounts.set(customType, (injectedCounts.get(customType) ?? 0) + 1);
				break;
			}
			case "branchSummary":
			case "compactionSummary":
				add("summaries", estimate);
				break;
			case "bashExecution":
				add("bash", estimate);
				break;
			default:
				// Pi's estimator returns 0 for a role it does not know, so there is
				// nothing to attribute and no row to open.
				break;
		}
	}

	// The host counts the system prompt once. Prefer a system message when the
	// projection carries one, so it is never counted twice.
	const systemEstimate = systemTokens > 0 ? systemTokens : estimateText(inputs.systemPrompt);

	const top: BucketDraft[] = [];
	const push = (id: string, label: string, estimate: number, note?: string): void => {
		if (estimate <= 0) return;
		top.push({ id, label, tokens: estimate, ...(note ? { note } : {}) });
	};
	const countNote = (count: number): string | undefined =>
		count > 0 ? `${count} ${count === 1 ? "message" : "messages"}` : undefined;
	const messageNote = (id: string): string | undefined => countNote(messageCounts.get(id) ?? 0);

	push("system", "System prompt", systemEstimate);
	push("tools", "Tool definitions", inputs.tools.tokens, `${inputs.tools.active} active of ${inputs.tools.total}`);
	push("user", "User messages", messageTokens.get("user") ?? 0, messageNote("user"));
	push("assistant", "Assistant", messageTokens.get("assistant") ?? 0, messageNote("assistant"));
	push("toolResults", "Tool results", messageTokens.get("toolResults") ?? 0, messageNote("toolResults"));

	const injectedTotal = [...injectedTokens.values()].reduce((sum, value) => sum + value, 0);
	const injectedCount = [...injectedCounts.values()].reduce((sum, value) => sum + value, 0);
	push("injected", "Injected context", injectedTotal, countNote(injectedCount));

	push("summaries", "Summaries", messageTokens.get("summaries") ?? 0, messageNote("summaries"));
	push("bash", "Shell output", messageTokens.get("bash") ?? 0, messageNote("bash"));

	const estimate = top.reduce((sum, bucket) => sum + bucket.tokens, 0);

	// Injected children: per custom type, biggest first, then one "other" row so
	// the child list stays short without dropping a type's share.
	const children = [...injectedTokens.entries()].sort((a, b) => b[1] - a[1]);
	const shown = children.slice(0, 5);
	const rest = children.slice(5);
	// A child's count is informative only when it divides the parent's; one
	// injected type would otherwise repeat the same `1 message` twice.
	const childNote = (customType: string): string | undefined => {
		const count = injectedCounts.get(customType) ?? 0;
		return count > 0 && count < injectedCount ? countNote(count) : undefined;
	};
	const childDrafts: BucketDraft[] = shown.map(([customType, estimateForType]) => {
		const note = childNote(customType);
		return {
			id: `injected:${customType}`,
			label: customType,
			tokens: estimateForType,
			...(note ? { note } : {}),
		};
	});
	if (rest.length > 0) {
		childDrafts.push({
			id: "injected:other",
			label: `${rest.length} more`,
			tokens: rest.reduce((sum, [, value]) => sum + value, 0),
			note: countNote(rest.reduce((sum, [type]) => sum + (injectedCounts.get(type) ?? 0), 0)),
		});
	}

	const buckets: ContextBucket[] = [];
	for (const draft of top) {
		buckets.push({ ...draft, share: shareOf(draft.tokens, estimate), depth: 0 });
		if (draft.id !== "injected") continue;
		for (const child of childDrafts) {
			buckets.push({ ...child, share: shareOf(child.tokens, estimate), depth: 1 });
		}
	}

	const largest: LargestBlock[] = largestCandidates
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, 5)
		.map((candidate) => ({
			tokens: candidate.tokens,
			role: roleLabel(candidate.message),
			label: descriptorOf(candidate.message),
		}));

	return {
		window,
		tokens,
		percent,
		free,
		headroom,
		reserve: resolved.reserve,
		keepRecentTokens: resolved.keepRecentTokens,
		enabled: resolved.enabled,
		autoCompactAt,
		buckets,
		estimate,
		drift: tokens !== null ? tokens - estimate : null,
		beforeFirstReply,
		compaction: compactionHistory(inputs),
		largest,
	};
}
