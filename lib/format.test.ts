/**
 * Pure formatting and syntax highlighting: the text/number helpers renderers
 * share, and the escape-first tokenizer behind a code block.
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	boundedTail,
	formatCount,
	formatDuration,
	formatSize,
	formatToolCount,
	formatTokens,
	lineOf,
	MAX_OUTPUT_LINE,
	sanitize,
	sanitizeLine,
	sanitizeUntrustedLine,
	sanitizeUntrustedText,
	shortenPath,
	stripControlChars,
} from "./format.ts";
import { detectLanguage, fenceLanguage, highlightLines, type HighlightLanguage } from "./highlight.ts";

/** Highlight and join lines so token assertions read as one string. */
function highlighted(lines: string[], language: HighlightLanguage): string {
	return highlightLines(lines, language).join("\n");
}

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

describe("detectLanguage", () => {
	test("maps the supported extensions, case-insensitively and by basename", () => {
		expect(detectLanguage("a.ts")).toBe("ts");
		expect(detectLanguage("dir/App.TSX")).toBe("ts");
		expect(detectLanguage("app.jsx")).toBe("js");
		expect(detectLanguage("package.json")).toBe("json");
		expect(detectLanguage("theme.scss")).toBe("css");
		expect(detectLanguage("index.html")).toBe("html");
		expect(detectLanguage("run.sh")).toBe("shell");
		expect(detectLanguage("script.py")).toBe("python");
		expect(detectLanguage("Main.java")).toBe("java");
		expect(detectLanguage("config.yml")).toBe("yaml");
		expect(detectLanguage("query.sql")).toBe("sql");
	});

	test("returns nothing for plain or unmapped files", () => {
		expect(detectLanguage("a.txt")).toBeUndefined();
		expect(detectLanguage("README.md")).toBeUndefined();
		expect(detectLanguage("Makefile")).toBeUndefined();
	});
});

describe("fenceLanguage", () => {
	test("maps extension-style and long-form fence tokens", () => {
		expect(fenceLanguage("ts")).toBe("ts");
		expect(fenceLanguage("typescript")).toBe("ts");
		expect(fenceLanguage(".py")).toBe("python");
		expect(fenceLanguage("Python3")).toBe("python");
		expect(fenceLanguage("bash")).toBe("shell");
		expect(fenceLanguage("postgresql")).toBe("sql");
		expect(fenceLanguage("yml")).toBe("yaml");
	});

	test("ignores the rest of the info string and unknown tokens", () => {
		expect(fenceLanguage("ts title=x.ts")).toBe("ts");
		expect(fenceLanguage("")).toBeUndefined();
		expect(fenceLanguage("mystery")).toBeUndefined();
	});
});

