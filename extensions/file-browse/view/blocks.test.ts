/**
 * The rendered Markdown's blocks: headings and their anchors, fences, lists, quotes, rules and
 * tables. Split from the page's suite, which had grown past the named height; the inline half
 * stays there, and this file is the block half's home.
 */

import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

describe("Markdown blocks", () => {
	test("demotes headings, keeps their text, and suffixes repeated slugs", () => {
		expect(renderMarkdown("# Title")).toContain('<h2 id="title">Title</h2>');
		expect(renderMarkdown("### Three ###")).toContain('<h4 id="three">Three</h4>');
		expect(renderMarkdown("# C#")).toContain('<h2 id="c">C#</h2>');
		expect(renderMarkdown("# Hello, World!")).toContain('<h2 id="hello-world">Hello, World!</h2>');

		const repeated = renderMarkdown("# Setup\n\n## Setup");
		expect(repeated).toContain('<h2 id="setup">Setup</h2>');
		expect(repeated).toContain('<h3 id="setup-1">Setup</h3>');
	});

	test("renders paragraphs and hard breaks", () => {
		expect(renderMarkdown("one\ntwo")).toContain("<p>one\ntwo</p>");
		expect(renderMarkdown("one  \ntwo")).toContain("one<br>");
		expect(renderMarkdown("one\\\ntwo")).toContain("one<br>");
	});

	test("highlights fenced code with a known language and escapes the body", () => {
		const html = renderMarkdown("```js\nconst x = 1 < 2;\n```");
		expect(html).toContain('<pre class="md-code"><code class="language-js">');
		expect(html).toContain('<span class="tok-keyword">const</span>');
		expect(html).toContain("&lt;");
		expect(renderMarkdown("```\nplain\n```")).toContain('<pre class="md-code"><code>plain</code></pre>');
	});

	test("leaves an unknown fence language unhighlighted", () => {
		const html = renderMarkdown("```mystery\nconst x = 1;\n```");
		expect(html).toContain('class="language-mystery"');
		expect(html).not.toContain("tok-keyword");
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

	test("renders thematic breaks and blockquotes", () => {
		expect(renderMarkdown("---")).toContain("<hr>");
		expect(renderMarkdown("* * *")).toContain("<hr>");
		expect(renderMarkdown("> quoted")).toContain("<blockquote><p>quoted</p></blockquote>");
		expect(renderMarkdown("> one\n>\n> two")).toContain("<blockquote><p>one</p>\n<p>two</p></blockquote>");
		// One blank line between two quote runs is one blockquote: the page's rule, which the
		// scan keeps as two blocks so the review's anchors still account for every line.
		expect(renderMarkdown("> one\n\n> two")).toContain("<blockquote><p>one</p>\n<p>two</p></blockquote>");
	});

	test("renders unordered, ordered, nested, and task lists", () => {
		expect(renderMarkdown("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
		expect(renderMarkdown("1. a\n2. b")).toContain("<ol><li>a</li><li>b</li></ol>");

		const nested = renderMarkdown("- a\n  - b\n- c");
		expect(nested).toContain("<ul><li>a\n<ul><li>b</li></ul></li>");
		expect(nested).toContain("<li>c</li>");

		const tasks = renderMarkdown("- [x] done\n- [ ] todo");
		expect(tasks).toContain('<li class="task done">');
		expect(tasks).toContain('<input class="md-check" type="checkbox" disabled checked> done');
		expect(tasks).toContain('<li class="task">');
		expect(tasks).toContain('<input class="md-check" type="checkbox" disabled> todo');
	});

	test("renders tables with alignment, a scroll wrapper, and column scopes", () => {
		const html = renderMarkdown("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
		expect(html).toContain('<div class="md-table-frame"><div class="md-table-wrap"><table class="md-table">');
		expect(html).toContain('<th scope="col" class="md-left">a</th>');
		expect(html).toContain('<th scope="col" class="md-right">b</th>');
		expect(html).toContain('<td class="md-left">1</td>');
		expect(html).toContain('<td class="md-right">2</td>');
	});

	test("treats a bad delimiter row as a paragraph and a pipe list item as a list", () => {
		expect(renderMarkdown("| a | b |\nnot a table")).not.toContain("<table");
		expect(renderMarkdown("| a | b |\n| --- |\n| 1 | 2 |")).not.toContain("<table");

		const piped = renderMarkdown("- | a | b |\n  | --- | --- |\n  | 1 | 2 |");
		expect(piped).toContain("<ul><li>");
		expect(piped).toContain('<table class="md-table">');
		expect(piped).not.toContain('<th scope="col">-</th>');
	});
});
