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

	test("highlights fenced code with a known language and escapes the body", () => {
		const html = renderMarkdown("```js\nconst x = 1 < 2;\n```");
		expect(html).toBe(
			'<pre class="md-code"><code class="language-js"><span class="tok-keyword">const</span> x = <span class="tok-number">1</span> &lt; <span class="tok-number">2</span>;</code></pre>',
		);
		expect(renderMarkdown("```\nplain\n```")).toBe('<pre class="md-code"><code>plain</code></pre>');
	});

	test("leaves an unknown fence language unhighlighted", () => {
		expect(renderMarkdown("```mystery\nconst x = 1;\n```")).toBe(
			'<pre class="md-code"><code class="language-mystery">const x = 1;</code></pre>',
		);
	});

	test("resolves a long-form fence language and carries state across its lines", () => {
		const html = renderMarkdown("```typescript\n/* note\ndone */\nconst x = 1;\n```");
		expect(html).toContain('<span class="tok-comment">/* note</span>');
		expect(html).toContain('<span class="tok-comment">done */</span>');
		expect(html).toContain('<span class="tok-keyword">const</span>');
	});

	test("escapes a highlighted fence body so it cannot inject markup", () => {
		const html = renderMarkdown('```js\nconst a = "</span><img src=x>";\n```');
		expect(html).toContain("&lt;/span&gt;&lt;img");
		expect(html).not.toContain("<img");
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

	test("renders tables with alignment, a scroll wrapper, and column scopes", () => {
		const html = renderMarkdown("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
		expect(html).toContain('<div class="md-table-wrap"><table class="md-table">');
		expect(html).toContain('<th scope="col" class="md-left">a</th>');
		expect(html).toContain('<th scope="col" class="md-right">b</th>');
		expect(html).toContain('<td class="md-left">1</td>');
		expect(html).toContain('<td class="md-right">2</td>');
	});

	test("treats a non-delimiter second line as a paragraph, not a table", () => {
		expect(renderMarkdown("| a | b |\nnot a table")).toBe("<p>| a | b |\nnot a table</p>");
	});

	test("rejects a delimiter row whose cell count differs from the header", () => {
		expect(renderMarkdown("| a | b |\n| --- |\n| 1 | 2 |")).toBe("<p>| a | b |\n| --- |\n| 1 | 2 |</p>");
	});

	test("treats a list item whose content starts with a pipe as a list", () => {
		const html = renderMarkdown("- | a | b |\n  | --- | --- |\n  | 1 | 2 |");
		expect(html).toContain("<ul><li>");
		expect(html).toContain('<table class="md-table">');
		expect(html).not.toContain('<th scope="col">-</th>');
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

	test("resolves reference-style links and drops their definitions", () => {
		const html = renderMarkdown('See [pi][p] and [docs][].\n\n[p]: https://pi.dev\n[docs]: /guide "Guide"');
		expect(html).toContain('<a href="https://pi.dev" target="_blank" rel="noopener noreferrer">pi</a>');
		expect(html).toContain('<a href="/view/guide" title="Guide">docs</a>');
		expect(html).not.toContain("[p]:");
		expect(html).not.toContain("[docs]:");
	});

	test("resolves a shortcut reference, folding its label", () => {
		expect(renderMarkdown("see [Pi Store]\n\n[pi   store]: https://pi.dev")).toBe(
			'<p>see <a href="https://pi.dev" target="_blank" rel="noopener noreferrer">Pi Store</a></p>',
		);
	});

	test("resolves a reference image", () => {
		expect(renderMarkdown("![logo][l]\n\n[l]: img/a.png")).toBe(
			'<p><img class="md-img" src="/raw/img/a.png" alt="logo" loading="lazy" decoding="async"></p>',
		);
	});

	test("leaves an unresolved reference as literal text", () => {
		expect(renderMarkdown("[x][nope]")).toBe("<p>[x][nope]</p>");
	});

	test("does not read a link definition out of a fence", () => {
		expect(renderMarkdown("```\n[p]: https://pi.dev\n```")).toBe(
			'<pre class="md-code"><code>[p]: https://pi.dev</code></pre>',
		);
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

describe("renderMarkdown character references", () => {
	test("decodes numeric and named references as literal text", () => {
		expect(renderMarkdown("AT&amp;T and &copy;")).toBe("<p>AT&amp;T and ©</p>");
		expect(renderMarkdown("&#65;&#x42; &#x1F600;")).toBe("<p>AB 😀</p>");
	});

	test("does not let a reference become markup", () => {
		expect(renderMarkdown("&#42;x&#42; and &#35; heading")).toBe("<p>*x* and # heading</p>");
	});

	test("keeps an unknown or invalid reference literal", () => {
		expect(renderMarkdown("&foo;")).toBe("<p>&amp;foo;</p>");
		expect(renderMarkdown("&toString; &constructor;")).toBe("<p>&amp;toString; &amp;constructor;</p>");
		expect(renderMarkdown("&#xD800; &#1114112;")).toBe("<p>\uFFFD \uFFFD</p>");
	});

	test("leaves a reference in a code span undecoded", () => {
		expect(renderMarkdown("`&amp;`")).toBe("<p><code>&amp;amp;</code></p>");
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
