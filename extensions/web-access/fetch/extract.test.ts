/**
 * The HTML-to-text pass shared by `web_fetch`: entity decoding, the title, and
 * the readable-text extraction — chrome removal, the `<main>` preference, links,
 * images, table rows, and the attribute span a quoted `>` must not end.
 */

import { describe, expect, test } from "bun:test";
import { decodeEntities, stripTagsAndDecode } from "../html.ts";
import { extractReadable, extractTitle } from "./extract.ts";

const FIXTURE = `<!doctype html>
<html>
<head><title>Pi &amp; Co &#x27;quoted&#x27;</title><style>.a{color:red}</style></head>
<body>
  <nav>Nav junk <a href="/nav">Nav</a></nav>
  <script>var x = "<p>not text</p>";</script>
  <header>Header junk</header>
  <article>
    <h1>Heading</h1>
    <p>First paragraph with <b>bold</b> and a <a href="/relative">relative link</a>.</p>
    <ul><li>One</li><li>Two</li></ul>
    <p>Second <a href="https://ext.example/x">external</a> and <a href="javascript:void(0)">bad link</a>.</p>
    <img alt="A picture">
  </article>
  <footer>Footer junk</footer>
</body>
</html>`;

describe("decodeEntities", () => {
	test("decodes named and numeric entities", () => {
		expect(decodeEntities("A &amp; B &#39;c&#39; &#x2764;")).toBe("A & B 'c' ❤");
	});
});

describe("stripTagsAndDecode", () => {
	test("keeps the text after a > quoted inside an attribute", () => {
		expect(stripTagsAndDecode('<div title="a > b">Uno</div>')).toBe("Uno");
	});
});

describe("extractTitle", () => {
	test("reads and decodes the title tag", () => {
		expect(extractTitle(FIXTURE)).toBe("Pi & Co 'quoted'");
	});

	test("prefers og:title", () => {
		expect(extractTitle('<title>Plain</title><meta property="og:title" content="OG &amp; Title">')).toBe("OG & Title");
	});
});

describe("extractReadable", () => {
	const page = extractReadable(FIXTURE, "https://base.example/dir/page");

	test("keeps headings, paragraphs, and list items", () => {
		expect(page.text).toContain("# Heading");
		expect(page.text).toContain("First paragraph with bold");
		expect(page.text).toContain("- One");
		expect(page.text).toContain("- Two");
	});

	test("resolves relative links and drops unusable ones", () => {
		expect(page.text).toContain("[relative link](https://base.example/relative)");
		expect(page.text).toContain("[external](https://ext.example/x)");
		expect(page.text).toContain("bad link");
		expect(page.text).not.toContain("javascript:");
	});

	test("turns images into alt text", () => {
		expect(page.text).toContain("[A picture]");
	});

	test("keeps a table row's cells apart, one row per line", () => {
		const html = `<body><table><tr><th>Name</th><th>Score</th></tr><tr><td>Ada</td><td>42</td></tr><tr><td>Bob</td><td>7</td></tr></table></body>`;
		const text = extractReadable(html, "https://x/").text;
		expect(text).toContain("Name | Score");
		expect(text).toContain("Ada | 42");
		expect(text).toContain("Bob | 7");
		expect(text).not.toContain("Ada42");
	});

	test("keeps the caption of an image wrapped in a link", () => {
		const linked = `<body><p><a href="https://e/x"><img alt="Chart of retries"></a></p></body>`;
		expect(extractReadable(linked, "https://x/").text).toContain("[Chart of retries](https://e/x)");
		const unusable = `<body><p><a href="javascript:void(0)"><img alt="Chart"></a></p></body>`;
		const text = extractReadable(unusable, "https://x/").text;
		expect(text).toContain("Chart");
		expect(text).not.toContain("javascript:");
	});

	test("does not end a tag at a > inside a quoted attribute", () => {
		const html = `<body><p><a title="a > b" href="https://e/x">Go</a></p><img title="a > b" alt="Pic"></body>`;
		const text = extractReadable(html, "https://x/").text;
		expect(text).toContain("[Go](https://e/x)");
		expect(text).toContain("[Pic]");
		expect(text).not.toContain('href="');
	});

	test("removes scripts, styles, nav, header, and footer", () => {
		expect(page.text).not.toContain("color:red");
		expect(page.text).not.toContain("not text");
		expect(page.text).not.toContain("Nav junk");
		expect(page.text).not.toContain("Header junk");
		expect(page.text).not.toContain("Footer junk");
	});

	test("prefers the largest main/article over surrounding chrome", () => {
		const html = `<body><main><p>small</p></main><article><p>${"big ".repeat(50)}</p></article></body>`;
		expect(extractReadable(html, "https://x/").text).toContain("big big");
	});

	test("falls back to the body when the largest article is only a fragment", () => {
		const filler = `<p>${"real content ".repeat(40)}</p>`;
		const html = `<body><article><p>teaser</p></article>${filler}</body>`;
		const text = extractReadable(html, "https://x/").text;
		expect(text).toContain("real content");
		expect(text).toContain("teaser");
	});

	test("preserves CJK text", () => {
		const cjk = extractReadable("<body><p>广州 早茶 文化</p></body>", "https://x/").text;
		expect(cjk).toContain("广州 早茶 文化");
	});
});
