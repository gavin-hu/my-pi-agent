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
	lines: text("const grace = 1000;", "mount(prefix, grace);"),
	binary: false,
	truncated: false,
	...over,
});

describe("the file view", () => {
	test("draws the whole file on the diff's gutter, with a way back to the comparison", () => {
		const html = renderReviewFile(input());
		expect(html).toContain('data-path="lib/http/mount.ts"');
		expect(html).toContain("browse-diff-no");
		expect(html).toContain("mount(prefix, grace);");
		// The way back names the comparison, so the reader lands on the review they were in.
		expect(html).toContain('id="rv-back" href="/review/new?scope=branch"');
		// The review's own page: no address into another page's prefix.
		expect(html).not.toContain('href="/files');
	});

	test("says a binary file has no text, and draws no code block for it", () => {
		const html = renderReviewFile(input({ binary: true, lines: [] }));
		expect(html).toContain("A binary file; there is no text to show.");
		expect(html).not.toContain('<pre class="bf-code');
	});

	test("says how much of a file the cap left, in the singular and the plural", () => {
		expect(renderReviewFile(input({ truncated: true, lines: text("one") }))).toContain(
			"Showing the first 1 line of this file.",
		);
		expect(renderReviewFile(input({ truncated: true }))).toContain("Showing the first 2 lines of this file.");
	});

	test("escapes the path it prints and the text it draws", () => {
		const html = renderReviewFile(input({ rel: "a<b>.ts", lines: text("if (a < b) {") }));
		expect(html).toContain("a&lt;b&gt;.ts");
		expect(html).toContain("a &lt; b");
		expect(html).not.toContain("<b>");
	});
});
