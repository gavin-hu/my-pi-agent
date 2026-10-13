import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown blocks", () => {
	test("renders ATX headings and keeps trailing hashes that are part of the text", () => {
		expect(renderMarkdown("# Title")).toBe("<h1>Title</h1>");
		expect(renderMarkdown("### Three ###")).toBe("<h3>Three</h3>");
		expect(renderMarkdown("# C#")).toBe("<h1>C#</h1>");
	});

	test("renders paragraphs and hard breaks", () => {
		expect(renderMarkdown("one\ntwo")).toBe("<p>one\ntwo</p>");
		expect(renderMarkdown("one  \ntwo")).toBe("<p>one<br>\ntwo</p>");
		expect(renderMarkdown("one\\\ntwo")).toBe("<p>one<br>\ntwo</p>");
	});

	test("renders fenced code with a language and escapes the body", () => {
		const html = renderMarkdown("```js\nconst x = 1 < 2;\n```");
		expect(html).toBe('<pre class="md-code"><code class="language-js">const x = 1 &lt; 2;</code></pre>');
		expect(renderMarkdown("```\nplain\n```")).toBe('<pre class="md-code"><code>plain</code></pre>');
	});

	test("renders thematic breaks", () => {
		expect(renderMarkdown("---")).toBe("<hr>");
		expect(renderMarkdown("* * *")).toBe("<hr>");
	});

	test("renders blockquotes, including a nested blank line", () => {
		expect(renderMarkdown("> quoted")).toBe("<blockquote><p>quoted</p></blockquote>");
		expect(renderMarkdown("> one\n>\n> two")).toBe("<blockquote><p>one</p>\n<p>two</p></blockquote>");
	});

	test("renders unordered, ordered, and nested lists", () => {
		expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
		expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
		const nested = renderMarkdown("- a\n  - b\n- c");
		expect(nested).toContain("<ul><li>a\n<ul><li>b</li></ul></li>");
		expect(nested).toContain("<li>c</li>");
	});

	test("renders task list items", () => {
		const html = renderMarkdown("- [x] done\n- [ ] todo");
		expect(html).toContain('<li class="task done">');
		expect(html).toContain("☑</span> done");
		expect(html).toContain('<li class="task">');
		expect(html).toContain("☐</span> todo");
	});

	test("renders tables with alignment", () => {
		const html = renderMarkdown("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
		expect(html).toContain('<table class="md-table">');
		expect(html).toContain('<th class="md-left">a</th>');
		expect(html).toContain('<th class="md-right">b</th>');
		expect(html).toContain('<td class="md-left">1</td>');
		expect(html).toContain('<td class="md-right">2</td>');
	});

	test("treats a non-delimiter second line as a paragraph, not a table", () => {
		expect(renderMarkdown("| a | b |\nnot a table")).toBe("<p>| a | b |\nnot a table</p>");
	});
});

describe("renderMarkdown inline", () => {
	test("renders code spans, emphasis, and strikethrough", () => {
		expect(renderMarkdown("`a < b`")).toBe("<p><code>a &lt; b</code></p>");
		expect(renderMarkdown("**bold** *italic* ~~gone~~")).toBe(
			"<p><strong>bold</strong> <em>italic</em> <del>gone</del></p>",
		);
	});

	test("does not emphasize intraword underscores", () => {
		expect(renderMarkdown("foo_bar_baz")).toBe("<p>foo_bar_baz</p>");
	});

	test("renders links with safe schemes and rewrites local links", () => {
		expect(renderMarkdown("[x](https://example.com)")).toBe(
			'<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>',
		);
		expect(renderMarkdown("[x](mailto:a@b.c)")).toBe('<p><a href="mailto:a@b.c">x</a></p>');
		expect(renderMarkdown("[x](a.md)")).toBe('<p><a href="/view/a.md">x</a></p>');
		expect(renderMarkdown("[x](#anchor)")).toBe('<p><a href="#anchor">x</a></p>');
		expect(renderMarkdown('[x](a.md "title")')).toBe('<p><a href="/view/a.md" title="title">x</a></p>');
	});

	test("drops unsafe link schemes to plain text", () => {
		expect(renderMarkdown("[x](javascript:alert(1))")).toBe("<p>x</p>");
		expect(renderMarkdown("[x](data:text/html,<script>)")).toBe("<p>x</p>");
	});

	test("renders autolinks", () => {
		expect(renderMarkdown("<https://example.com>")).toBe(
			'<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>',
		);
	});

	test("resolves links and images relative to the file's directory", () => {
		expect(renderMarkdown("[x](other.md)", "docs/sub")).toBe('<p><a href="/view/docs/sub/other.md">x</a></p>');
		expect(renderMarkdown("![i](i.png)", "docs")).toBe(
			'<p><img class="md-img" src="/raw/docs/i.png" alt="i" loading="lazy" decoding="async"></p>',
		);
		expect(renderMarkdown("![i](</img/a b.png>)", "docs")).toBe(
			'<p><img class="md-img" src="/raw/img/a%20b.png" alt="i" loading="lazy" decoding="async"></p>',
		);
	});

	test("drops image paths that escape the root", () => {
		expect(renderMarkdown("![i](../../secret.png)", "docs")).toBe("<p>i</p>");
		expect(renderMarkdown("![i](../secret.png)")).toBe("<p>i</p>");
	});

	test("renders external images as links instead of loading them", () => {
		expect(renderMarkdown("![i](https://example.com/i.png)")).toBe(
			'<p><a href="https://example.com/i.png" target="_blank" rel="noopener noreferrer">i</a></p>',
		);
	});
});

describe("renderMarkdown safety", () => {
	test("escapes raw HTML instead of emitting it", () => {
		const html = renderMarkdown("<script>alert(1)</script>");
		expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
		expect(html).not.toContain("<script>");
	});

	test("escapes quotes and angle brackets in link labels", () => {
		expect(renderMarkdown("[<img src=x onerror=alert(1)>](https://e)")).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	test("handles CRLF and empty input", () => {
		expect(renderMarkdown("# a\r\n\r\nb")).toBe("<h1>a</h1>\n<p>b</p>");
		expect(renderMarkdown("")).toBe("");
	});
});
