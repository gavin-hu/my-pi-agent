/**
 * The pure report: composition, threshold resolution, compaction history, and
 * the text form a non-TUI session prints.
 *
 * The fixture's numbers are round on purpose (400 characters = 100 tokens), so a
 * failure points at the rule that broke rather than at the arithmetic.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "bun:test";
import { formatBudget, formatCompaction, formatDrift, formatHeadline, formatReport } from "./format.ts";
import { buildReport, compactTimestamp, estimateText, resolveCompactionSettings } from "./report.ts";
import { SAMPLE_USAGE, sampleCompaction, sampleContext } from "../../test/helpers/fixtures/context.ts";

/** The default fixture's composition: 100 + 200 + 10 + 20 + 200 + 10 + 5. */
const ESTIMATE = 545;

describe("the composition", () => {
	test("splits the estimate by role, in display order", () => {
		const report = buildReport(sampleContext());
		expect(report.estimate).toBe(ESTIMATE);
		expect(report.buckets.map((bucket) => [bucket.id, bucket.tokens, bucket.depth])).toEqual([
			["system", 100, 0],
			["tools", 200, 0],
			["user", 10, 0],
			["assistant", 20, 0],
			["toolResults", 200, 0],
			["injected", 15, 0],
			["injected:memory", 10, 1],
			["injected:goal", 5, 1],
		]);
	});

	test("sums the top-level rows to the estimate", () => {
		const report = buildReport(sampleContext());
		const top = report.buckets.filter((bucket) => bucket.depth === 0);
		expect(top.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(ESTIMATE);
	});

	test("gives each row its share of the estimate, to one decimal", () => {
		const report = buildReport(sampleContext());
		const tools = report.buckets.find((bucket) => bucket.id === "tools");
		expect(tools?.share).toBe(36.7);
	});

	test("derives every share from the unrounded tokens", () => {
		const report = buildReport(sampleContext());
		for (const bucket of report.buckets) {
			expect(bucket.share, bucket.id).toBe(Math.round((bucket.tokens / report.estimate) * 1000) / 10);
		}
		const top = report.buckets.filter((bucket) => bucket.depth === 0);
		const total = top.reduce((sum, bucket) => sum + bucket.share, 0);
		expect(Math.abs(total - 100)).toBeLessThanOrEqual(0.2);
	});

	test("names the active tool surface", () => {
		const report = buildReport(sampleContext());
		expect(report.buckets.find((bucket) => bucket.id === "tools")?.note).toBe("3 active of 5");
	});

	test("counts the injected messages above their children", () => {
		const report = buildReport(sampleContext());
		expect(report.buckets.find((bucket) => bucket.id === "injected")?.note).toBe("2 messages");
	});

	test("does not repeat the parent's count on its only child", () => {
		const messages = [
			{
				role: "custom",
				customType: "my-pi-agent/notice",
				content: "m".repeat(40),
				display: false,
				timestamp: 0,
			} as unknown as AgentMessage,
		];
		const report = buildReport(sampleContext({ messages }));
		expect(report.buckets.find((bucket) => bucket.id === "injected")?.note).toBe("1 message");
		expect(report.buckets.find((bucket) => bucket.id === "injected:my-pi-agent/notice")?.note).toBeUndefined();
	});

	test("keeps a child count that divides the total", () => {
		const report = buildReport(sampleContext());
		expect(report.buckets.find((bucket) => bucket.id === "injected:memory")?.note).toBe("1 message");
	});

	test("caps the injected children and folds the rest into one row", () => {
		const messages = ["a", "b", "c", "d", "e", "f", "g"].map(
			(customType) =>
				({
					role: "custom",
					customType,
					content: "x".repeat(40),
					display: false,
					timestamp: 0,
				}) as unknown as AgentMessage,
		);
		const report = buildReport(sampleContext({ messages }));
		const children = report.buckets.filter((bucket) => bucket.depth === 1);
		expect(children).toHaveLength(6);
		expect(children.at(-1)?.label).toBe("2 more");
	});

	test("leaves the estimate and rows when the host has no total", () => {
		const report = buildReport(sampleContext({ usage: { tokens: null, contextWindow: 200000, percent: null } }));
		expect(report.tokens).toBeNull();
		expect(report.free).toBeNull();
		expect(report.headroom).toBeNull();
		expect(report.percent).toBeNull();
		expect(report.estimate).toBe(ESTIMATE);
		expect(report.buckets.length).toBeGreaterThan(0);
	});
});

describe("the budget", () => {
	test("uses the host total and the default reserve", () => {
		const report = buildReport(sampleContext());
		expect(report.window).toBe(200000);
		expect(report.tokens).toBe(SAMPLE_USAGE.tokens);
		expect(report.percent).toBe(62);
		expect(report.reserve).toBe(16384);
		expect(report.keepRecentTokens).toBe(20000);
		expect(report.autoCompactAt).toBe(183616);
		expect(report.free).toBe(76000);
		expect(report.headroom).toBe(59616);
		expect(report.enabled).toBe(true);
	});

	test("resolves a per-model override before the shared setting", () => {
		const report = buildReport(
			sampleContext({
				settings: {
					compaction: {
						reserveTokens: 16000,
						keepRecentTokens: 20000,
						modelOverrides: { "anthropic/claude": { reserveTokens: 4000, keepRecentTokens: 8000 } },
					},
				},
			}),
		);
		expect(report.reserve).toBe(4000);
		expect(report.keepRecentTokens).toBe(8000);
		expect(report.autoCompactAt).toBe(196000);
	});

	test("falls back to Pi's defaults when settings say nothing", () => {
		expect(resolveCompactionSettings({}, null)).toEqual({
			enabled: true,
			reserve: 16384,
			keepRecentTokens: 20000,
		});
	});

	test("reads a disabled automatic compaction without changing the threshold", () => {
		const report = buildReport(sampleContext({ settings: { compaction: { enabled: false } } }));
		expect(report.enabled).toBe(false);
		expect(report.reserve).toBe(16384);
		expect(report.autoCompactAt).toBe(183616);
		expect(report.headroom).toBeNull();
	});

	test("goes past the threshold when the host total exceeds it", () => {
		const report = buildReport(sampleContext({ usage: { tokens: 190000, contextWindow: 200000, percent: 95 } }));
		expect(report.autoCompactAt).toBe(183616);
		expect(report.headroom).toBe(-6384);
	});

	test("handles an unknown context window", () => {
		const report = buildReport(sampleContext({ window: 0, usage: undefined }));
		expect(report.window).toBe(0);
		expect(report.percent).toBeNull();
		expect(report.free).toBeNull();
		expect(report.autoCompactAt).toBe(0);
		expect(report.headroom).toBeNull();
	});
});

describe("drift", () => {
	test("reports a host total above the estimate", () => {
		expect(buildReport(sampleContext()).drift).toBe(124000 - ESTIMATE);
	});

	test("reports a host total below the estimate", () => {
		const report = buildReport(sampleContext({ usage: { tokens: 500, contextWindow: 200000, percent: 0.25 } }));
		expect(report.drift).toBe(500 - ESTIMATE);
	});

	test("is unknown when the host has no total", () => {
		const report = buildReport(sampleContext({ usage: { tokens: null, contextWindow: 200000, percent: null } }));
		expect(report.drift).toBeNull();
	});
});

describe("the compaction history", () => {
	test("reads the latest entry's effect", () => {
		const report = buildReport(sampleContext());
		expect(report.compaction.count).toBe(1);
		expect(report.compaction.last).toEqual({
			at: "2026-01-02 14:03Z",
			tokensBefore: 180000,
			summaryTokens: 100,
			freed: 179900,
		});
	});

	test("says none when the branch has never compacted", () => {
		expect(buildReport(sampleContext({ branch: [] })).compaction).toEqual({ count: 0, last: null });
	});

	test("counts every compaction on the branch", () => {
		const second = { ...sampleCompaction(), id: "compaction-2", tokensBefore: 90000 };
		const report = buildReport(sampleContext({ branch: [sampleCompaction(), second] }));
		expect(report.compaction.count).toBe(2);
		expect(report.compaction.last?.tokensBefore).toBe(90000);
	});

	test("formats a timestamp without a locale", () => {
		expect(compactTimestamp("2026-01-02T14:03:59.999Z")).toBe("2026-01-02 14:03Z");
		expect(compactTimestamp("not a timestamp")).toBe("not a timestamp");
	});
});

describe("the largest messages", () => {
	test("orders them biggest first and labels the role", () => {
		const report = buildReport(sampleContext());
		expect(report.largest.map((block) => [block.role, block.tokens])).toEqual([
			["tool result", 200],
			["assistant", 20],
			["user", 10],
			["injected", 10],
			["injected", 5],
		]);
		expect(report.largest[0]?.label).toBe("read");
	});

	test("keeps five and clips a long descriptor", () => {
		const messages = Array.from({ length: 7 }, (_, index) => ({
			role: "assistant",
			content: [{ type: "text", text: `${index} ${"x".repeat(200)}` }],
			timestamp: 0,
		})) as unknown as AgentMessage[];
		const report = buildReport(sampleContext({ messages }));
		expect(report.largest).toHaveLength(5);
		for (const block of report.largest) {
			expect(block.label.length).toBeLessThanOrEqual(40);
			expect(block.label.endsWith("…")).toBe(true);
		}
	});

	test("strips control characters from a descriptor", () => {
		const messages = [
			{ role: "custom", customType: "bad\u001b[31mtype", content: "x", display: false, timestamp: 0 },
			{
				role: "toolResult",
				toolName: "read\u001b[31m",
				content: [{ type: "text", text: "y".repeat(80) }],
				isError: false,
				timestamp: 0,
			},
		] as unknown as AgentMessage[];
		const report = buildReport(sampleContext({ messages }));
		expect(report.buckets.some((bucket) => bucket.label.includes("\u001b"))).toBe(false);
		expect(report.largest.some((block) => block.label.includes("\u001b"))).toBe(false);
	});
});

describe("the plain-text form", () => {
	test("opens with the host number", () => {
		expect(formatHeadline(buildReport(sampleContext()))).toBe("Context · 124k / 200k (62%)");
	});

	test("says which number is missing", () => {
		const afterCompaction = buildReport(
			sampleContext({ usage: { tokens: null, contextWindow: 200000, percent: null } }),
		);
		expect(formatHeadline(afterCompaction)).toBe("Context · 200k window · tokens unknown until the next reply");
		expect(formatHeadline(buildReport(sampleContext({ window: 0, usage: undefined })))).toBe(
			"Context · model context window unknown",
		);
	});

	test("names the free space and the threshold", () => {
		expect(formatBudget(buildReport(sampleContext()))).toBe(
			"76k free · auto-compact at 184k · 60k headroom · keeps newest 20k",
		);
	});

	test("says when automatic compaction is off", () => {
		const report = buildReport(sampleContext({ settings: { compaction: { enabled: false } } }));
		const budget = formatBudget(report);
		expect(budget).toContain("auto-compaction off");
		expect(budget).not.toContain("headroom");
		expect(budget).not.toContain("past the threshold");
	});

	test("reports a crossing and a missing history", () => {
		expect(formatCompaction(buildReport(sampleContext()))).toBe(
			"1 so far · last 2026-01-02 14:03Z cut 180k → 100 summary (freed 180k)",
		);
		expect(formatCompaction(buildReport(sampleContext({ branch: [] })))).toBe("none yet");
		expect(formatDrift(buildReport(sampleContext()))).toBe(
			"Estimate drift · rows 545 vs host 124k · +123k unattributed",
		);
	});

	test("says when the rows exceed the host's total", () => {
		const report = buildReport(sampleContext({ usage: { tokens: 500, contextWindow: 200000, percent: 0.25 } }));
		expect(report.beforeFirstReply).toBe(false);
		expect(formatDrift(report)).toBe("Estimate drift · rows 545 vs host 500");
	});

	test("names Pi's message-only total before the first reply", () => {
		const report = buildReport(
			sampleContext({
				messages: [{ role: "user", content: "u".repeat(40), timestamp: 0 } as unknown as AgentMessage],
				usage: { tokens: 100, contextWindow: 200000, percent: 0.05 },
			}),
		);
		expect(report.beforeFirstReply).toBe(true);
		expect(formatDrift(report)).toBe("Estimate drift · rows 310 vs host 100 · host counts messages only");
	});

	test("keeps the longest drift line inside a narrow terminal", () => {
		const report = buildReport(
			sampleContext({
				window: 1000000,
				usage: { tokens: 26, contextWindow: 1000000, percent: 0.0026 },
				systemPrompt: "s".repeat(5141 * 4),
				tools: { tokens: 5462 },
				messages: [
					{
						role: "custom",
						customType: "my-pi-agent/notice",
						content: "n".repeat(104),
						display: false,
						timestamp: 0,
					} as unknown as AgentMessage,
				],
				branch: [],
			}),
		);
		const drift = formatDrift(report) ?? "";
		expect(drift).toBe("Estimate drift · rows 11k vs host 26 · host counts messages only");
		expect(drift.length).toBeLessThanOrEqual(72);
	});

	test("assembles the notification body", () => {
		const text = formatReport(buildReport(sampleContext()));
		const lines = text.split("\n");
		expect(lines[0]).toBe("Context · 124k / 200k (62%)");
		expect(text).toContain("Composition · 545 estimate");
		expect(text).toContain("Tool definitions");
		expect(text).toContain("Compaction · 1 so far");
		expect(text).toContain("Largest · 200 tool result read");
	});

	test("uses the host's chars/4 heuristic for text", () => {
		expect(estimateText("x".repeat(400))).toBe(100);
		expect(estimateText("")).toBe(0);
	});
});
