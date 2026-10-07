import { describe, expect, test } from "bun:test";
import { aggregateUsage, clip, clipPath, formatToolCall, formatUsageStats, shortenPath } from "../../extensions/subagent/format.ts";
import { fakeTheme } from "./helpers.ts";

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

	test("does not shorten a sibling path sharing the prefix", () => {
		const home = process.env.HOME ?? "";
		if (!home) return;
		expect(shortenPath(`${home}x/y`)).toBe(`${home}x/y`);
		expect(shortenPath(home)).toBe("~");
	});
});

describe("clip", () => {
	test("keeps surrogate pairs intact", () => {
		const out = clip(`${"a".repeat(59)}😀tail`, 60);
		expect(out.endsWith("...")).toBe(true);
		expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
		expect(out).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
	});

	test("accounts for wide characters by display width", () => {
		const out = clip("界".repeat(40), 20);
		expect(out.endsWith("...")).toBe(true);
		expect([...out].length).toBeLessThanOrEqual(12);
	});
});

describe("clipPath", () => {
	test("preserves the basename when eliding the middle", () => {
		const out = clipPath("/Users/gavin/Repositories/company/project/src/deeply/nested/module/file.ts", 40);
		expect(out.endsWith("file.ts")).toBe(true);
		expect(out).toContain("...");
	});

	test("returns a short path unchanged", () => {
		expect(clipPath("/tmp/a.ts", 40)).toBe("/tmp/a.ts");
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

	test("collapses newlines so a tool call stays on one preview line", () => {
		expect(formatToolCall("bash", { command: "echo a\necho b" }, theme, true)).toBe("$ echo a echo b");
	});

	test("clips an overlong path in the preview", () => {
		const out = formatToolCall("read", { file_path: `/tmp/${"a".repeat(200)}` }, theme, true);
		expect(out.length).toBeLessThan(90);
		expect(out).toContain("...");
	});

	test("does not throw on malformed arguments", () => {
		for (const args of [undefined, null]) {
			for (const name of ["bash", "read", "grep", "write", "ls", "find", "edit", "custom"]) {
				expect(() => formatToolCall(name, args as never, theme, true)).not.toThrow();
			}
		}
	});

	test("falls back to a JSON preview for unknown tools", () => {
		expect(formatToolCall("custom", { a: 1 }, theme, true)).toContain('{"a":1}');
	});
});
