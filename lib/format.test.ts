/**
 * Pure formatting: the text and number helpers every renderer shares.
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	boundedTail,
	formatAge,
	formatCount,
	formatDuration,
	FORMAT_AGE_JS,
	formatSize,
	formatToolCount,
	formatTokens,
	lineOf,
	MAX_OUTPUT_LINE,
	pageSource,
	sanitize,
	sanitizeLine,
	sanitizeUntrustedLine,
	sanitizeUntrustedText,
	shortenPath,
	stripControlChars,
} from "./format.ts";

/**
 * A body as the host's transpiler wrote it, without loading the transpiler.
 *
 * `bun` leaves an import's call site alone, so a body it stringifies never carries the shape
 * the host produces; this builds one that does, and a case can then hold `pageSource` to it.
 */
function transpiled(source: string): (...args: never[]) => unknown {
	return new Function(`return (${source});`)() as (...args: never[]) => unknown;
}

describe("pageSource", () => {
	test("writes a namespace call back to the helper's own name", () => {
		// The reported crash, whole: the board's history rule arrived at the page calling
		// `_sessionLabel.sameLabel`, a module nothing splices into the bundle.
		const body = transpiled(`function isHistoryOwner(label, roster) {
			for (const session of roster) if ((0, _sessionLabel.sameLabel)(session.label, label)) return false;
			return true;
		}`);
		const source = pageSource(body);
		expect(source).toContain("sameLabel(session.label, label)");
		expect(source).not.toContain("_sessionLabel");
		// What the page runs: the same comparison, beside the helper the fragment splices.
		const page = new Function(
			`${source}\nfunction sameLabel(a, b) { return a.toLowerCase() === b.toLowerCase(); }\nreturn isHistoryOwner;`,
		)() as (label: string, roster: { label: string }[]) => boolean;
		expect(page("Team", [{ label: "team" }])).toBe(false);
		expect(page("Team", [{ label: "bob" }])).toBe(true);
	});

	test("writes a namespace read back too, so a helper passed as a value still resolves", () => {
		const source = pageSource(transpiled(`function pick() { const f = _labels.sameLabel; return f; }`));
		expect(source).toContain("const f = sameLabel;");
		expect(source).not.toContain("_labels");
	});

	test("leaves the transpiler's leaked default import to fail at load, not on the page", () => {
		// `_os.default` names nothing the page holds, and the local name it stood for is gone, so
		// there is no rewrite that would be right.
		expect(() => pageSource(transpiled(`function home() { return (0, _os.default)(); }`))).toThrow(/default import/);
	});

	test("is one body under both loaders, and its own output again", () => {
		// Under `bun` nothing was rewritten, so the stripped body is the body.
		expect(pageSource(formatAge)).toBe(String(formatAge));
		const once = pageSource(transpiled(`function f() { return (0, _m.x)(); }`));
		expect(pageSource(transpiled(once))).toBe(once);
	});
});

describe("formatTokens", () => {
	test("scales at each boundary", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(34000)).toBe("34k");
		expect(formatTokens(2500000)).toBe("2.5M");
		expect(formatTokens(12000000)).toBe("12M");
	});

	test("switches to M before a count can round to 1000k", () => {
		expect(formatTokens(999499)).toBe("999k");
		expect(formatTokens(999974)).toBe("1.0M");
	});

	test("shows ? for a value that is not a number", () => {
		expect(formatTokens(Number.NaN)).toBe("?");
		expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("?");
	});
});

describe("formatCount", () => {
	test("groups thousands deterministically", () => {
		expect(formatCount(999)).toBe("999");
		expect(formatCount(8000)).toBe("8,000");
		expect(formatCount(42478)).toBe("42,478");
		expect(formatCount(-42478)).toBe("-42,478");
		expect(formatCount(Number.NaN)).toBe("0");
	});
});

