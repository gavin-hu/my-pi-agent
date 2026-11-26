import { describe, expect, test } from "bun:test";
import type { ReviewSnapshot } from "../git/diff.ts";
import { fileHref } from "../links.ts";
import type { Review } from "../review/store.ts";
import { comparisonOf } from "../../../test/helpers/review-scope.ts";
import { REVIEW_PRESETS } from "../scope.ts";
import { comparisonLine, renderReviewPage, renderReviewProblem, reviewData } from "./page.ts";

/** A two-file snapshot with a hunk, a context row, and a deleted line. */
function snapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
	return {
		scope: comparisonOf("branch", "origin/main"),
		fromSha: "3f9c21a",
		toSha: "a5efbb9",
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
		scope: comparisonOf("branch", "origin/main"),
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
	preset: "branch" as const,
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
		// The breakpoint the sheet folds at is the one the client reads: a width spelled in both
		// would let the band and the wrap seed disagree.
		expect(island).toContain('"narrow":900');
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

	test("counts the drafts as one or many, in the tab title and on the Send button", () => {
		// On the page the draft count has one home, the Send button; the tab title keeps its own,
		// because a backgrounded tab saying "2 drafts" is the one fact a reader can act on without
		// looking at the page. Each count is counted with its boundary: `toContain("1 draft")` is
		// green on "1 drafts".
		const many = renderReviewPage(
			input({
				review: review({
					comments: [
						...review().comments,
						{
							id: "c2",
							rel: "lib/http/mount.ts",
							line: 2,
							side: "new",
							body: "and the floor",
							state: "draft",
							at: 2,
						},
					],
				}),
			}),
		);
		expect(many).toContain("<title>review · my-pi-agent · 2 drafts</title>");
		expect(many).toContain("Send feedback 2");
		// One, not two: the footer's copy left with the sentence that carried it.
		expect(many.match(/2 drafts/g)?.length).toBe(1);
		expect(many.match(/2 draft(?!s)/g)).toBeNull();

		const one = renderReviewPage(input({ review: review() }));
		expect(one).toContain("<title>review · my-pi-agent · 1 draft</title>");
		expect(one).toContain("Send feedback 1");
		expect(one.match(/1 draft(?!s)/g)?.length).toBe(1);
		expect(one.match(/1 drafts/g)).toBeNull();
	});

	test("wears the kit's sidebar, its panel and a flush search, never the control row's field", () => {
		// The rail is the shell's own sidebar: a <details> the kit folds into a band at this page's
		// width, a summary the kit hides on a desk, and a panel that scrolls on its own box.
		const html = renderReviewPage(input());
		expect(html).toContain('<details class="bf-app__sidebar rv-sidebar" open>');
		expect(html).toContain('<summary class="bf-panel__summary">Files</summary>');
		expect(html).toContain('<aside class="bf-panel rv-side">');
		// The search is the kit's plain field: `bf-field--filter` is the control row's variant, and
		// its auto margin is what pushed the field right and left the blank space beside it. The
		// sheet still ships that rule (the kit's), so the read is the sidebar's markup alone.
		const side = html.slice(html.indexOf('<details class="bf-app__sidebar'), html.indexOf("</details>"));
		expect(side).toContain('<label class="bf-field"><span class="bf-field__prompt"');
		expect(side).not.toContain("bf-field--filter");
		// The narrowing is one switch with two segments, captioned the way the plan page's is.
		expect(html).toContain('<p class="bf-tabs--view__label" id="rv-view-label">Show</p>');
		expect(html).toContain('id="rv-view-all" data-only="false" aria-pressed="true"');
		expect(html).toContain('id="rv-view-commented" data-only="true" aria-pressed="false"');
		expect(html).not.toContain("rv-only-commented");
	});

	test("pushes the page's actions to the control row's right end", () => {
		const html = renderReviewPage(input());
		expect(html).toContain('<div class="bf-app__actions">');
		expect(html).toContain('id="rv-wrap"');
		expect(html).toContain('id="rv-copy"');
		expect(html).toContain('id="rv-send"');
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

	test("offers every preset as a link, with the page's own selected and its title saying what it compares", () => {
		const html = renderReviewPage(input());
		for (const preset of REVIEW_PRESETS) {
			expect(html).toContain(`/review/new?scope=${preset}`);
		}
		// The segment says the word the URL, the command and the tool say.
		expect(html).toContain('aria-selected="true" title="the branch against its base">branch</a>');
		expect(html).toContain(
			'aria-selected="false" title="the whole change — the branch and everything uncommitted">change</a>',
		);
		expect(html).toContain('title="HEAD^...HEAD — the last commit, its first parent on a merge">last</a>');
	});

	test("names what the footer holds, and never a sha it does not have", () => {
		expect(comparisonLine(snapshot())).toBe("3f9c21a → a5efbb9");
		expect(comparisonLine({ ...snapshot(), toSha: undefined })).toBe("origin/main...HEAD");
		const html = renderReviewPage(input({ snapshot: snapshot({ fromSha: undefined, toSha: undefined }) }));
		expect(html).not.toContain("undefined");
	});

	test("gives each fact one home: the rail's head, the footer's comparison, the Send button's drafts", () => {
		// The rule this replaced put the counts and the progress in the footer. Now the rail's head
		// carries everything about files — how many are shown, their totals, and how far the review
		// has got — the footer carries only the comparison, and on the page the draft count is the
		// Send button's. The header's facts zone is the page's state: the stream it follows and the
		// way out of a page the tree moved under. The three chips that restated the footer are gone,
		// not hidden.
		const empty = renderReviewPage(input());
		const withWork = renderReviewPage(input({ review: review() }));
		for (const html of [empty, withWork]) {
			expect(html).not.toContain('id="rv-state"');
			expect(html).not.toContain('id="rv-id"');
			expect(html).not.toContain('id="rv-scope"');
			expect(html).toContain('id="reload-hint"');
			expect(html).toContain('id="rv-live"');
		}
		// One line of the rail's head, one fact each: shown/total, the progress, the totals.
		expect(withWork).toContain('id="rv-file-count" aria-live="polite">2 of 2 files');
		expect(withWork).toContain('id="rv-progress" aria-live="polite">1 of 2 reviewed');
		expect(withWork).toContain('id="rv-totals"');
		// The footer keeps the comparison and nothing that belongs to a file.
		const footer = withWork.slice(withWork.indexOf("<footer"), withWork.indexOf("</footer>"));
		expect(footer).toContain('id="rv-facts"');
		expect(footer).not.toContain("reviewed");
		expect(footer).not.toContain("files");
		expect(footer).not.toContain("draft");
		expect(withWork).toContain("Send feedback 1");
	});

	/**
	 * The markup a reader relies on before any script runs, and which no filter case can see:
	 * a row that names its path on the hover, a directory that keeps its leaf in view (an rtl
	 * line box around a bdi path — the trap the card's risk section names), the count a screen
	 * reader is told when it changes, and both empty-state hooks the client reveals.
	 */
	test("names each row's path and state, truncates its directory, and announces the count", () => {
		const html = renderReviewPage(input());
		// The title carries what the row's own line no longer spends a line on: the whole path, then
		// the state. It is also the hover a reader gets for a name the rail had to shorten.
		expect(html).toContain('title="lib/http/mount.ts — no comment"');
		expect(html).toContain('<span class="rv-rail__dir" dir="rtl"><bdi>lib/http</bdi></span>');
		expect(html).toContain('id="rv-file-count" aria-live="polite"');
		expect(html).toContain('aria-label="Mark lib/http/mount.ts reviewed"');
		expect(html).toContain('id="rv-rail-empty" hidden');
		expect(html).toContain('id="rv-filter-note" hidden');
	});

	test("keeps the state out of a row's own line, and in its title", () => {
		const html = renderReviewPage(input({ review: review() }));
		// The lines a row spends are the path's: name, then directory. The state word is what made
		// a third one, in a rail that is capped and scrolls (#817) — so it moves into the title,
		// where it is a sentence the row's own line does not carry.
		const notes = [...html.matchAll(/<span class="rv-rail__notes">([^<]*)<\/span>/g)].map((match) => match[1]);
		expect(notes).toEqual(["1 comment"]);
		// The count stayed: it is a count, and the paper cannot say how many.
		expect(html).not.toMatch(/rv-rail__notes">(no comment|marked reviewed)/);
		// Each row's title is the whole path and the state a screen reader would otherwise miss: the
		// count here, and the state where the count leaves it unsaid (the fixture marks serve.md
		// reviewed, which is the row that used to spend a line saying so).
		expect(html).toContain('title="lib/http/mount.ts — 1 comment"');
		expect(html).toContain('title="docs/serve.md — marked reviewed"');
	});

	test("draws one file when the address names it, with one rail row and the way back", () => {
		const html = renderReviewPage({ ...input(), file: "lib/http/mount.ts" });
		expect(html.match(/class="rv-file"/g)).toHaveLength(1);
		expect(html.match(/class="rv-rail"/g)).toHaveLength(1);
		expect(html).toContain('data-path="lib/http/mount.ts"');
		expect(html).not.toContain("docs/serve.md");
		// The way back is the comparison alone: the file is what is being left behind.
		expect(html).toContain('id="rv-all-files"');
		expect(html).toContain('href="/review/new?scope=branch"');
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
		// The focus is a view, so the scope's size rides along: a page drawing one file still has to
		// say "1 of 2 files", and the client's count comes from here rather than from the rail.
		expect(focused.files).toBe(2);
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
		expect(url.searchParams.get("scope")).toBe("branch");
		expect(href).toBe(fileHref("lib/http/mount.ts", comparisonOf("branch", "origin/main"), "branch"));
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

	test("a problem page names the reason and offers the way back, in the kit's empty block", () => {
		const html = renderReviewProblem("/review", "No diff to review", 'no base branch found — set "base"');
		expect(html).toContain("No diff to review");
		expect(html).toContain("no base branch found");
		expect(html).toContain('href="/review/new"');
		// The kit's empty block, not a page-local family no sheet draws — the same block the empty scope
		// above uses, and the names `test/web-classes.test.ts` reads against the kit and the page's sheet.
		expect(html).toContain('class="bf-empty"');
		expect(html).toContain('class="bf-empty__title"');
		expect(html).toContain('class="bf-empty__sub"');
		expect(html).not.toContain("rv-empty");
	});
});
