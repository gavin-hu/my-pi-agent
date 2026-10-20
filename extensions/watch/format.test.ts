import { describe, expect, test } from "bun:test";
import {
	compileRegex,
	formatCallText,
	formatPendingMatch,
	formatTail,
	formatWatchList,
	formatWatchStatus,
	sourceLabel,
	statusGlyphChar,
} from "./format.ts";
import type { WatchRecord } from "./types.ts";

function record(overrides: Partial<WatchRecord> = {}): WatchRecord {
	return {
		id: "w1",
		label: "errors",
		source: { kind: "file", path: "/tmp/app.log" },
		pattern: "error",
		exclude: [],
		caseSensitive: false,
		wake: false,
		fromStart: false,
		status: "running",
		startedAt: 1000,
		linesRead: 3,
		matchCount: 1,
		...overrides,
	};
}

describe("compileRegex", () => {
	test("is case-insensitive by default and sensitive on request", () => {
		expect(compileRegex("error", false).test("ERROR")).toBe(true);
		expect(compileRegex("error", true).test("ERROR")).toBe(false);
	});
});

describe("sourceLabel", () => {
	test("names a file or a command", () => {
		expect(sourceLabel(record())).toBe("/tmp/app.log");
		expect(sourceLabel(record({ source: { kind: "command", command: "tail -f x" } }))).toBe("$ tail -f x");
	});
});

describe("status glyphs", () => {
	test("uses a distinct glyph per status", () => {
		const statuses = ["running", "exited", "stopped", "error"] as const;
		const glyphs = statuses.map((status) => statusGlyphChar(status));
		expect(new Set(glyphs).size).toBe(statuses.length);
	});
});

describe("formatWatchList", () => {
	test("says so when there are none", () => {
		expect(formatWatchList([])).toBe("No watchers.");
	});

	test("includes the id, match count, and label", () => {
		const text = formatWatchList([record()], 5000);
		expect(text).toContain("w1");
		expect(text).toContain("1 match");
		expect(text).toContain("errors");
	});
});

describe("formatWatchStatus", () => {
	test("reports the pattern, source, and counts", () => {
		const text = formatWatchStatus(record(), 5000);
		expect(text).toContain("w1: running");
		expect(text).toContain("pattern: /error/i");
		expect(text).toContain("lines: 3");
		expect(text).toContain("matches: 1");
	});
});

describe("formatTail", () => {
	test("notes an empty tail", () => {
		expect(formatTail("matches", record(), [], 1000).text).toContain("no matches yet");
	});

	test("truncates from the front and reports it", () => {
		const lines = ["aaaa", "bbbb", "cccc"];
		const result = formatTail("matches", record(), lines, 9);
		expect(result.truncated).toBe(true);
		expect(result.text).not.toContain("aaaa");
		expect(result.text).toContain("bbbb");
	});
});

describe("formatCallText", () => {
	test("summarizes an add with its source and pattern", () => {
		expect(formatCallText("add", { path: "app.log", pattern: "error" })).toBe("add app.log /error/");
	});

	test("summarizes an id action", () => {
		expect(formatCallText("stop", { id: "w1" })).toBe("stop w1");
		expect(formatCallText("clear", { all: true })).toBe("clear all");
	});
});

describe("formatPendingMatch", () => {
	test("names the watcher and the matched line", () => {
		expect(formatPendingMatch({ watcherId: "w1", label: "errors", seq: 1, line: "boom", at: 0 })).toBe(
			"w1 (errors): boom",
		);
	});
});