describe("formatAge", () => {
	test("says an age the way a reader does", () => {
		const now = 1_000_000_000;
		// Under 45 seconds is "now", then minutes, hours, days — never a second count, because
		// a card's age is a shape and not a stopwatch.
		expect(formatAge(now, now)).toBe("now");
		expect(formatAge(now, now - 44_000)).toBe("now");
		expect(formatAge(now, now - 45_000)).toBe("1m");
		expect(formatAge(now, now - 7 * 60_000)).toBe("7m");
		expect(formatAge(now, now - 119 * 60_000)).toBe("2h");
		expect(formatAge(now, now - 25 * 3_600_000)).toBe("1d");
		// A record written by a clock ahead of this one reads as new, not as a negative age.
		expect(formatAge(now, now + 60_000)).toBe("now");
	});

	test("crosses into the page's bundle as one body", () => {
		expect(FORMAT_AGE_JS).toBe(String(formatAge));
		// The bundle is a template literal, so the source may hold neither of these.
		expect(FORMAT_AGE_JS).not.toContain("`");
		expect(FORMAT_AGE_JS).not.toContain("${");
		const browserAge = new Function(`return (${FORMAT_AGE_JS});`)() as (now: number, at: number) => string;
		for (const at of [0, 1_000_000_000 - 44_000, 1_000_000_000 - 7 * 60_000, 1_000_000_000 - 86_400_000]) {
			expect(browserAge(1_000_000_000, at)).toBe(formatAge(1_000_000_000, at));
		}
	});
});

describe("formatDuration", () => {
	test("formats milliseconds, seconds, minutes, and hours", () => {
		expect(formatDuration(450)).toBe("450ms");
		expect(formatDuration(3200)).toBe("3.2s");
		expect(formatDuration(65_000)).toBe("1m05s");
		expect(formatDuration(7_380_000)).toBe("2h03m");
	});

	test("never prints NaN for a missing duration", () => {
		expect(formatDuration(Number.NaN)).toBe("0ms");
		expect(formatDuration(-1)).toBe("0ms");
	});
});

