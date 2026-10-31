import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeWatchRecord as record } from "../../test/helpers/fixtures/watch.ts";
import {
	compileRegex,
	formatCallText,
	formatPattern,
	formatPendingMatch,
	formatTail,
	formatWatchDetail,
	formatWatchList,
	formatWatchOutcomeLine,
	formatWatchStatus,
	shortLabel,
	sourceLabel,
	statusGlyphChar,
	statusRole,
	statusWord,
} from "./format.ts";

describe("watch formatting", () => {
	test("compileRegex is case-insensitive by default and sensitive on request", () => {
		expect(compileRegex("error", false).test("ERROR")).toBe(true);
		expect(compileRegex("error", true).test("ERROR")).toBe(false);
	});

	test("sourceLabel names a file or a command", () => {
		expect(sourceLabel(record())).toBe("/tmp/app.log");
		expect(sourceLabel(record({ source: { kind: "command", command: "tail -f x" } }))).toBe("$ tail -f x");
	});

	test("shortLabel prefers the label and falls back to the source", () => {
		expect(shortLabel(record())).toBe("errors");
		expect(shortLabel(record({ label: "" }))).toBe("/tmp/app.log");
	});

	test("statusWord includes an exit code or an error", () => {
		expect(statusWord(record({ status: "exited", exitCode: 2 }))).toBe("exited (2)");
		expect(statusWord(record({ status: "error", error: "boom" }))).toBe("error (boom)");
		expect(statusWord(record({ status: "stopped" }))).toBe("stopped");
	});

	test("each status has its own role and glyph", () => {
		const statuses = ["running", "exited", "stopped", "error"] as const;
		expect(statuses.map(statusRole)).toEqual(["accent", "ok", "meta", "bad"]);
		expect(statuses.map(statusGlyphChar)).toEqual([GLYPHS.target, GLYPHS.check, GLYPHS.stopped, GLYPHS.warn]);
	});

	test("formatWatchList says so when there are none", () => {
		expect(formatWatchList([])).toBe("No watchers.");
	});

	test("formatWatchList includes the id, match count, and label", () => {
		const text = formatWatchList([record()], 5000);
		expect(text).toContain("w1");
		expect(text).toContain("1 match");
		expect(text).toContain("errors");
	});

	test("formatWatchStatus reports the pattern, source, and counts", () => {
		const text = formatWatchStatus(record(), 5000);
		expect(text).toContain("w1: running");
		expect(text).toContain("pattern: /error/i");
		expect(text).toContain("lines: 3");
		expect(text).toContain("matches: 1");
	});

	test("formatPattern reads one way for every flag combination", () => {
		expect(formatPattern(record())).toBe("/error/i");
		expect(formatPattern(record({ caseSensitive: true }))).toBe("/error/");
		expect(formatPattern(record({ wake: true }))).toBe("/error/i · wake");
		expect(formatPattern(record({ caseSensitive: true, wake: true }))).toBe("/error/ · wake");
	});

	test("formatWatchStatus names the wake badge", () => {
		expect(formatWatchStatus(record({ caseSensitive: true, wake: true }), 5000)).toContain("pattern: /error/ · wake");
	});

	test("formatTail notes an empty tail", () => {
		expect(formatTail("matches", record(), [], 1000).text).toContain("no matches yet");
	});

	test("formatTail truncates from the front and reports it", () => {
		const lines = ["aaaa", "bbbb", "cccc"];
		const result = formatTail("matches", record(), lines, 9);
		expect(result.truncated).toBe(true);
		expect(result.text).not.toContain("aaaa");
		expect(result.text).toContain("bbbb");
	});

	test("formatCallText summarizes an add with its source and pattern", () => {
		expect(formatCallText("add", { path: "app.log", pattern: "error" })).toBe("add app.log /error/");
		expect(formatCallText("add", { command: "tail -f x", pattern: "boom" })).toBe("add $ tail -f x /boom/");
		expect(formatCallText("add", {}, false)).toBe("add …");
	});

	test("formatCallText summarizes an id action and clear", () => {
		expect(formatCallText("stop", { id: "w1" })).toBe("stop w1");
		expect(formatCallText("clear", { all: true })).toBe("clear all");
		expect(formatCallText("clear", {})).toBe("clear stopped");
	});

	test("formatWatchDetail names the source, pattern, and counts", () => {
		const lines = formatWatchDetail(record(), 5000);
		expect(lines[0]).toBe("/tmp/app.log · /error/i");
		expect(lines[1]).toBe("running · 3 lines · 1 matches · 4s");
	});

	test("formatWatchDetail keeps the wake badge off the pattern's flags", () => {
		expect(formatWatchDetail(record({ caseSensitive: true, wake: true }), 5000)[0]).toBe(
			"/tmp/app.log · /error/ · wake",
		);
	});

	test("formatWatchOutcomeLine leads with the status glyph and id", () => {
		const text = formatWatchOutcomeLine(record({ matchCount: 2 }), fakeTheme, 5000);
		expect(text).toContain(`${GLYPHS.target} w1 errors`);
		expect(text).toContain("2 matches");
		expect(text).toContain("4s");
	});

	test("formatPendingMatch names the watcher and the matched line", () => {
		expect(formatPendingMatch({ watcherId: "w1", label: "errors", seq: 1, line: "boom", at: 0 })).toBe(
			"w1 (errors): boom",
		);
	});
});
