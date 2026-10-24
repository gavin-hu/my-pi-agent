/**
 * The `/context` report the screenshot is drawn around (dev tooling).
 *
 * A plausible session rather than a test's round numbers: a real system prompt,
 * a tool surface, two tool results that dominate the window, the two injected
 * notes this pack adds, and one earlier compaction. The totals agree — 124k of
 * 200k is 62%, and the buckets sum to the estimate the screen prints.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildReport } from "../../../extensions/context/report.ts";
import type { BranchEntries, ContextInputs, ContextReport } from "../../../extensions/context/types.ts";

/** Text of `length` characters that reads like prose rather than one repeated letter. */
function prose(length: number, seed: string): string {
	let text = "";
	while (text.length < length) text += `${seed} `;
	return text.slice(0, length);
}

/** The messages the report walks: one per role it distinguishes, plus both injected notes. */
const MESSAGES = [
	{
		role: "user",
		content:
			"The release branch fails its check on macOS — find out why and fix it. Keep the change small, and leave the other platform jobs alone: if the fix belongs in shared code, say so before you touch it.",
		timestamp: 0,
	},
	{
		role: "assistant",
		content: [
			{
				type: "text",
				text: prose(48000, "I'll run the check first and read the failing test before changing anything."),
			},
		],
		timestamp: 0,
	},
	{
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [
			{
				type: "text",
				text: prose(
					320000,
					"export function normalizePath(input: string): string { return input.replaceAll('\\\\', '/'); }",
				),
			},
		],
		isError: false,
		timestamp: 0,
	},
	{
		role: "toolResult",
		toolCallId: "call-2",
		toolName: "bash",
		content: [{ type: "text", text: prose(80000, "ok tests/helpers/files.test.ts (14 tests) 38ms") }],
		isError: false,
		timestamp: 0,
	},
	{
		role: "custom",
		customType: "memory",
		content: "The release check runs one file at a time on macOS; a parallel run hangs.",
		display: false,
		timestamp: 0,
	},
	{
		role: "custom",
		customType: "goal",
		content: "Get the release check green on all three platforms without widening the change.",
		display: false,
		timestamp: 0,
	},
] as unknown as AgentMessage[];

/** One earlier compaction, so the summaries row and the history line have something to show. */
const BRANCH = [
	{
		type: "compaction",
		id: "compaction-1",
		parentId: null,
		timestamp: "2026-01-02T14:03:00.000Z",
		summary: prose(
			1800,
			"Earlier: the same check passed on Linux and failed on macOS, and the trace pointed at the helper.",
		),
		firstKeptEntryId: "kept-1",
		tokensBefore: 180000,
	},
] as unknown as BranchEntries;

/** The inputs the report is built from. */
const INPUTS: ContextInputs = {
	model: { provider: "anthropic", id: "opus-4.5" },
	window: 200000,
	systemPrompt: prose(
		2400,
		"You are a coding assistant working in the user's repository. Prefer a small, verified change.",
	),
	tools: { active: 18, total: 24, tokens: 9400 },
	usage: { tokens: 124000, contextWindow: 200000, percent: 62 },
	messages: MESSAGES,
	branch: BRANCH,
	settings: { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
};

/** The report the frame draws: a session two thirds through its window, compacted once. */
export const CONTEXT_REPORT: ContextReport = buildReport(INPUTS);
