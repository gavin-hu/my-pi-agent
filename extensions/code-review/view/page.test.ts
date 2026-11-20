import { describe, expect, test } from "bun:test";
import type { ReviewSnapshot } from "../git/diff.ts";
import type { Review } from "../review/store.ts";
import { renderReviewPage, renderReviewProblem } from "./page.ts";

/** A two-file snapshot with a hunk, a context row, and a deleted line. */
function snapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
	return {
		scope: "base",
		base: "origin/main",
		label: "origin/main...HEAD",
		files: [
			{
				rel: "lib/http/mount.ts",
				status: "M",
				add: 1,
				del: 1,
				binary: false,
				truncated: false,
				lines: [
					{ kind: "hunk", text: "@@ -1,2 +1,2 @@" },
					{ kind: "ctx", text: "const grace = 1000;", oldNo: 1, newNo: 1 },
					{ kind: "del", text: "mount(prefix);", oldNo: 2 },
					{ kind: "add", text: "mount(prefix, grace);", newNo: 2 },
				],
			},
			{
				rel: "docs/serve.md",
				status: "A",
				add: 2,
				del: 0,
				binary: false,
				truncated: true,
				lines: [{ kind: "add", text: "new", newNo: 1 }],
			},
		],
		omitted: 0,
		insertions: 3,
		deletions: 1,
		fingerprint: "abc123",
		...overrides,
	};
}

/** A review with one draft on the new side of the deleted line's neighbour. */
function review(overrides: Partial<Review> = {}): Review {
	return {
		id: "r7c1",
		scope: "base",
		base: "origin/main",
		label: "origin/main...HEAD",
		rev: "abc123",
		comments: [
			{
				id: "c1",
				rel: "lib/http/mount.ts",
				line: 2,
				side: "new",
				body: "name the ceiling <too>",
				state: "draft",
				at: 1,
			},
		],
		reviewed: ["docs/serve.md"],
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

const input = (over: { review?: Review; snapshot?: ReviewSnapshot } = {}) => ({
	base: "/review",
	repo: "my-pi-agent",
	root: "/Users/someone/my-pi-agent",
	token: "tok-123",
	snapshot: over.snapshot ?? snapshot(),
	...(over.review === undefined ? {} : { review: over.review }),
});

describe("the review page", () => {
	test("draws every changed file under its own path, with the diff's rows", () => {
		const html = renderReviewPage(input());
		expect(html).toContain('data-path="lib/http/mount.ts"');
		expect(html).toContain('data-path="docs/serve.md"');
		expect(html).toContain('class="rv-rail" href="#rv-file-0"');
		expect(html).toContain("bf-diff-line--del");
		expect(html).toContain("mount(prefix, grace);");
		expect(html).toContain("origin/main...HEAD");
		expect(html).toContain("snapshot abc123");
	});

	test("carries the review as data, with the token and no markup from a comment", () => {
		const html = renderReviewPage(input({ review: review() }));
		const start = html.indexOf('id="rv-data">');
		const island = html.slice(start, html.indexOf("</script>", start));
		expect(island).toContain('"token":"tok-123"');
		expect(island).toContain('"id":"r7c1"');
		expect(island).toContain("name the ceiling");
		// A body cannot close the script it is carried in, and a tag stays text.
		expect(island).not.toContain("</script>");
		expect(island).toContain("\\u003ctoo>");
		expect(island).not.toContain("<too>");
	});

	test("names each file's state: a comment owed is commented, a mark is reviewed", () => {
		const html = renderReviewPage(input({ review: review() }));
		expect(html).toContain('data-path="lib/http/mount.ts" data-state="commented"');
		expect(html).toContain('data-path="docs/serve.md" data-state="reviewed"');
		expect(html).toContain('data-reviewed="docs/serve.md" checked');
		expect(html).toContain("1 draft");
		expect(html).toContain("Send feedback 1");
	});

	test("says a binary change has no text, and that a cap cut a file short", () => {
		const binary = snapshot();
		binary.files[0] = { ...binary.files[0], binary: true, lines: [], add: 0, del: 0 };
		const html = renderReviewPage(input({ snapshot: binary }));
		expect(html).toContain("A binary or unreadable change");
		expect(html).toContain("Showing the first 1 diff lines");
	});

	test("says when the file cap left files out, and when the tree moved", () => {
		const html = renderReviewPage(input({ snapshot: snapshot({ omitted: 3 }), review: review({ rev: "OLDER" }) }));
		expect(html).toContain("3 more files");
		expect(html).toContain("The diff moved");
	});

	test("draws an empty scope as an empty state instead of a diff", () => {
		const html = renderReviewPage(input({ snapshot: snapshot({ files: [], insertions: 0, deletions: 0 }) }));
		expect(html).toContain("No changes in this scope.");
		expect(html).not.toContain('class="rv-file"');
	});

	test("offers every scope as a link, with the current one selected", () => {
		const html = renderReviewPage(input());
		for (const scope of ["base", "last", "staged", "worktree"]) {
			expect(html).toContain(`/review/new?scope=${scope}`);
		}
		expect(html).toContain('aria-selected="true">base</a>');
	});

	test("a problem page names the reason and offers the way back", () => {
		const html = renderReviewProblem("/review", "No diff to review", 'no base branch found — set "base"');
		expect(html).toContain("No diff to review");
		expect(html).toContain("no base branch found");
		expect(html).toContain('href="/review/new"');
	});
});
