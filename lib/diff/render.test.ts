/**
 * The diff renderer: gutters, signs, hunk sections, and per-side highlighting.
 *
 * Every case here moved with the body from the browse suite, unchanged: the class
 * names they assert are the renderer's, not a page's.
 */

import { describe, expect, test } from "bun:test";
import { renderDiffLines } from "./render.ts";

describe("diff rendering", () => {
	test("renders diff lines with a gutter, a sign, and a kind class", () => {
		const html = renderDiffLines([
			{ kind: "meta", text: "diff --git a/a b/a" },
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "del", text: "old", oldNo: 2 },
			{ kind: "add", text: "new", newNo: 2 },
			{ kind: "note", text: "\\ No newline at end of file" },
		]);
		expect(html).toContain("bf-diff-line--hunk");
		expect(html).toContain("bf-diff-line--add");
		expect(html).toContain("bf-diff-line--del");
		expect(html).toContain("bf-diff-line--note");
		expect(html).toContain('<span class="browse-diff-no" aria-hidden="true">2</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">+</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">-</span>');
	});

	test("wraps each hunk and its body in a bounded section", () => {
		const html = renderDiffLines([
			{ kind: "meta", text: "diff --git a/a b/a" },
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "hunk", text: "@@ -9 +9 @@" },
			{ kind: "add", text: "new", newNo: 9 },
		]);
		expect(html).toContain('<span class="bf-diff-hunk" id="hunk-1" data-hunk="1">');
		expect(html).toContain('<span class="bf-diff-hunk" id="hunk-2" data-hunk="2">');
		expect((html.match(/class="bf-diff-hunk"/g) ?? []).length).toBe(2);
		expect(html).toStartWith('<span class="bf-code__line bf-diff-line bf-diff-line--meta"');
		expect(html).toEndWith("</span></span>");
	});

	test("escapes diff content and highlights a hunk's context lines", () => {
		const escaped = renderDiffLines([{ kind: "add", text: "<img src=x onerror=alert(1)>", newNo: 1 }]);
		expect(escaped).not.toContain("<img");
		expect(escaped).toContain("&lt;img");

		const highlighted = renderDiffLines(
			[
				{ kind: "hunk", text: "@@ -1,3 +1,3 @@" },
				{ kind: "ctx", text: "const keep = 1;", oldNo: 1, newNo: 1 },
				{ kind: "del", text: "const old = 2;", oldNo: 2 },
				{ kind: "add", text: "const next = 2;", newNo: 2 },
				{ kind: "ctx", text: "const after = 3;", oldNo: 3, newNo: 3 },
			],
			"ts",
		);
		expect(highlighted.match(/tok-keyword/g)?.length).toBe(4);
		expect(highlighted).toContain("keep = ");
		expect(highlighted).toContain("after = ");
		expect((highlighted.match(/bf-diff-line--ctx/g) ?? []).length).toBe(2);
		expect((highlighted.match(/bf-diff-line--add/g) ?? []).length).toBe(1);
		expect((highlighted.match(/bf-diff-line--del/g) ?? []).length).toBe(1);
	});
});
