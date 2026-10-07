import { describe, expect, test } from "bun:test";
import { aggregateUsage, formatTokens, formatToolCall, formatUsageStats, shortenPath } from "../../extensions/subagent/format.ts";
import { fakeTheme } from "./helpers.ts";

describe("formatTokens", () => {
	test("scales at each boundary", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(34000)).toBe("34k");
		expect(formatTokens(2500000)).toBe("2.5M");
	});
});

describe("formatUsageStats", () => {
	test("omits zero fields and appends the model", () => {
		const text = formatUsageStats(
			{ turns: 2, input: 1200, output: 300, cacheRead: 800, cacheWrite: 0, cost: 0.0042, contextTokens: 2000 },
			"claude-sonnet-4-5",
		);
		expect(text).toBe("2 turns ↑1.2k ↓300 R800 $0.0042 ctx:2.0k claude-sonnet-4-5");
	});

	test("returns an empty string when there is nothing to show", () => {
		expect(formatUsageStats({})).toBe("");
	});

	test("singularizes one turn", () => {
		expect(formatUsageStats({ turns: 1, input: 10 })).toBe("1 turn ↑10");
	});
});

describe("aggregateUsage", () => {
	test("sums every counter", () => {
		const total = aggregateUsage([
			{ usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5, contextTokens: 0, turns: 1 } },
			{ usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.25, contextTokens: 0, turns: 2 } },
		]);
		expect(total).toMatchObject({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, turns: 3 });
		expect(total.cost).toBeCloseTo(0.75);
	});
});

describe("shortenPath", () => {
	test("replaces the home prefix only", () => {
		const home = process.env.HOME ?? "";
		if (!home) return;
		expect(shortenPath(`${home}/projects/x`)).toBe("~/projects/x");
		expect(shortenPath("/tmp/x")).toBe("/tmp/x");
	});
});

describe("formatToolCall", () => {
	const theme = fakeTheme();

	test("formats built-in tools", () => {
		expect(formatToolCall("bash", { command: "ls -la" }, theme, true)).toBe("$ ls -la");
		expect(formatToolCall("read", { file_path: "/tmp/a.ts", offset: 10, limit: 5 }, theme, true)).toContain("/tmp/a.ts:10-14");
		expect(formatToolCall("grep", { pattern: "foo", path: "/tmp" }, theme, true)).toContain("/foo/");
		expect(formatToolCall("find", { pattern: "*.ts", path: "." }, theme, true)).toContain("*.ts");
		expect(formatToolCall("write", { file_path: "/tmp/a.ts", content: "a\nb" }, theme, true)).toContain("(2 lines)");
	});

	test("falls back to a JSON preview for unknown tools", () => {
		expect(formatToolCall("custom", { a: 1 }, theme, true)).toContain('{"a":1}');
	});
});
