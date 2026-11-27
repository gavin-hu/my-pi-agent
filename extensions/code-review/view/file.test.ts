import { describe, expect, test } from "bun:test";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { comparisonOf } from "../../../test/helpers/review-scope.ts";
import { renderReviewFile } from "./file.ts";

/** One file's context lines, numbered the way `ReviewReader.text` hands them over. */
function text(...lines: string[]): DiffLine[] {
	return lines.map((body, index) => ({ kind: "ctx", text: body, oldNo: index + 1, newNo: index + 1 }));
}

const input = (over: Partial<Parameters<typeof renderReviewFile>[0]> = {}) => ({
	base: "/review",
	scope: comparisonOf("branch", "origin/main"),
	preset: "branch" as const,
	rel: "lib/http/mount.ts",
	repo: "my-pi-agent",
	comparison: "bd2c0655 → 5458259",
	lines: text("const grace = 1000;", "mount(prefix, grace);"),
	binary: false,
	truncated: false,
	...over,
});

describe("the file view", () => {
	test("draws the whole file on one numbered gutter, with a way back to the comparison", () => {
		const html = renderReviewFile(input());
		expect(html).toContain('data-path="lib/http/mount.ts"');
		expect(html).toContain("rv-diff--file");
		// One number per row: a file's old and new sides are the same number, and its rows carry no sign.
		const pre = html.slice(html.indexOf('<pre class="bf-code'), html.indexOf("</pre>"));
		expect([...pre.matchAll(/browse-diff-no/g)]).toHaveLength(2);
		expect(pre).not.toContain("browse-diff-sign");
		expect(html).toContain("mount(prefix, grace);");
		// The way back names the comparison, so the reader lands on the review they were in.
		expect(html).toContain('id="rv-back" href="/review/new?scope=branch"');
		// The review's own page: no address into another page's prefix.
		expect(html).not.toContain('href="/files');
	});

	test("wraps by default, and draws only the controls its own script wires", () => {
		const html = renderReviewFile(input());
		expect(html).toContain('data-wrap="true"');
		expect(html).toContain('id="rv-wrap"');
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain('src="/review/file.js"');
		// A page that serves no key sheet draws no trigger for one; the toggle is the header's.
		expect(html).not.toContain('id="keys-open"');
		expect(html).toContain('id="theme-toggle"');
	});

	test("names the repository it read and the comparison it came from", () => {
		const html = renderReviewFile(input());
		expect(html).toContain("my-pi-agent");
		expect(html).toContain("bd2c0655 → 5458259");
	});

	test("makes the text a named tab stop, so the scroll region is reachable", () => {
		const html = renderReviewFile(input());
		expect(html).toContain('tabindex="0"');
		expect(html).toContain('aria-label="lib/http/mount.ts"');
	});

	test("says a binary file has no text, and draws no code block for it", () => {
		const html = renderReviewFile(input({ binary: true, lines: [] }));
		expect(html).toContain("A binary file; there is no text to show.");
		expect(html).not.toContain('<pre class="bf-code');
	});

	test("says how much of a file the cap left, and how much the file holds", () => {
		expect(renderReviewFile(input({ truncated: true, lines: text("one"), totalLines: 9149 }))).toContain(
			"Showing the first 1 of 9149 lines.",
		);
		// A read the byte cap cut cannot know the total, so it names only what it showed.
		expect(renderReviewFile(input({ truncated: true, lines: text("one") }))).toContain(
			"Showing the first 1 line of a larger file.",
		);
	});

	test("says an empty file is empty, rather than drawing nothing at all", () => {
		const html = renderReviewFile(input({ lines: [] }));
		expect(html).toContain("This file is empty.");
		expect(html).not.toContain('<pre class="bf-code');
	});

	test("escapes the path it prints and the text it draws", () => {
		const html = renderReviewFile(input({ rel: "a<b>.ts", lines: text("if (a < b) {") }));
		expect(html).toContain("a&lt;b&gt;.ts");
		expect(html).toContain("a &lt; b");
		expect(html).not.toContain("<b>");
	});
});