describe("formatSize", () => {
	test("formats byte sizes compactly", () => {
		expect(formatSize(0)).toBe("0 B");
		expect(formatSize(68)).toBe("68 B");
		expect(formatSize(12_400)).toBe("12 kB");
		expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("formatToolCount", () => {
	test("uses the singular for one and the plural otherwise", () => {
		expect(formatToolCount(0)).toBe("0 tools");
		expect(formatToolCount(1)).toBe("1 tool");
		expect(formatToolCount(3)).toBe("3 tools");
	});

	test("treats an invalid or negative count as zero", () => {
		expect(formatToolCount(Number.NaN)).toBe("0 tools");
		expect(formatToolCount(-2)).toBe("0 tools");
	});
});

describe("boundedTail", () => {
	test("keeps a short tail whole", () => {
		expect(boundedTail(["a", "b"], 10)).toEqual({ text: "a\nb", truncated: false });
	});

	test("keeps the end once the tail is over the limit", () => {
		expect(boundedTail(["aaaa", "bbbb"], 5)).toEqual({ text: "\nbbbb", truncated: true });
	});

	test("a tail exactly at the limit is not truncated", () => {
		expect(boundedTail(["aaa", "bbb"], 7)).toEqual({ text: "aaa\nbbb", truncated: false });
	});
});

describe("stripControlChars", () => {
	test("replaces ESC and C1 control characters with spaces", () => {
		expect(stripControlChars("a\u001b[31mb\u009dc")).toBe("a [31mb c");
	});

	test("keeps newlines and tabs for multi-line rendering", () => {
		expect(stripControlChars("a\nb\tc")).toBe("a\nb\tc");
	});
});

describe("sanitize", () => {
	test("collapses newlines, tabs, and runs of spaces", () => {
		expect(sanitize("a\nb\tc   d ")).toBe("a b c d");
	});

	test("is layout only: an escape sequence is left for the boundary to handle", () => {
		expect(sanitize("a\u001b[31mb")).toBe("a\u001b[31mb");
	});
});

describe("sanitizeLine", () => {
	test("neutralizes escapes and control characters, then collapses to one line", () => {
		expect(sanitizeLine("a\u001b[31mb\u009dc\n d ")).toBe("a [31mb c d");
	});

	test("replaces a lone control character and trims what it leaves behind", () => {
		expect(sanitizeLine("x\u0007")).toBe("x");
	});

	test("defuses an OSC title sequence from untrusted text", () => {
		expect(sanitizeLine("\u001b]0;title\u0007keep\ttab   here\n")).toBe("]0;title keep tab here");
	});
});

describe("lineOf", () => {
	test("sanitizes a string and reads any other value as empty", () => {
		expect(lineOf(" a\u001b[31mb\n")).toBe("a [31mb");
		expect(lineOf(undefined)).toBe("");
		expect(lineOf(7)).toBe("");
	});
});

describe("sanitizeUntrustedLine", () => {
	test("removes whole ANSI colour sequences, not their printable tail", () => {
		expect(sanitizeUntrustedLine("\u001b[31mred\u001b[0m")).toBe("red");
		expect(sanitizeUntrustedLine("\u001b[1;32mbold green\u001b[0m")).toBe("bold green");
	});

	test("removes an OSC sequence closed by BEL or by ST", () => {
		expect(sanitizeUntrustedLine("\u001b]0;title\u0007after")).toBe("after");
		expect(sanitizeUntrustedLine("\u001b]8;;https://pi.dev\u001b\\link\u001b]8;;\u001b\\")).toBe("link");
	});

	test("removes a single-character escape", () => {
		expect(sanitizeUntrustedLine("a\u001bMb")).toBe("ab");
	});

	test("resolves carriage-return progress to the final segment", () => {
		expect(sanitizeUntrustedLine("10%\r50%\r100% done")).toBe("100% done");
	});

	test("replaces a remaining control character and a C1 byte, then squeezes whitespace", () => {
		expect(sanitizeUntrustedLine("a\u0007b\u009dc\td   e")).toBe("a b c d e");
	});

	test("clips to the default maximum", () => {
		const line = sanitizeUntrustedLine("x".repeat(500));
		expect(line.length).toBe(MAX_OUTPUT_LINE);
		expect(line.endsWith("…")).toBe(true);
	});

	test("clips to a caller's maximum", () => {
		expect(sanitizeUntrustedLine("abcdef", 4)).toBe("abc…");
		expect(sanitizeUntrustedLine("abc", 4)).toBe("abc");
	});
});

describe("sanitizeUntrustedText", () => {
	test("sanitizes each line independently and keeps the blank ones", () => {
		expect(sanitizeUntrustedText("ok\n\u001b[32mgreen\u001b[0m\n")).toEqual(["ok", "green", ""]);
	});
});

describe("shortenPath", () => {
	test("replaces the home prefix only", () => {
		const home = homedir();
		expect(shortenPath(join(home, "projects", "x"))).toBe("~/projects/x");
		expect(shortenPath("/tmp/x")).toBe("/tmp/x");
	});

	test("does not shorten a sibling path sharing the prefix", () => {
		const home = homedir();
		const normalize = (value: string): string => value.replace(/\\/g, "/");
		// A sibling directory whose name merely starts with the home string.
		expect(shortenPath(`${home}-backup/x`)).toBe(normalize(`${home}-backup/x`));
		expect(shortenPath(home)).toBe("~");
	});

	test("accepts an explicit home for a deterministic caller", () => {
		expect(shortenPath("/home/u/repo/x", "/home/u")).toBe("~/repo/x");
		expect(shortenPath("/other/repo", "/home/u")).toBe("/other/repo");
	});

	test("normalizes separators so a Windows home matches a forward-slash path", () => {
		expect(shortenPath("C:\\Users\\u\\repo\\x", "C:\\Users\\u")).toBe("~/repo/x");
	});
});
