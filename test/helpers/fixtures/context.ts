/**
 * Shared inputs for the context suites.
 *
 * The numbers are chosen so the arithmetic in a test is readable: a 400-character
 * system prompt is 100 tokens, the tool surface is 200, and each message is a
 * round multiple of four characters. One compaction entry is present, so the
 * history path is exercised by default.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { BranchEntries, ContextInputs, ContextUsage } from "../../../extensions/context/types.ts";

/** The host headline used by default: 124k of 200k, which is 62%. */
export const SAMPLE_USAGE: ContextUsage = { tokens: 124000, contextWindow: 200000, percent: 62 };

/** A 400-character system prompt, which the chars/4 estimate reads as 100. */
export const SAMPLE_SYSTEM_PROMPT = "s".repeat(400);

/** The projected messages, one per role the report distinguishes. */
export function sampleMessages(): AgentMessage[] {
	return [
		{ role: "user", content: "u".repeat(40), timestamp: 0 },
		{ role: "assistant", content: [{ type: "text", text: "a".repeat(80) }], timestamp: 0 },
		{
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "t".repeat(800) }],
			isError: false,
			timestamp: 0,
		},
		{ role: "custom", customType: "memory", content: "m".repeat(40), display: false, timestamp: 0 },
		{ role: "custom", customType: "goal", content: "g".repeat(20), display: false, timestamp: 0 },
	] as unknown as AgentMessage[];
}

/** One compaction entry: a 400-character summary over a 180k-token context. */
export function sampleCompaction(): BranchEntries[number] {
	return {
		type: "compaction",
		id: "compaction-1",
		parentId: null,
		timestamp: "2026-01-02T14:03:00.000Z",
		summary: "c".repeat(400),
		firstKeptEntryId: "kept-1",
		tokensBefore: 180000,
	} as BranchEntries[number];
}

/** A sample `ContextInputs`, with shallow overrides (and partial tool fields). */
export interface SampleOverrides extends Omit<Partial<ContextInputs>, "tools"> {
	tools?: Partial<ContextInputs["tools"]>;
}

export function sampleContext(overrides: SampleOverrides = {}): ContextInputs {
	const base: ContextInputs = {
		model: { provider: "anthropic", id: "claude" },
		window: 200000,
		systemPrompt: SAMPLE_SYSTEM_PROMPT,
		tools: { active: 3, total: 5, tokens: 200 },
		usage: SAMPLE_USAGE,
		messages: sampleMessages(),
		branch: [sampleCompaction()],
		settings: { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
	};
	const { tools, ...rest } = overrides;
	return { ...base, ...rest, tools: { ...base.tools, ...tools } };
}
