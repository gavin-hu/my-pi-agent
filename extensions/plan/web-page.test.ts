/**
 * The review page's own contract: the tab it opens, the roles it renders, the plan
 * and its data island, the print and view rules, and the fragments the shipped
 * bundle is assembled from.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../lib/web/index.ts";
import { declaredFunctions, missingBundleBodies } from "../../test/helpers/bundle.ts";
import { islandOf, reviewPage } from "../../test/helpers/fixtures/plan-web.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { REVIEW_CSS } from "./web-page.ts";
describe("the review's tab", () => {
	test("names the plan in the document head, before a script runs", () => {
		// A tab is read in a browser's tab strip, so the title has to be in the document: a
		// script that sets it later is a tab named "Plan review" for as long as the page loads.
		// Lowercase, like the lockup that names the page under it, and the plan's title after
		// one separator: the three served pages read as one product in a strip of tabs.
		expect(reviewPage()).toContain("<title>plan review · Add rate limiting</title>");
		expect(reviewPage({ title: "Fix <the> parser" })).toContain("<title>plan review · Fix &lt;the&gt; parser</title>");
	});

	test("leaves the tab title to the head rather than a second copy in script", () => {
		// One sentence, one owner: the head renders it from the same `title` the header paints.
		expect(REVIEW_CLIENT_JS).not.toContain("document.title");
	});

	test("links the brand mark as the tab icon", () => {
		expect(reviewPage()).toContain('rel="icon"');
		expect(reviewPage()).toContain('href="data:image/svg+xml,');
	});
});

describe("review page roles", () => {
	test("gives the owner Share, the link list, and the matching dialog", () => {
		const html = reviewPage();
		expect(html).toContain('id="share"');
		expect(html).toContain('id="share-dialog"');
		expect(html).toContain('id="share-qr"');
		// One row per teammate: the list is filled on request, and New link adds one.
		expect(html).toContain('id="share-links"');
		expect(html).toContain('id="share-new"');
		expect(html).toContain('id="share-stop"');
		expect(html).not.toContain('id="name-dialog"');
	});

	test("gives a reviewer a name dialog and only the post action", () => {
		const html = reviewPage({ role: "reviewer", canApprove: false });
		expect(html).toContain('id="reviewer-name"');
		expect(html).toContain('id="name-dialog"');
		expect(html).toContain('id="post"');
		expect(html).toContain("Post comments");
		// Nothing that decides the review, closes it, or mints another link.
		expect(html).not.toContain('id="share"');
		expect(html).not.toContain('id="share-dialog"');
		expect(html).not.toContain('id="save"');
		expect(html).not.toContain('id="cancel"');
		expect(html).not.toContain('id="approve"');
		expect(html).not.toContain('id="approve-dialog"');
		expect(html).not.toContain("Back to Pi");
	});

	test("names the reviewer's write action as posting, not saving", () => {
		const reviewer = reviewPage({ role: "reviewer", canApprove: false });
		expect(reviewer).toContain("Post your comments to the plan");
		expect(reviewer).not.toContain("Save feedback and return to Pi");
		expect(reviewer).not.toContain("or the review");

		const owner = reviewPage();
		expect(owner).toContain("Save feedback and return to Pi");
		expect(owner).not.toContain('id="post"');
	});

	test("never puts a reviewer token in the page source", () => {
		// The share link is minted on request; the page only knows its own token.
		const html = reviewPage({ role: "reviewer", canApprove: false, token: "reviewer-token" });
		expect(html).toContain('id="review-data"');
		expect(html).not.toContain("share-link?token=");
	});
});

describe("review page", () => {
	test("ships each shared stylesheet block once", () => {
		// The kit cannot check this: it does not know which page concatenates it.
		for (const [name, block] of [
			["base", WEB_BASE_CSS],
			["theme", WEB_THEME_CSS],
			["layout", WEB_LAYOUT_CSS],
			["components", WEB_COMPONENTS_CSS],
		] as const) {
			expect(REVIEW_CSS.split(block).length - 1, `${name} block`).toBe(1);
		}
	});

	test("prints the whole plan, whichever view the reader had", () => {
		// The base layer hides a filtered block with !important, so the print rule has to
		// match it: without that, a printed Changed view is a partial plan, which is the one
		// thing the print block promises it is not.
		expect(WEB_BASE_CSS).toContain("[hidden]{display:none!important}");
		expect(REVIEW_CSS).toContain(".bf-block[hidden]{display:block!important}");
		expect(REVIEW_CSS).toContain(".bf-comments[hidden]{display:flex!important}");
	});

	test("loads the first-party client, the shared theme, and the review controls", () => {
		const html = reviewPage();
		expect(html).toContain('<script src="/client.js" defer>');
		expect(html).toContain('<script src="/theme.js">');
		expect(html).toContain('id="theme-toggle"');
		expect(html).toContain('id="shortcuts"');
		expect(html).toContain('id="save"');
		expect(html).toContain('id="cancel"');
	});

	test("offers Approve & run only when the review may approve", () => {
		const approvable = reviewPage();
		expect(approvable).toContain('id="approve"');
		expect(approvable).toContain("Approve &amp; run");

		const commentOnly = reviewPage({ canApprove: false });
		expect(commentOnly).not.toContain('id="approve"');
		expect(commentOnly).toContain('id="save"');
	});

	test("frames the plan with a section outline and the document body", () => {
		const html = reviewPage();
		expect(html).toContain('id="outline-list"');
		expect(html).toContain('id="plan"');
		expect(html).toContain('href="#plan"');
		expect(html).toContain("bf-review");
	});

	test("drops the outline column when the plan has no headings", () => {
		const html = reviewPage({ outline: [] });
		expect(html).toContain("bf-app__body--single");
		expect(html).not.toContain('id="outline-list"');
	});

	test("carries the review data in one JSON island", () => {
		const data = islandOf(reviewPage({ code: { "2": ['<span class="tok-keyword">const</span>'] } }));

		expect(data.title).toBe("Add rate limiting");
		expect(data.token).toBe("secret-token");
		expect(data.steps).toEqual({ done: 0, total: 0 });
		expect(data.outline[0]).toEqual({ id: "s-0", line: 0, level: 1, text: "Add rate limiting" });
		expect(data.code["2"]?.[0]).toContain("tok-keyword");
		expect(data.limits).toEqual({ comments: 200, comment: 2000, quote: 500 });
	});

	test("escapes a plan line that would close the island", () => {
		const html = reviewPage({
			blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["</script><script>alert(1)</script>"] }],
		});
		expect(html).not.toContain("</script><script>alert(1)");
		expect(html).toContain("\\u003c/script>");
	});

	test("confirms approval instead of running it from one click", () => {
		const html = reviewPage();
		expect(html).toContain('id="approve-dialog" hidden');
		expect(html).toContain("Approve and run the plan?");
		expect(html).toContain('id="approve-cancel"');
		expect(html).toContain('id="approve-confirm"');
		expect(reviewPage({ canApprove: false })).not.toContain('id="approve-dialog"');
	});

	test("keeps plan text out of the markup outside the island", () => {
		const html = reviewPage({ blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["UNIQUE_PLAN_TEXT"] }] });
		const markup = html.slice(0, html.indexOf('<script type="application/json"'));
		expect(markup).not.toContain("UNIQUE_PLAN_TEXT");
	});

	test("shows the review facts, the progress bar, and the keyboard sheet", () => {
		const html = reviewPage();
		expect(html).toContain('id="review-facts"');
		expect(html).toContain('id="step-fact"');
		expect(html).toContain('id="step-count"');
		expect(html).toContain('id="progress-fill"');
		expect(html).toContain('id="keys-dialog"');
		expect(html).toContain("Approve and run the plan");
	});

	test("offers the three views, with Changed off when there is nothing to compare", () => {
		const html = reviewPage({ blockMarks: true });
		expect(html).toContain('data-view="all"');
		expect(html).toContain('data-view="changed"');
		expect(html).toContain('data-view="comments"');
		// The client disables Changed from the island, so the flag has to be in it.
		expect(html).toContain('"blockMarks":true');
	});

	test("omits the approve hint and shortcut on a comment-only review", () => {
		const html = reviewPage({ canApprove: false });
		expect(html).not.toContain("to approve");
		expect(html).not.toContain("Approve and run the plan");
		expect(html).toContain("for all shortcuts");
	});
});

describe("the client bundle", () => {
	/** The fragments this page assembles from: every `web-*.ts` beside the suite. */
	const fragments = (): string[] => declaredFunctions(import.meta.dir, /^web-.*\.ts$/);

	test("carries every fragment function the bundle calls", () => {
		// `applyView`, `surfaceOf`, and `keyRows` were exactly this: called by the shipped
		// script, documented, and absent from it — a ReferenceError on the page's first
		// render and on every content key, with the whole suite green.
		expect(missingBundleBodies(REVIEW_CLIENT_JS, fragments())).toEqual([]);
	});

	test("the scan reports a name the bundle calls and does not define", () => {
		// The helper's own contract, pinned where it is used: `test/helpers/` has no suite
		// of its own, and a scan that silently reported nothing would pass every page.
		const bundle = "function drawn() { return 1; }\n	drawn();\n	missing();";
		expect(missingBundleBodies(bundle, ["drawn", "missing", "unused"])).toEqual(["missing"]);
	});
});
