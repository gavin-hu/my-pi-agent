import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeWatchRecord as record } from "../../test/helpers/fixtures/watch.ts";
import {
	readPattern,
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
	test("readPattern reads the form the printer writes, and leaves bare text alone", () => {
		// The round trip is the whole contract: `formatPattern` prints these two, so a model
		// copying either back must mean the same watcher it read.
		expect(readPattern("/error/")).toEqual({ pattern: "error", caseSensitive: true });
		expect(readPattern("/error/i")).toEqual({ pattern: "error", caseSensitive: false });
		expect(readPattern("error")).toEqual({ pattern: "error" });
		// A body with a slash in it cannot be the `/…/flags` form, so a path pattern survives.
		expect(readPattern("/api/v1/x")).toEqual({ pattern: "/api/v1/x" });
		expect(readPattern("/api/v1/")).toEqual({ pattern: "/api/v1/" });
	});

	test("readPattern refuses a flag it cannot honour, naming the one it can", () => {
		// `g` and `y` carry `lastIndex` across the per-line `.test` calls, so honouring them
		// would skip lines — and matching them as text is the silent zero this replaces.
		expect(() => readPattern("/error/g")).toThrow(/flags are not read/);
		expect(() => readPattern("/error/gm")).toThrow(/`gm`/);
		expect(() => readPattern("/keep/x", "exclude")).toThrow(/exclude's flags/);
	});

	test("a printed pattern reads back as the expression it printed", () => {
		// The property, not a list of expected strings: meaning is what has to survive, since
		// `a/b` and `a\/b` are one expression to the engine — which is why the reader unescapes
		// nothing and `source` is the comparison. The empty body is here although `add` refuses
		// one, because the printer can be handed a record that holds it and the pair should have
		// no hole at zero. `/api/v1/` is not in the list: it is a hand-written path pattern, and
		// `readPattern`'s own case pins that it stays an expression, not a literal.
		for (const pattern of ["a/b", "api/v1", "\\/api", "^GET /", "/error/", "", "a\\/b/c", "^GET /api/v1$"]) {
			for (const caseSensitive of [true, false]) {
				for (const wake of [true, false]) {
					const watch = record({ pattern, caseSensitive, wake });
					const back = readPattern(formatPattern(watch));
					expect(back.caseSensitive).toBe(caseSensitive);
					expect(new RegExp(back.pattern, caseSensitive ? "" : "i").source).toBe(
						new RegExp(pattern, caseSensitive ? "" : "i").source,
					);
				}
			}
		}
	});

	test("sourceLabel names a file or a command", () => {
		expect(sourceLabel(record())).toBe("/tmp/app.log");
		expect(sourceLabel(record({ source: { kind: "command", command: "tail -f x" } }))).toBe("$ tail -f x");
	});

	test("shortLabel prefers the label and falls back to the source", () => {
		expect(shortLabel(record())).toBe("errors");
		expect(shortLabel(record({ label: "" }))).toBe("/tmp/app.log");
	});

	test("statusWord includes an exit code, the signal that ended it, or an error", () => {
		expect(statusWord(record({ status: "exited", exitCode: 2 }))).toBe("exited (2)");
		// Node reports a signalled child with a null code, so the signal is the whole account of it.
		expect(statusWord(record({ status: "exited", exitCode: null, signal: "SIGKILL" }))).toBe("exited (SIGKILL)");
		// A code is the first answer, even beside a signal, and a record with neither stays bare.
		expect(statusWord(record({ status: "exited", exitCode: 0, signal: "SIGTERM" }))).toBe("exited (0)");
		expect(statusWord(record({ status: "exited", exitCode: null, signal: null }))).toBe("exited");
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

	test("formatPattern prints the pattern whole, with no badge glued to it", () => {
		expect(formatPattern(record())).toBe("/error/i");
		expect(formatPattern(record({ caseSensitive: true }))).toBe("/error/");
		// `wake` is a field of its own now, so the printed pattern is the same either way — a model
		// that copies this line back never carries a badge into the expression.
		expect(formatPattern(record({ wake: true }))).toBe("/error/i");
		expect(formatPattern(record({ caseSensitive: true, wake: true }))).toBe("/error/");
		// A `/` in the body is escaped, or `readPattern` reads the line as that literal text.
		expect(formatPattern(record({ pattern: "api/v1" }))).toBe("/api\\/v1/i");
		expect(formatPattern(record({ pattern: "\\/api" }))).toBe("/\\/api/i");
	});

	test("formatWatchStatus states wake on its own line, never in the pattern", () => {
		const text = formatWatchStatus(record({ caseSensitive: true, wake: true }), 5000);
		expect(text).toContain("pattern: /error/");
		expect(text).toContain("wake: true");
		expect(formatWatchStatus(record({ caseSensitive: true }), 5000)).not.toContain("wake:");
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
		// The pattern prints as typed: wrapping it in slashes is what taught a model to write a
		// literal the parser then read as text, so the transcript shows what the caller sent.
		expect(formatCallText("add", { path: "app.log", pattern: "error" })).toBe("add app.log error");
		expect(formatCallText("add", { command: "tail -f x", pattern: "boom" })).toBe("add $ tail -f x boom");
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

	test("formatWatchDetail keeps the wake badge off the pattern", () => {
		const lines = formatWatchDetail(record({ caseSensitive: true, wake: true }), 5000);
		expect(lines[0]).toBe("/tmp/app.log · /error/");
		expect(lines[1]).toContain("· wake");
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
