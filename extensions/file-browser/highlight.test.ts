import { describe, expect, test } from "bun:test";
import { detectLanguage, highlightLines, type HighlightLanguage } from "./highlight.ts";

/** Highlight and join lines so token assertions read as one string. */
function highlighted(lines: string[], language: HighlightLanguage): string {
	return highlightLines(lines, language).join("\n");
}

describe("detectLanguage", () => {
	test("maps the supported extensions, case-insensitively and by basename", () => {
		expect(detectLanguage("a.ts")).toBe("ts");
		expect(detectLanguage("dir/App.TSX")).toBe("ts");
		expect(detectLanguage("app.jsx")).toBe("js");
		expect(detectLanguage("package.json")).toBe("json");
		expect(detectLanguage("theme.scss")).toBe("css");
		expect(detectLanguage("index.html")).toBe("html");
		expect(detectLanguage("run.sh")).toBe("shell");
	});

	test("returns nothing for plain or unmapped files", () => {
		expect(detectLanguage("a.txt")).toBeUndefined();
		expect(detectLanguage("README.md")).toBeUndefined();
		expect(detectLanguage("Makefile")).toBeUndefined();
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
});
