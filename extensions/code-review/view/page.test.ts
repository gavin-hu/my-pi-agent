import { describe, expect, test } from "bun:test";
import type { ReviewSnapshot } from "../git/diff.ts";
import { fileHref } from "../links.ts";
import type { Review } from "../review/store.ts";
import { REVIEW_SCOPES } from "../scope.ts";
import { comparisonLine, renderReviewPage, renderReviewProblem, reviewData } from "./page.ts";

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
		// The footer names the comparison it holds, not the fingerprint that keys a write.
		expect(html).not.toContain(`snapshot ${snapshot().fingerprint}`);
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
		expect(html).toContain('data-reviewed="docs/serve.md" aria-label="Mark docs/serve.md reviewed" checked');
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

	test("offers every scope as a link, with the current one selected and its title saying what it compares", () => {
		const html = renderReviewPage(input());
		for (const scope of REVIEW_SCOPES) {
			expect(html).toContain(`/review/new?scope=${scope}`);
		}
		// The segment says the word the URL, the command and the tool say.
		expect(html).toContain('aria-selected="true" title="the branch against its base">base</a>');
		expect(html).toContain('title="HEAD~1...HEAD — the last commit">last</a>');
	});

	test("names what the footer holds, and never a sha it does not have", () => {
		expect(comparisonLine(snapshot())).toBe("origin/main...HEAD");
		expect(comparisonLine({ ...snapshot(), head: "a5efbb9" })).toBe("origin/main...HEAD · HEAD a5efbb9");
		expect(comparisonLine({ ...snapshot(), head: "a5efbb9", baseSha: "3f9c21a" })).toBe(
			"origin/main 3f9c21a → HEAD a5efbb9",
		);
		const html = renderReviewPage(input({ snapshot: snapshot({ head: undefined, baseSha: undefined }) }));
		expect(html).not.toContain("undefined");
	});

	test("hides the draft chip and the review id until each has something to say", () => {
		const empty = renderReviewPage(input());
		expect(empty).toContain('id="rv-state" hidden=""');
		expect(empty).toContain('id="rv-id" hidden=""');
		const withWork = renderReviewPage(input({ review: review() }));
		expect(withWork).toContain('id="rv-state"');
		expect(withWork).not.toContain('id="rv-state" hidden');
		expect(withWork).toContain("review&#39;s id: r7c1");
	});

	/**
	 * The markup a reader relies on before any script runs, and which no filter case can see:
	 * a row that names its path on the hover, a directory that keeps its leaf in view (an rtl
	 * line box around a bdi path — the trap the card's risk section names), the count a screen
	 * reader is told when it changes, and both empty-state hooks the client reveals.
	 */
	test("names each row's path, truncates its directory, and announces the count", () => {
		const html = renderReviewPage(input());
		expect(html).toContain('title="lib/http/mount.ts"');
		expect(html).toContain('<span class="rv-rail__dir" dir="rtl"><bdi>lib/http</bdi></span>');
		expect(html).toContain('id="rv-file-count" aria-live="polite"');
		expect(html).toContain('aria-label="Mark lib/http/mount.ts reviewed"');
		expect(html).toContain('id="rv-rail-empty" hidden');
		expect(html).toContain('id="rv-filter-note" hidden');
	});

	test("draws one file when the address names it, with one rail row and the way back", () => {
		const html = renderReviewPage({ ...input(), file: "lib/http/mount.ts" });
		expect(html.match(/class="rv-file"/g)).toHaveLength(1);
		expect(html.match(/class="rv-rail"/g)).toHaveLength(1);
		expect(html).toContain('data-path="lib/http/mount.ts"');
		expect(html).not.toContain("docs/serve.md");
		// The way back is the comparison alone: the file is what is being left behind.
		expect(html).toContain('id="rv-all-files"');
		expect(html).toContain('href="/review/new?scope=base"');
		expect(html).not.toContain("file=lib/http/mount.ts");
		// The count still names the scope, not the one file drawn from it.
		expect(html).toContain("1 of 2 files");
	});

	test("draws the whole scope when the named file is not in it", () => {
		const html = renderReviewPage({ ...input(), file: "gone.ts" });
		expect(html.match(/class="rv-file"/g)).toHaveLength(2);
		expect(html).not.toContain('id="rv-all-files"');
	});

	test("a focused page keeps the scope's rev, so the full page's writes are accepted", () => {
		// The one assertion that makes the focus a view: the snapshot is the whole scope
		// whether one file is drawn or all of them, so `store.write`'s `rev` comparison
		// cannot see a difference between the two pages.
		const full = reviewData(input());
		const focused = reviewData({ ...input(), file: "docs/serve.md" });
		expect(focused.rev).toBe(full.rev);
		expect(focused.rev).toBe("abc123");
	});

	test("each file's head offers the review's own whole-file view, and nothing from another page", () => {
		const html = renderReviewPage(input());
		// The attribute is HTML-escaped for the document; a browser decodes it back before the route
		// reads it, so the round trip is asserted on the decoded form.
		const href = (/class="bf-btn" href="([^"]*\/review\/file\?[^"]*)"/.exec(html)?.[1] ?? "").replaceAll("&amp;", "&");
		// The round trip is the contract: the router reads these two keys back as the path and
		// the comparison, so the encoding belongs to `fileHref` and not to the caller.
		const url = new URL(href, "http://127.0.0.1");
		expect(url.pathname).toBe("/review/file");
		expect(url.searchParams.get("path")).toBe("lib/http/mount.ts");
		expect(url.searchParams.get("scope")).toBe("base");
		expect(href).toBe(fileHref("lib/http/mount.ts", "base"));
		expect(html).not.toContain('href="/files');
		expect(html).not.toContain(" download");
	});

	test("a focused page still counts the comments it does not draw", () => {
		// The Limits sentence has to be a fact: a draft on a hidden file is hidden from the
		// page and still the reader's, so the island and the send button keep it.
		const both = reviewData({ ...input({ review: review() }), file: "docs/serve.md" });
		expect(both.comments.map((comment) => comment.rel)).toEqual(["lib/http/mount.ts"]);
		const html = renderReviewPage({ ...input({ review: review() }), file: "docs/serve.md" });
		expect(html.match(/class="rv-file"/g)).toHaveLength(1);
		// The one section is the file asked for; the draft on the other file is still the
		// reader's, so the button that sends it still counts it.
		expect(html).toContain('data-path="docs/serve.md"');
		expect(html).toContain("Send feedback 1");
	});

	test("a problem page names the reason and offers the way back", () => {
		const html = renderReviewProblem("/review", "No diff to review", 'no base branch found — set "base"');
		expect(html).toContain("No diff to review");
		expect(html).toContain("no base branch found");
		expect(html).toContain('href="/review/new"');
	});
});