describe("highlightLines", () => {
	test("keeps one output line per input line", () => {
		expect(highlightLines(["", "x", ""], "js")).toEqual(["", "x", ""]);
	});

	test("highlights JavaScript keywords, numbers, literals, and comments", () => {
		const html = highlighted(["const x = 1;", "if (a) return true; // note"], "js");
		expect(html).toContain(`<span class="tok-keyword">const</span>`);
		expect(html).toContain(`<span class="tok-number">1</span>`);
		expect(html).toContain(`<span class="tok-keyword">if</span>`);
		expect(html).toContain(`<span class="tok-literal">true</span>`);
		expect(html).toContain(`<span class="tok-comment">// note</span>`);
	});

	test("escapes file content instead of emitting it as markup", () => {
		const html = highlighted([`const a = "</span><img src=x onerror=1>";`], "js");
		expect(html).toContain("&lt;/span&gt;&lt;img");
		expect(html).not.toContain("<img");
	});

	test("carries a block comment and a template literal across lines", () => {
		const html = highlighted(["/* a", "b */", "const c = `x", "y`;"], "js");
		expect(html).toContain(`<span class="tok-comment">/* a</span>`);
		expect(html).toContain(`<span class="tok-comment">b */</span>`);
		expect(html).toContain(`<span class="tok-keyword">const</span>`);
		expect(html).toContain(`<span class="tok-string">\`x</span>`);
		expect(html).toContain(`<span class="tok-string">y\`</span>`);
	});

	test("highlights JSON keys as properties and values as strings", () => {
		const html = highlighted(['{"name": "serve", "ok": true, "n": null}'], "json");
		expect(html).toContain(`<span class="tok-prop">&quot;name&quot;</span>`);
		expect(html).toContain(`<span class="tok-string">&quot;serve&quot;</span>`);
		expect(html).toContain(`<span class="tok-literal">true</span>`);
		expect(html).toContain(`<span class="tok-literal">null</span>`);
	});

	test("highlights CSS properties inside a block but not the selector", () => {
		const html = highlighted(["a:hover {", "  color: #fff;", "  width: 12px;", "}"], "css");
		expect(html).toContain("a:hover {");
		expect(html).not.toContain(`<span class="tok-prop">a</span>`);
		expect(html).toContain(`<span class="tok-prop">color</span>`);
		expect(html).toContain(`<span class="tok-number">#fff</span>`);
		expect(html).toContain(`<span class="tok-prop">width</span>`);
		expect(html).toContain(`<span class="tok-number">12px</span>`);
	});

	test("highlights CSS comments and at-rules", () => {
		const html = highlighted(["/* c */", "@media (min-width: 600px) {"], "css");
		expect(html).toContain(`<span class="tok-comment">/* c */</span>`);
		expect(html).toContain(`<span class="tok-keyword">@media</span>`);
	});

	test("highlights HTML tags, attributes, and values", () => {
		const html = highlighted([`<a href="/view" class='x'>y</a>`], "html");
		expect(html).toContain(`<span class="tok-tag">a</span>`);
		expect(html).toContain(`<span class="tok-attr">href</span>`);
		expect(html).toContain(`<span class="tok-string">&quot;/view&quot;</span>`);
		expect(html).toContain(`<span class="tok-string">&#39;x&#39;</span>`);
	});

	test("carries an HTML comment and an open tag across lines", () => {
		const html = highlighted(["<!-- a", "b -->", "<div", `  class="x">`, "</div>"], "html");
		expect(html).toContain(`<span class="tok-comment">&lt;!-- a</span>`);
		expect(html).toContain(`<span class="tok-comment">b --&gt;</span>`);
		expect(html).toContain(`<span class="tok-tag">div</span>`);
		expect(html).toContain(`<span class="tok-attr">class</span>`);
	});

	test("treats a stray angle bracket in HTML text as text", () => {
		const html = highlighted(["a < b"], "html");
		expect(html).toBe("a &lt; b");
	});

	test("highlights shell variables, comments, strings, and keywords", () => {
		const html = highlighted([`x=$HOME # note`, `if [ -f 'a b' ]; then`, "  echo hi"], "shell");
		expect(html).toContain(`<span class="tok-var">$HOME</span>`);
		expect(html).toContain(`<span class="tok-comment"># note</span>`);
		expect(html).toContain(`<span class="tok-keyword">if</span>`);
		expect(html).toContain(`<span class="tok-keyword">then</span>`);
		expect(html).toContain(`<span class="tok-string">&#39;a b&#39;</span>`);
	});

	test("highlights Python keywords, literals, decorators, and comments", () => {
		const html = highlighted(["@decorator", "def f(x):", "    return None  # done"], "python");
		expect(html).toContain(`<span class="tok-keyword">@decorator</span>`);
		expect(html).toContain(`<span class="tok-keyword">def</span>`);
		expect(html).toContain(`<span class="tok-keyword">return</span>`);
		expect(html).toContain(`<span class="tok-literal">None</span>`);
		expect(html).toContain(`<span class="tok-comment"># done</span>`);
	});

	test("carries a Python triple-quoted string across lines", () => {
		const html = highlighted(['x = """a', 'b"""', "y = 1"], "python");
		expect(html).toContain(`<span class="tok-string">&quot;&quot;&quot;a</span>`);
		expect(html).toContain(`<span class="tok-string">b&quot;&quot;&quot;</span>`);
		expect(html).toContain(`<span class="tok-number">1</span>`);
	});

	test("highlights Java keywords, annotations, and literals", () => {
		const html = highlighted(["@Override", "public boolean ok() { return true; }"], "java");
		expect(html).toContain(`<span class="tok-keyword">@Override</span>`);
		expect(html).toContain(`<span class="tok-keyword">public</span>`);
		expect(html).toContain(`<span class="tok-keyword">return</span>`);
		expect(html).toContain(`<span class="tok-literal">true</span>`);
	});

	test("highlights YAML keys, literals, and comments", () => {
		const html = highlighted(["name: serve", "  - enabled: true", "count: 3 # note", "---"], "yaml");
		expect(html).toContain(`<span class="tok-prop">name</span>`);
		expect(html).toContain(`<span class="tok-prop">enabled</span>`);
		expect(html).toContain(`<span class="tok-literal">true</span>`);
		expect(html).toContain(`<span class="tok-number">3</span>`);
		expect(html).toContain(`<span class="tok-comment"># note</span>`);
		expect(html).toContain(`<span class="tok-keyword">---</span>`);
	});

	test("highlights SQL keywords case-insensitively and escapes doubled quotes", () => {
		const html = highlighted(["SELECT * FROM t WHERE name = 'it''s'", "-- note", "/* block */"], "sql");
		expect(html).toContain(`<span class="tok-keyword">SELECT</span>`);
		expect(html).toContain(`<span class="tok-keyword">FROM</span>`);
		expect(html).toContain(`<span class="tok-keyword">WHERE</span>`);
		expect(html).toContain(`<span class="tok-string">&#39;it&#39;&#39;s&#39;</span>`);
		expect(html).toContain(`<span class="tok-comment">-- note</span>`);
		expect(html).toContain(`<span class="tok-comment">/* block */</span>`);
	});
});
