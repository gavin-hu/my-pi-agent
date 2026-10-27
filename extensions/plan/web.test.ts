/**
 * The browser review capability: the comment codec stored in the plan file, the
 * request router and its guards, the page shell and its JSON island, the shipped
 * client script, and the loopback review session.
 *
 * Routers are driven directly for request shapes; only the session cases open a
 * real loopback socket. The closed-tab grace runs on an injected timer, so no
 * test races a real deadline.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import type { ArmTimer, RepeatTimer } from "../../lib/timer.ts";
import { THEME_JS, WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../lib/web/index.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import {
	coerceAnnotations,
	feedbackSummary,
	formatFeedback,
	MAX_ANNOTATIONS,
	MAX_COMMENT_LENGTH,
	MAX_QUOTE_LENGTH,
	parseFeedback,
	stripFeedback,
	type PlanAnnotation,
} from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { applyView, blockAtLine, blockElements, moveActive, setActive, WEB_BLOCKS_JS } from "./web-blocks.ts";
import { closeComposer, commentOnActive, reopenComposer, WEB_COMPOSER_JS } from "./web-composer.ts";
import {
	approveReview,
	cancelReview,
	postReviewComments,
	saveReview,
	submitAnnotations,
	WEB_SETTLE_JS,
} from "./web-settle.ts";
import { renderPlanFrame, WEB_PLAN_JS } from "./web-plan.ts";
import { handleKey, rememberSelection, WEB_KEYS_JS } from "./web-keys.ts";
import { draftTextarea, guardDraft, WEB_DRAFT_JS } from "./web-draft.ts";
import { observeSections, renderFacts, sectionFor, WEB_OUTLINE_JS } from "./web-outline.ts";
import { renderReviewPage, REVIEW_CSS, type ReviewPageData } from "./web-page.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "./web-router.ts";
import { createPlanWebReview, type PlanReviewOptions, type PlanReviewSession, type PlanWebReviewDeps } from "./web.ts";
import { MAX_SHARE_LINKS, type NetworkInterfaces, type ShareLink, type ShareState } from "./web-share.ts";

const PLAN = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";
const PATH = "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md";
const RELATIVE = "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md";

interface ReviewIsland {
	title: string;
	token: string;
	role: "owner" | "reviewer";
	/** The reviewer's bound name, once this link has posted. */
	author?: string;
	/** Digest of the plan text the page rendered, which keys a tab's draft. */
	rev: string;
	canApprove: boolean;
	annotations: PlanAnnotation[];
	steps: { done: number; total: number };
	outline: Array<{ id: string; line: number; level: number; text: string; changed?: boolean; removed?: number }>;
	/** Absolute start lines of the blocks that are new or edited since the previous review. */
	changed?: number[];
	/** Whether the baseline carried block digests, so `changed` means something. */
	blockMarks?: boolean;
	code: Record<string, string[]>;
	limits: { comments: number; comment: number; quote: number };
	blocks: Array<{ start: number; lines: string[] }>;
}

/** The page's data island, the one contract the client reads. */
function islandOf(html: string): ReviewIsland {
	const match = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error("review data island missing");
	return JSON.parse(match[1] ?? "") as ReviewIsland;
}

describe("browser comment codec", () => {
	test("strips stored markers but leaves a fenced marker as content", () => {
		expect(stripFeedback("- one\n> [!REVIEW] a note\n- two")).toBe("- one\n- two");
		expect(stripFeedback("a\n  > [!REVIEW]\nb")).toBe("a\nb");

		const fenced = "```md\n> [!REVIEW] documentation\n```";
		expect(stripFeedback(fenced)).toBe(fenced);
	});

	test("writes a comment after the whole block it anchors to", () => {
		expect(formatFeedback(PLAN, [{ anchor: 3, comment: "too vague" }])).toBe(
			"# Title\n\n## Steps\n- [ ] one\n> [!REVIEW] too vague\n- [ ] two\n",
		);

		const fenced = "```ts\nconst x = 1;\n```\nafter\n";
		expect(formatFeedback(fenced, [{ anchor: 1, comment: "rename x" }])).toBe(
			"```ts\nconst x = 1;\n```\n> [!REVIEW] rename x\nafter\n",
		);
	});

	test("groups several comments on one block in order", () => {
		const saved = formatFeedback(PLAN, [
			{ anchor: 3, comment: "first" },
			{ anchor: 3, comment: "second" },
		]);
		expect(saved).toContain("- [ ] one\n> [!REVIEW] first\n> [!REVIEW] second\n- [ ] two");
	});

	test("collapses a comment to one line and drops empty ones", () => {
		expect(formatFeedback("- one", [{ anchor: 0, comment: "line one\nline two" }])).toBe(
			"- one\n> [!REVIEW] line one line two",
		);
		expect(formatFeedback("- one\n> [!REVIEW] old", [])).toBe("- one");
		expect(formatFeedback("- one", [{ anchor: 0, comment: "   " }])).toBe("- one");
		expect(formatFeedback("", [{ anchor: 0, comment: "start over" }])).toBe("> [!REVIEW] start over");
	});

	test("replaces rather than appends across repeated saves", () => {
		const annotations = [
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		];
		const once = formatFeedback(PLAN, annotations);
		expect(formatFeedback(once, annotations)).toBe(once);
	});

	test("parses the anchor and comment back from the file", () => {
		const saved = formatFeedback(PLAN, [
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
		expect(parseFeedback(saved)).toEqual([
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
		expect(parseFeedback(PLAN)).toEqual([]);
		expect(parseFeedback("> [!REVIEW] top\n# Title")).toEqual([{ anchor: 0, comment: "top" }]);
	});

	test("ignores a marker-looking line inside a fenced code block", () => {
		const plan = "# Title\n\n```md\n> [!REVIEW] documentation\n```\n\n- [ ] step\n";
		const saved = formatFeedback(plan, [{ anchor: 6, comment: "real" }]);
		expect(stripFeedback(saved)).toBe(plan);
		expect(parseFeedback(saved)).toEqual([{ anchor: 6, comment: "real" }]);
	});

	test("summarizes comments for the model", () => {
		const summary = feedbackSummary([
			{ anchor: 0, quote: "token bucket", comment: "burst case?" },
			{ anchor: 1, comment: "add a test" },
		]);
		expect(summary).toBe('1. On "token bucket": burst case?\n2. add a test');

		const truncated = feedbackSummary([{ anchor: 0, quote: "x".repeat(200), comment: "note" }]);
		expect(truncated).toContain("…");
		expect(truncated).toContain("note");
	});

	test("accepts well-formed annotations and drops empty comments", () => {
		expect(coerceAnnotations([{ anchor: 2, quote: "q", comment: "c" }])).toEqual([
			{ anchor: 2, quote: "q", comment: "c" },
		]);
		expect(coerceAnnotations([{ anchor: 2, comment: "  " }])).toEqual([]);
	});

	test("rejects a malformed annotations payload", () => {
		expect(coerceAnnotations("nope")).toBeUndefined();
		for (const entry of [
			{ anchor: -1, comment: "c" },
			{ anchor: 1.5, comment: "c" },
			{ anchor: 1 },
			{ anchor: 1, comment: "c", quote: 3 },
			{ anchor: 1, comment: "x".repeat(MAX_COMMENT_LENGTH + 1) },
		]) {
			expect(coerceAnnotations([entry])).toBeUndefined();
		}
	});

	test("caps the annotation count", () => {
		const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, () => ({ anchor: 0, comment: "c" }));
		expect(coerceAnnotations(many)).toBeUndefined();
	});
});

const HOST = { host: "127.0.0.1:1234" };

const PAGE_DATA: ReviewPageData = {
	title: "T",
	blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["hello"] }],
	annotations: [],
	outline: [],
	steps: { done: 0, total: 0 },
	code: {},
	limits: { comments: 200, comment: 2000, quote: 500 },
	canApprove: true,
	role: "owner",
	token: "tok",
	rev: "rev-1",
};

/** A router context that records its callbacks and can fail a save on demand. */
function router(overrides: Partial<ReviewContext> = {}) {
	const saved: PlanAnnotation[][] = [];
	const approved: PlanAnnotation[][] = [];
	const ownerSaves: PlanAnnotation[][] = [];
	const cancelled: number[] = [];
	let nextSave: SaveResult = { ok: true };
	const ctx: ReviewContext = {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => PAGE_DATA,
		save: async (annotations) => {
			saved.push(annotations);
			return nextSave;
		},
		share: async () => ({
			state: { sharing: true, port: 1, links: [{ id: "link-1", address: "192.168.1.24", url: "http://x" }] },
		}),
		invite: async () => ({
			state: { sharing: true, port: 1, links: [{ id: "link-2", address: "192.168.1.24", url: "http://y" }] },
		}),
		revoke: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		stopShare: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		onSaved: (annotations) => ownerSaves.push(annotations),
		onApprove: (annotations) => approved.push(annotations),
		onCancel: () => cancelled.push(1),
		...overrides,
	};
	return {
		ctx,
		saved,
		approved,
		ownerSaves,
		cancelled,
		setSave: (result: SaveResult) => {
			nextSave = result;
		},
	};
}

const get = (url: string) => handleReviewRequest(router().ctx, "GET", url, HOST);
const post = (ctx: ReviewContext, url: string, body = "") => handleReviewRequest(ctx, "POST", url, HOST, body);

describe("review router", () => {
	test("serves the review page with the page policy and no framing", async () => {
		const response = await get("/?token=tok");

		expect(response.status).toBe(200);
		expect(response.body).toContain('id="review-data"');
		expect(response.headers["Content-Security-Policy"]).toContain("default-src 'none'");
		expect(response.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
		expect(response.headers["X-Frame-Options"]).toBe("DENY");
	});

	test("rejects the page without the session token", async () => {
		expect((await get("/")).status).toBe(403);
		expect((await get("/?token=nope")).status).toBe(403);
	});

	test("serves the first-party client and the shared theme without a token", async () => {
		const client = await get("/client.js");
		expect(client.status).toBe(200);
		expect(client.body).toBe(REVIEW_CLIENT_JS);
		expect(client.headers["Content-Type"]).toContain("text/javascript");

		const theme = await get("/theme.js");
		expect(theme.status).toBe(200);
		expect(theme.body).toBe(THEME_JS);
		expect(theme.headers["Content-Type"]).toContain("text/javascript");
	});

	test("opens the event stream only with the token", async () => {
		const stream = await get("/events?token=tok");
		expect(stream.status).toBe(200);
		expect(stream.stream).toBe(true);
		expect(stream.headers["Content-Type"]).toContain("text/event-stream");
		expect((await get("/events")).status).toBe(403);
	});

	test("answers a favicon without a content type and an unknown route with 404", async () => {
		// No stub: the head links the mark itself, so the browser never asks for the file.
		// A page's own request gets the same 404 as every other path the review does not serve.
		expect((await get("/favicon.ico?token=tok")).status).toBe(404);
		expect((await get("/nope?token=tok")).status).toBe(404);
	});

	test("answers a malformed request target with 400", async () => {
		const response = await get("http://[");
		expect(response.status).toBe(400);
		expect(response.body).toContain("Malformed request URL.");
	});

	test("serves only GET, HEAD, and POST", async () => {
		const response = await handleReviewRequest(router().ctx, "PUT", "/?token=tok", HOST);
		expect(response.status).toBe(405);
		expect(response.headers.Allow).toBe("GET, HEAD, POST");
	});

	test("rejects a missing, foreign, or non-string Host header", async () => {
		for (const headers of [{}, { host: "evil.example" }, { host: ["127.0.0.1"] }]) {
			expect((await handleReviewRequest(router().ctx, "GET", "/?token=tok", headers)).status).toBe(403);
		}
	});

	test("saves valid annotations and signals the save", async () => {
		let resolved = 0;
		const { ctx, saved } = router({ onSaved: () => (resolved += 1) });
		const response = await post(
			ctx,
			"/api/feedback?token=tok",
			JSON.stringify({ annotations: [{ anchor: 1, comment: "note" }] }),
		);

		expect(response.status).toBe(200);
		expect(saved).toEqual([[{ anchor: 1, comment: "note" }]]);
		expect(resolved).toBe(1);
	});

	test("rejects a bad token before touching the plan", async () => {
		const { ctx, saved } = router();
		const response = await post(ctx, "/api/feedback?token=nope", JSON.stringify({ annotations: [] }));

		expect(response.status).toBe(403);
		expect(saved).toEqual([]);
	});

	test("rejects a malformed feedback body", async () => {
		const { ctx } = router();
		expect((await post(ctx, "/api/feedback?token=tok", "not json")).status).toBe(400);
		expect((await post(ctx, "/api/feedback?token=tok", JSON.stringify({ annotations: 1 }))).status).toBe(400);
		expect((await handleReviewRequest(ctx, "GET", "/api/feedback?token=tok", HOST)).status).toBe(405);
	});

	test("reports a save conflict from the store", async () => {
		const { ctx, setSave } = router();
		setSave({ ok: false, status: 409, message: "The plan changed." });
		const response = await post(ctx, "/api/feedback?token=tok", JSON.stringify({ annotations: [] }));

		expect(response.status).toBe(409);
		expect(response.body).toContain("The plan changed.");
	});

	test("cancels on request and refuses a non-POST cancel", async () => {
		const { ctx, cancelled } = router();
		expect((await post(ctx, "/api/cancel?token=tok")).status).toBe(200);
		expect(cancelled).toHaveLength(1);
		expect((await handleReviewRequest(ctx, "GET", "/api/cancel?token=tok", HOST)).status).toBe(405);
	});

	test("saves the comments and signals an approve", async () => {
		const { ctx, saved, approved } = router();
		const response = await post(
			ctx,
			"/api/approve?token=tok",
			JSON.stringify({ annotations: [{ anchor: 1, comment: "note" }] }),
		);

		expect(response.status).toBe(200);
		expect(saved).toEqual([[{ anchor: 1, comment: "note" }]]);
		expect(approved).toEqual([[{ anchor: 1, comment: "note" }]]);
	});

	test("refuses approve when the review is comment-only", async () => {
		const { ctx, approved } = router({ canApprove: false });
		const response = await post(ctx, "/api/approve?token=tok");

		expect(response.status).toBe(403);
		expect(approved).toEqual([]);
	});

	test("rejects a non-POST approve and reports its conflict", async () => {
		const { ctx, approved, setSave } = router();
		expect((await handleReviewRequest(ctx, "GET", "/api/approve?token=tok", HOST)).status).toBe(405);

		setSave({ ok: false, status: 409, message: "The plan changed." });
		const response = await post(ctx, "/api/approve?token=tok", JSON.stringify({ annotations: [] }));
		expect(response.status).toBe(409);
		expect(approved).toEqual([]);
	});

	test("a reviewer posts comments but never saves, approves, or closes the review", async () => {
		const { ctx, saved, approved, ownerSaves, cancelled } = router({
			caller: (token) => (token === "tok" ? { role: "reviewer" } : undefined),
		});
		const posted = await post(ctx, "/api/comment?token=tok", JSON.stringify({ annotations: [] }));
		expect(posted.status).toBe(200);
		expect(saved).toHaveLength(1);
		// Posting writes comments; it never resolves the review.
		expect(ownerSaves).toEqual([]);

		expect((await post(ctx, "/api/feedback?token=tok")).status).toBe(403);
		expect((await post(ctx, "/api/approve?token=tok")).status).toBe(403);
		expect((await post(ctx, "/api/cancel?token=tok")).status).toBe(403);
		expect(approved).toEqual([]);
		expect(cancelled).toEqual([]);
	});

	test("the owner saves the review and cannot post to the reviewer route", async () => {
		const { ctx, saved, ownerSaves } = router();

		expect((await post(ctx, "/api/comment?token=tok", JSON.stringify({ annotations: [] }))).status).toBe(403);
		expect(saved).toEqual([]);
		expect(
			(await post(ctx, "/api/feedback?token=tok", JSON.stringify({ annotations: [{ anchor: 0, comment: "m" }] })))
				.status,
		).toBe(200);
		expect(ownerSaves).toHaveLength(1);
	});

	test("refuses a Host header the server was not bound on", async () => {
		const { ctx } = router();
		const response = await handleReviewRequest(ctx, "GET", "/?token=tok", { host: "evil.example" });
		expect(response.status).toBe(403);
		expect(response.body).toContain("Unexpected Host header");
	});

	test("serves a LAN Host once the review is shared to that address", async () => {
		const { ctx } = router({ hosts: () => [...LOOPBACK_HOSTS, "192.168.1.24"] });
		const response = await handleReviewRequest(ctx, "GET", "/?token=tok", { host: "192.168.1.24:51789" });
		expect(response.status).toBe(200);
	});

	test("refuses a cross-origin POST and accepts the page's own", async () => {
		const { ctx, saved } = router();
		const crossSite = await handleReviewRequest(ctx, "POST", "/api/feedback?token=tok", {
			...HOST,
			origin: "https://evil.example",
		});
		expect(crossSite.status).toBe(403);
		expect(saved).toEqual([]);

		const crossSiteFetch = await handleReviewRequest(ctx, "POST", "/api/feedback?token=tok", {
			...HOST,
			"sec-fetch-site": "cross-site",
		});
		expect(crossSiteFetch.status).toBe(403);

		const own = await handleReviewRequest(
			ctx,
			"POST",
			"/api/feedback?token=tok",
			{
				...HOST,
				origin: "http://127.0.0.1:1234",
				"sec-fetch-site": "same-origin",
				"content-type": "application/json",
			},
			JSON.stringify({ annotations: [] }),
		);
		expect(own.status).toBe(200);
	});
});

function page(overrides: Partial<ReviewPageData> = {}): string {
	return renderReviewPage({
		title: "Add rate limiting",
		blocks: [{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"] }],
		annotations: [],
		outline: [{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" }],
		steps: { done: 0, total: 0 },
		code: {},
		limits: { comments: 200, comment: 2000, quote: 500 },
		canApprove: true,
		role: "owner",
		token: "secret-token",
		rev: "rev-1",
		...overrides,
	});
}

describe("the review's tab", () => {
	test("names the plan in the document head, before a script runs", () => {
		// A tab is read in a browser's tab strip, so the title has to be in the document: a
		// script that sets it later is a tab named "Plan review" for as long as the page loads.
		// Lowercase, like the lockup that names the page under it, and the plan's title after
		// one separator: the three served pages read as one product in a strip of tabs.
		expect(page()).toContain("<title>plan review · Add rate limiting</title>");
		expect(page({ title: "Fix <the> parser" })).toContain("<title>plan review · Fix &lt;the&gt; parser</title>");
	});

	test("leaves the tab title to the head rather than a second copy in script", () => {
		// One sentence, one owner: the head renders it from the same `title` the header paints.
		expect(REVIEW_CLIENT_JS).not.toContain("document.title");
	});

	test("links the brand mark as the tab icon", () => {
		expect(page()).toContain('rel="icon"');
		expect(page()).toContain('href="data:image/svg+xml,');
	});
});

describe("review page roles", () => {
	test("gives the owner Share, the link list, and the matching dialog", () => {
		const html = page();
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
		const html = page({ role: "reviewer", canApprove: false });
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
		const reviewer = page({ role: "reviewer", canApprove: false });
		expect(reviewer).toContain("Post your comments to the plan");
		expect(reviewer).not.toContain("Save feedback and return to Pi");
		expect(reviewer).not.toContain("or the review");

		const owner = page();
		expect(owner).toContain("Save feedback and return to Pi");
		expect(owner).not.toContain('id="post"');
	});

	test("never puts a reviewer token in the page source", () => {
		// The share link is minted on request; the page only knows its own token.
		const html = page({ role: "reviewer", canApprove: false, token: "reviewer-token" });
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
		const html = page();
		expect(html).toContain('<script src="/client.js" defer>');
		expect(html).toContain('<script src="/theme.js">');
		expect(html).toContain('id="theme-toggle"');
		expect(html).toContain('id="shortcuts"');
		expect(html).toContain('id="save"');
		expect(html).toContain('id="cancel"');
	});

	test("offers Approve & run only when the review may approve", () => {
		const approvable = page();
		expect(approvable).toContain('id="approve"');
		expect(approvable).toContain("Approve &amp; run");

		const commentOnly = page({ canApprove: false });
		expect(commentOnly).not.toContain('id="approve"');
		expect(commentOnly).toContain('id="save"');
	});

	test("frames the plan with a section outline and the document body", () => {
		const html = page();
		expect(html).toContain('id="outline-list"');
		expect(html).toContain('id="plan"');
		expect(html).toContain('href="#plan"');
		expect(html).toContain("bf-review");
	});

	test("drops the outline column when the plan has no headings", () => {
		const html = page({ outline: [] });
		expect(html).toContain("bf-app__body--single");
		expect(html).not.toContain('id="outline-list"');
	});

	test("carries the review data in one JSON island", () => {
		const data = islandOf(page({ code: { "2": ['<span class="tok-keyword">const</span>'] } }));

		expect(data.title).toBe("Add rate limiting");
		expect(data.token).toBe("secret-token");
		expect(data.steps).toEqual({ done: 0, total: 0 });
		expect(data.outline[0]).toEqual({ id: "s-0", line: 0, level: 1, text: "Add rate limiting" });
		expect(data.code["2"]?.[0]).toContain("tok-keyword");
		expect(data.limits).toEqual({ comments: 200, comment: 2000, quote: 500 });
	});

	test("escapes a plan line that would close the island", () => {
		const html = page({
			blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["</script><script>alert(1)</script>"] }],
		});
		expect(html).not.toContain("</script><script>alert(1)");
		expect(html).toContain("\\u003c/script>");
	});

	test("confirms approval instead of running it from one click", () => {
		const html = page();
		expect(html).toContain('id="approve-dialog" hidden');
		expect(html).toContain("Approve and run the plan?");
		expect(html).toContain('id="approve-cancel"');
		expect(html).toContain('id="approve-confirm"');
		expect(page({ canApprove: false })).not.toContain('id="approve-dialog"');
	});

	test("keeps plan text out of the markup outside the island", () => {
		const html = page({ blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["UNIQUE_PLAN_TEXT"] }] });
		const markup = html.slice(0, html.indexOf('<script type="application/json"'));
		expect(markup).not.toContain("UNIQUE_PLAN_TEXT");
	});

	test("shows the review facts, the progress bar, and the keyboard sheet", () => {
		const html = page();
		expect(html).toContain('id="review-facts"');
		expect(html).toContain('id="step-fact"');
		expect(html).toContain('id="step-count"');
		expect(html).toContain('id="progress-fill"');
		expect(html).toContain('id="keys-dialog"');
		expect(html).toContain("Approve and run the plan");
	});

	test("offers the three views, with Changed off when there is nothing to compare", () => {
		const html = page({ blockMarks: true });
		expect(html).toContain('data-view="all"');
		expect(html).toContain('data-view="changed"');
		expect(html).toContain('data-view="comments"');
		// The client disables Changed from the island, so the flag has to be in it.
		expect(html).toContain('"blockMarks":true');
	});

	test("omits the approve hint and shortcut on a comment-only review", () => {
		const html = page({ canApprove: false });
		expect(html).not.toContain("to approve");
		expect(html).not.toContain("Approve and run the plan");
		expect(html).toContain("for all shortcuts");
	});
});

const REVIEW_ORIGIN = "http://127.0.0.1:1234/?token=t";

/**
 * The source of one function in the served client, from its `function name(` to
 * its closing brace. The page is one script, so a test that inspects one function
 * slices it here instead of keeping a regex per arity.
 */
function clientFunction(name: string): string {
	const start = REVIEW_CLIENT_JS.indexOf(`function ${name}(`);
	if (start < 0) return "";
	const end = REVIEW_CLIENT_JS.indexOf("\n  }", start);
	return end < 0 ? "" : REVIEW_CLIENT_JS.slice(start, end + 4);
}

/**
 * The `safeHref` the page actually ships, evaluated out of the client source: a
 * string assertion cannot tell a fixed rule from a broken one.
 */
function shippedSafeHref(): (url: string, base: string) => string | null {
	return new Function(`${clientFunction("safeHref")}\nreturn safeHref;`)() as (
		url: string,
		base: string,
	) => string | null;
}

const linkFor = (url: string): string | null => shippedSafeHref()(url, REVIEW_ORIGIN);

describe("review client", () => {
	test("parses as JavaScript", () => {
		expect(() => new Function(REVIEW_CLIENT_JS)).not.toThrow();
	});

	test("has no external URLs beyond the autolink scheme", () => {
		const withoutScheme = REVIEW_CLIENT_JS.replace('"http://" + url', "");
		expect(withoutScheme).not.toContain("http://");
		expect(REVIEW_CLIENT_JS).not.toContain("https://");
		expect(REVIEW_CLIENT_JS).not.toContain("//cdn");
	});

	test("uses only same-origin routes with the session token", () => {
		// Every route a settlement writes to is in one module now; the stream stays in the
		// bundle, because it is wiring rather than a rule.
		expect(WEB_SETTLE_JS).toContain('"/api/feedback"');
		expect(WEB_SETTLE_JS).toContain('"/api/comment"');
		expect(WEB_SETTLE_JS).toContain('"/api/approve"');
		expect(WEB_SETTLE_JS).toContain("/api/cancel?token=");
		expect(WEB_SETTLE_JS).toContain('"?token=" + encodeURIComponent(deps.token())');
		expect(REVIEW_CLIENT_JS).toContain("/events?token=");
	});

	test("a reviewer's post keeps the page live and an owner's save settles it", () => {
		// The two are read apart because the difference is which flags they touch: posting
		// is transient, saving ends the review.
		const post = String(postReviewComments);
		expect(post).toContain('"/api/comment"');
		expect(post).not.toContain("markSettled");
		expect(post).not.toContain("settleStream");
		expect(post).not.toContain("lockActions");

		const save = String(saveReview);
		expect(save).toContain('"/api/feedback"');
		expect(save).toContain('deps.markSettled("saved")');
		expect(String(approveReview)).toContain('deps.markSettled("approved")');
	});

	test("shows the server's own reason when a post conflicts", () => {
		// A 409 is either a plan that moved or a link already bound to a name; the
		// server's sentence says which, so the page must not assume the first.
		const submit = String(submitAnnotations);
		expect(submit).toContain("function submitAnnotations(");
		// The parsed body carries the server's sentence, so a conflict says which of the two
		// it was rather than always the plan-changed one.
		expect(submit).toContain("body.error");
		expect(submit).toContain("deps.offerReload()");
		expect(submit).toContain("deps.planMoved");
		// The plan-changed sentence is the fallback now, not the only thing said.
		expect(submit).not.toContain('setStatus("The plan changed');
	});

	test("puts the tab stop back after it rebuilds the block it was in", () => {
		// Focus is restored only when the reviewer's own action destroyed it, never on
		// a repaint the stream caused, and the status region says what happened.
		// The rule is web-plan.ts's now: focus comes back only when it was inside the plan.
		expect(REVIEW_CLIENT_JS).toContain(
			"const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));",
		);
		expect(REVIEW_CLIENT_JS).toContain('active.querySelector(".bf-block__add")');
		expect(REVIEW_CLIENT_JS).toContain("Comment added.");
		expect(REVIEW_CLIENT_JS).toContain("Comment updated.");
	});

	test("keys its unsaved draft on the plan revision and this tab", () => {
		// A draft is this tab's own work for this plan text: never another writer's,
		// and never restored onto a plan that changed underneath it.
		expect(REVIEW_CLIENT_JS).toContain('var DRAFT_KEY = "bf-review-draft"');
		expect(REVIEW_CLIENT_JS).toContain("window.sessionStorage.setItem(DRAFT_KEY");
		expect(REVIEW_CLIENT_JS).toContain('draft.rev !== String(data.rev || "")');
		expect(REVIEW_CLIENT_JS).toContain("var mine = annotations.filter(isMine);");
		expect(REVIEW_CLIENT_JS).toContain("var restoredTyping = restoreDraft();");
	});

	test("keeps a half-typed comment in the same draft record", () => {
		// The composer's text is not a comment yet, so it is the draft's second half:
		// written on every keystroke, dropped when the composer closes, and reopened
		// with its caret at the end after a reload.
		expect(clientFunction("typingOf")).toContain('area.closest(".bf-block")');
		expect(clientFunction("saveDraft")).toContain("record.typing = typing");
		expect(clientFunction("openComposer")).toContain('area.addEventListener("input"');
		expect(clientFunction("reopenComposer")).toContain("blockAtLine(deps.planEl, blocks, typing.anchor)");
		expect(clientFunction("restoreDraft")).toContain("return typing;");
		// A close with nothing open must not rewrite, and so drop, a restored draft.
		const close = clientFunction("closeComposer");
		expect(close).toContain("if (open)");
		expect(close).toContain("deps.saveDraft();");
		expect(REVIEW_CLIENT_JS).toContain("function closeOpenComposer() {");
	});

	test("keeps the selection a composer was quoting", () => {
		// The text alone restores a different note: the quote is what the comment is
		// about, so the chip's value travels with the draft and comes back on reopen.
		expect(clientFunction("openComposer")).toContain('composer.setAttribute("data-quote", quote)');
		expect(clientFunction("typingOf")).toContain('composer.getAttribute("data-quote")');
		expect(clientFunction("restoreDraft")).toContain('quote: typeof stored.quote === "string"');
		expect(clientFunction("reopenComposer")).toContain('typing.quote || ""');
	});

	test("closes the review only for its owner and reads a terminal frame", () => {
		expect(String(cancelReview)).toContain('deps.role() !== "owner" || deps.settled()');
		// The terminal frames the bundle reads off the stream.
		expect(REVIEW_CLIENT_JS).toContain('kind === "closed"');
		expect(REVIEW_CLIENT_JS).toContain('kind === "revoked"');
		expect(String(submitAnnotations)).toContain("buttons.post.disabled = !0");
	});

	test("never assigns plan or comment text as markup", () => {
		expect(REVIEW_CLIENT_JS).not.toContain("innerHTML");
		expect(REVIEW_CLIENT_JS).toContain(".textContent =");
	});

	test("opens the approval confirmation instead of posting on the keypress", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("approve-dialog")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("approve-confirm")');
		expect(REVIEW_CLIENT_JS).toContain("window.bfApprove.open()");
		expect(REVIEW_CLIENT_JS).toContain("askApprove()");
	});

	test("refuses to leave a draft, hides empty steps, and offers a delete back", () => {
		// The rule is `web-draft.ts`'s now: the client keeps its sentence and its status
		// line, and hands both to the one guard.
		expect(REVIEW_CLIENT_JS).toContain("guardDraft(planEl, statusEl, DRAFT_REFUSAL, paintStatus)");
		expect(REVIEW_CLIENT_JS).toContain("Add or discard the comment you are writing.");
		expect(REVIEW_CLIENT_JS).toContain('getElementById("step-fact")');
		expect(REVIEW_CLIENT_JS).toContain('button.id = "undo-delete"');
		expect(REVIEW_CLIENT_JS).toContain("function removeComment(index)");
	});

	test("leaves the shortcut sheet's Esc to the shared dialog runtime", () => {
		// One copy of the close: the kit's capture listener owns it, so the page
		// keymap cannot drift from the sheet's own behavior.
		expect(REVIEW_CLIENT_JS).not.toContain("window.bfKeys.close()");
	});

	test("rejects a protocol-relative link", () => {
		expect(linkFor("//evil.com")).toBeNull();
	});

	test("refuses a link that is only cross-origin after URL parsing", () => {
		// trim keeps an interior tab, and the URL parser deletes it: without
		// resolving first, "/\t/evil.com" reads as a same-origin path.
		expect(linkFor("/\t/evil.com")).toBeNull();
		expect(linkFor("/\n/x.com")).toBeNull();
	});

	test("refuses a non-web scheme and a credentialed URL", () => {
		for (const target of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com/x"]) {
			expect(linkFor(target)).toBeNull();
		}
	});

	test("keeps web, mail, anchor, and same-origin relative links", () => {
		expect(linkFor("https://example.com/x")).toBe("https://example.com/x");
		expect(linkFor("mailto:a@b.example")).toBe("mailto:a@b.example");
		expect(linkFor("#section")).toBe("http://127.0.0.1:1234/?token=t#section");
		expect(linkFor("docs/x.md")).toBe("http://127.0.0.1:1234/docs/x.md");
	});

	test("keeps a stream open so the server sees the tab close", () => {
		expect(REVIEW_CLIENT_JS).toContain("new EventSource(");
		// A closed tab is a dropped stream the server times out; a beacon would also
		// cancel the review on a reload, which the 409 path offers on purpose.
		expect(REVIEW_CLIENT_JS).not.toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).not.toContain("beforeunload");
	});

	test("closes the stream once the review has settled", () => {
		expect(REVIEW_CLIENT_JS).toContain("function settleStream()");
		expect(REVIEW_CLIENT_JS).toContain("stream.close()");
		expect(REVIEW_CLIENT_JS).toContain('addEventListener("pagehide", settleStream)');
	});

	test("offers a reload when the plan changed on disk", () => {
		expect(REVIEW_CLIENT_JS).toContain("result.status === 409");
		expect(REVIEW_CLIENT_JS).toContain("window.location.reload()");
	});

	test("takes its caps from the island instead of retyping them", () => {
		expect(REVIEW_CLIENT_JS).toContain("var limits = data.limits || fallback.limits;");
		expect(REVIEW_CLIENT_JS).toContain("area.maxLength = limits.comment;");
		expect(REVIEW_CLIENT_JS).toContain("annotations.length >= limits.comments");
		expect(REVIEW_CLIENT_JS).toContain("slice(0, limits.quote)");
		expect(REVIEW_CLIENT_JS).not.toContain(">= 200");
	});

	test("mints and revokes single links from the owner's dialog", () => {
		expect(REVIEW_CLIENT_JS).toContain('shareAction("/api/share/link"');
		expect(REVIEW_CLIENT_JS).toContain('shareAction("/api/share/revoke", { id: id }');
		expect(REVIEW_CLIENT_JS).toContain("shareLinksEl.appendChild(row)");
		// A row's name is the bound one, so the owner can tell two links apart.
		expect(REVIEW_CLIENT_JS).toContain('"@" + link.name');
	});

	test("settles on a terminal state instead of Offline", () => {
		expect(REVIEW_CLIENT_JS).toContain('label = "Approved"');
		expect(REVIEW_CLIENT_JS).toContain('label = "Saved"');
		expect(REVIEW_CLIENT_JS).toContain('label = "Closed"');
		expect(REVIEW_CLIENT_JS).toContain("} else if (everConnected) {");
		expect(REVIEW_CLIENT_JS).toContain("everConnected = true");
	});

	test("shows the server's own reason when a save is rejected", () => {
		expect(REVIEW_CLIENT_JS).toContain("payload.error");
		expect(REVIEW_CLIENT_JS).toContain("response.json()");
	});

	test("ignores Enter while an IME composition is open", () => {
		expect(REVIEW_CLIENT_JS).toContain("event.isComposing");
	});

	test("marks a changed outline section with a labelled dot", () => {
		expect(REVIEW_CLIENT_JS).toContain('"review-changed"');
		expect(REVIEW_CLIENT_JS).toContain("Changed since your last review");
		expect(REVIEW_CLIENT_JS).toContain("item.changed");
	});
});

/** The same URL with its path replaced, for a reviewer's API call. */
function apiOf(link: string, route: string): string {
	const url = new URL(link);
	url.pathname = route;
	return url.toString();
}

/** One owner action on the share surface, as the page's own buttons drive it. */
function ownerShares(session: PlanReviewSession, route: string, body?: unknown): Promise<Response> {
	return fetch(`http://127.0.0.1:${session.port}${route}?token=tok`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
}

/** A reviewer's comment through her own link's route. */
function reviewerPost(link: ShareLink, author: string, comment: string): Promise<Response> {
	return fetch(apiOf(link.url, "/api/comment"), {
		method: "POST",
		headers: { "content-type": "application/json", origin: new URL(link.url).origin },
		body: JSON.stringify({ annotations: [{ anchor: 1, comment, author }] }),
	});
}

/** A machine that reports one reachable IPv4 address, as a LAN laptop does. */
const LAN = (): NetworkInterfaces => ({
	en0: [
		{
			address: "127.0.0.1",
			netmask: "255.255.255.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: "127.0.0.1/24",
		},
	],
});

/** Read the next `data:` frame from an event stream, decoded. */
async function nextFrame(body: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!body) throw new Error("no stream body");
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (let read = 0; read < 40; read++) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
		const line = /^data: (.*)$/m.exec(text)?.[1];
		if (line !== undefined) {
			await reader.cancel();
			return line;
		}
	}
	await reader.cancel();
	return text;
}

describe("review stream", () => {
	test("tells an open page when a comment arrives", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's page is open on the loopback stream when the comment lands.
		const stream = await fetch(`http://127.0.0.1:${session.port}/events?token=tok`);
		const frame = nextFrame(stream.body);

		await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "hello", author: "alice" }] }),
		});

		expect(await frame).toBe("comment");
	});

	test("tells an open page when sharing starts and stops", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		const first = await fetch(`http://127.0.0.1:${session.port}/events?token=tok`);
		const frame = nextFrame(first.body);

		await review.share();
		expect(await frame).toBe("share");
	});
});

/** A repeating timer a test fires by hand, so a poll tick is never a race. */
function manualTick() {
	let fire: (() => void) | undefined;
	let stopped = false;
	const tick: RepeatTimer = (_ms, fn) => {
		fire = fn;
		return () => {
			stopped = true;
			fire = undefined;
		};
	};
	return {
		tick,
		fire: () => fire?.(),
		stopped: () => stopped,
		armed: () => fire !== undefined,
	};
}

describe("plan poll", () => {
	test("reaches an open page when the plan is rewritten on disk", async () => {
		const manual = manualTick();
		const { session, content, rewrite } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		rewrite(`${content()}\n- [ ] three\n`);
		manual.fire();

		expect(await frame).toBe("plan");
	});

	test("says nothing when the file changed only in its stored comments", async () => {
		const manual = manualTick();
		const { session, store } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		// Another writer's save is a comment, not an edit to the plan text.
		await store.saveFeedback("/repo", PATH, [{ anchor: 1, comment: "a note", author: "alice" }]);
		manual.fire();

		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
	});

	test("treats a deleted plan as no news rather than a failure", async () => {
		const manual = manualTick();
		const { session, remove } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		remove();
		manual.fire();

		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
	});

	test("stops polling when the review closes", async () => {
		const manual = manualTick();
		const { session } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		expect(manual.armed()).toBe(true);

		await session.close();

		expect(manual.stopped()).toBe(true);
	});
});

describe("shared review", () => {
	test("reports why it cannot share when the machine has no address", async () => {
		const { review } = await startShared({
			networkInterfaces: (): NetworkInterfaces => ({
				lo0: [
					{
						address: "127.0.0.1",
						netmask: "255.0.0.0",
						family: "IPv4",
						mac: "00:00:00:00:00:00",
						internal: true,
						cidr: "127.0.0.1/8",
					},
				],
			}),
		});
		const result = await review.share();

		expect(result?.state.sharing).toBe(false);
		expect(result?.state.links).toEqual([]);
		expect(result?.state.reason).toContain("no network address");
		expect(result?.svg).toBeUndefined();
	});

	test("mints a reviewer link with a QR and keeps the owner's page working", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const result = await review.share();

		expect(result?.state.sharing).toBe(true);
		const link = result?.state.links[0];
		expect(link?.address).toBe("127.0.0.1");
		expect(link?.url).toContain("token=");
		expect(result?.svg).toContain("<svg");
		// The owner's own link still answers: sharing adds a listener, never moves one.
		expect((await fetch(session.url)).status).toBe(200);
		expect(review.shareState()?.sharing).toBe(true);
	});

	test("a reviewer comments under their own name and the owner sees it", async () => {
		const { review, session, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "name the ceiling", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toContain("> [!REVIEW] @alice: name the ceiling");
		const island = islandOf(await (await fetch(session.url)).text());
		expect(island.annotations).toEqual([{ anchor: 1, comment: "name the ceiling", author: "alice" }]);
	});

	test("a reviewer's post keeps the review open and tells the owner's page", async () => {
		const { review, session, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's page is reading the loopback stream before the post lands.
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "name the ceiling", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toContain("@alice: name the ceiling");
		expect(await frame).toBe("comment");
		// A post is not a decision: the review is still waiting for its owner.
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(50).then(() => "pending")]);
		expect(outcome).toBe("pending");
		expect((await fetch(session.url)).status).toBe(200);
	});

	test("a reviewer's second post replaces her comment and nobody else's", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] mine\n> [!REVIEW] @bob: theirs\n- [ ] two\n";
		const { review, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true }, seeded);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = (comment: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment, author: "priya" }] }),
			});

		expect((await post("first note")).status).toBe(200);
		expect((await post("second note")).status).toBe(200);

		const text = content();
		expect(text).toContain("> [!REVIEW] @priya: second note");
		expect(text).not.toContain("first note");
		expect(text).toContain("> [!REVIEW] mine");
		expect(text).toContain("> [!REVIEW] @bob: theirs");
	});

	test("a reviewer must choose a name, and can never save, approve, or cancel", async () => {
		const { review } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const origin = new URL(link.url).origin;
		const post = (route: string, body = "{}") =>
			fetch(apiOf(link.url, route), {
				method: "POST",
				headers: { "content-type": "application/json", origin },
				body,
			});

		const anonymous = await post("/api/comment", JSON.stringify({ annotations: [{ anchor: 1, comment: "hi" }] }));
		expect(anonymous.status).toBe(400);
		// An empty post claims nothing either, so it cannot bind a name by accident.
		expect((await post("/api/comment", JSON.stringify({ annotations: [] }))).status).toBe(400);
		expect((await post("/api/feedback")).status).toBe(403);
		expect((await post("/api/approve")).status).toBe(403);
		expect((await post("/api/cancel")).status).toBe(403);
		expect((await post("/api/share")).status).toBe(403);
	});

	test("stop sharing revokes the reviewer token and closes the shared listener", async () => {
		const { review } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stopped = await review.stopSharing();
		expect(stopped?.state.sharing).toBe(false);

		const refused = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "late", author: "alice" }] }),
		}).then(
			(response) => `answered ${response.status}`,
			() => "refused",
		);
		expect(refused).toBe("refused");
	});

	test("a reviewer's post tells the owner's terminal, and the owner's own save does not", async () => {
		const told: Array<[string, number]> = [];
		const { review, session } = await startShared(
			{ networkInterfaces: LAN },
			{ canApprove: true, onReviewerComment: (author, count) => told.push([author, count]) },
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const posted = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({
				annotations: [
					{ anchor: 1, comment: "one", author: "alice" },
					{ anchor: 2, comment: "two", author: "alice" },
				],
			}),
		});
		expect(posted.status).toBe(200);
		expect(told).toEqual([["alice", 2]]);

		await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(session.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "owner's" }] }),
		});
		expect(told).toEqual([["alice", 2]]);
	});

	test("a reviewer re-posting the page's comments does not duplicate them", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] mine\n> [!REVIEW] @bob: theirs\n- [ ] two";
		const { review, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true }, seeded);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const page = islandOf(await (await fetch(link.url)).text());
		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			// What a reviewer's page posts: her own comments, including the new one.
			body: JSON.stringify({
				annotations: [
					...page.annotations.filter((annotation) => annotation.author === "priya"),
					{ anchor: 1, comment: "mine too", author: "priya" },
				],
			}),
		});

		expect(response.status).toBe(200);
		const text = content();
		expect(text.match(/> \[!REVIEW\] mine/g)?.length).toBe(1);
		expect(text.match(/@bob: theirs/g)?.length).toBe(1);
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		expect(text).toContain("> [!REVIEW] @priya: mine too");
	});

	test("a link posts under its own bound name, and the page learns it", async () => {
		const { review } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const comment = (author: string, text: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: text, author }] }),
			});

		const first = await comment("alice", "first note");
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true, author: "alice" });
		// The island carries the bound name, which is what stops the name dialog.
		expect(islandOf(await (await fetch(link.url)).text()).author).toBe("alice");
	});

	test("a bound link cannot post under another reviewer's name", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] @bob: theirs\n- [ ] two";
		const { review, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true }, seeded);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = (author: string, text: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: text, author }] }),
			});

		expect((await post("alice", "alice's note")).status).toBe(200);
		// A second tab of this link chose another name: it is stale, not authorized.
		const spoofed = await post("bob", "not mine");
		expect(spoofed.status).toBe(409);
		expect(await spoofed.json()).toMatchObject({ error: expect.stringContaining("@alice") });

		const text = content();
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		expect(text).not.toContain("not mine");
	});

	test("a re-shared link may claim a name the revoked one released", async () => {
		const { review } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		await fetch(apiOf(first.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(first.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "a", author: "alice" }] }),
		});
		await review.stopSharing();
		const second = (await review.share())?.state.links[0];
		if (!second) throw new Error("no second share link");

		const response = await fetch(apiOf(second.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(second.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "b", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, author: "alice" });
	});

	test("a repeating token generator cannot turn the owner's page into a reviewer's", async () => {
		const { review, session } = await startShared(
			{ networkInterfaces: LAN, token: () => "same" },
			{ canApprove: true },
		);
		expect((await review.share())?.state.sharing).toBe(true);

		const html = await (await fetch(session.url)).text();
		expect(html).toContain('id="share"');
		expect(html).not.toContain('id="reviewer-name"');
		expect(html).toContain('"role":"owner"');
	});

	test("a reviewer's save with nothing new changes nothing", async () => {
		const { review, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = () =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: "note", author: "priya" }] }),
			});

		expect((await post()).status).toBe(200);
		const before = content();
		expect((await post()).status).toBe(200);
		expect(content()).toBe(before);
	});

	test("mints one link per person, while sharing again re-reads the first", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");

		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };

		expect(invited.share.links.map((link) => link.id)).toEqual(["link-1", "link-2"]);
		expect(invited.share.links[1]?.url).not.toBe(first.url);
		// Share still re-reads what is already shared, so a stray click mints nothing.
		expect((await review.share())?.state.links[0]?.url).toBe(first.url);
	});

	test("two links post under their own names in one review", async () => {
		const { review, session, content } = await startShared({ networkInterfaces: LAN });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };
		const second = invited.share.links[1];
		if (!second) throw new Error("no second share link");

		expect((await reviewerPost(first, "alice", "mine")).status).toBe(200);
		expect((await reviewerPost(second, "bob", "theirs")).status).toBe(200);

		const text = content();
		expect(text).toContain("> [!REVIEW] @alice: mine");
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		// The owner can see who holds each link without asking anyone.
		expect(review.shareState()?.links.map((link) => link.name)).toEqual(["alice", "bob"]);
	});

	test("revoking one link ends only that link, and the others keep posting", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };
		const second = invited.share.links[1];
		if (!second) throw new Error("no second share link");
		const surviving = await fetch(apiOf(second.url, "/events"));
		const frame = nextFrame(surviving.body);

		const revoked = await ownerShares(session, "/api/share/revoke", { id: "link-1" });
		expect(revoked.status).toBe(200);

		// The revoked link stops answering and its reviewer's post is refused.
		expect((await fetch(first.url)).status).toBe(403);
		expect((await reviewerPost(first, "alice", "stale")).status).toBe(403);
		// The link that was not revoked is told nothing and can still post.
		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
		expect((await reviewerPost(second, "bob", "still here")).status).toBe(200);
	});

	test("revoking the last link stops sharing and closes the listener", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const result = (await (await ownerShares(session, "/api/share/revoke", { id: link.id })).json()) as {
			share: ShareState;
		};

		expect(result.share).toEqual({ sharing: false, port: 0, links: [] });
		expect(review.shareState()?.sharing).toBe(false);
		// The shared listener is gone, so even a remembered token cannot reach it.
		await expect(fetch(link.url)).rejects.toThrow();
	});

	test("refuses a link id the review does not hold, and a body that names none", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		await review.share();

		expect((await ownerShares(session, "/api/share/revoke", { id: "link-9" })).status).toBe(404);
		expect((await ownerShares(session, "/api/share/revoke", {})).status).toBe(400);
	});

	test("refuses a ninth link, and says why", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN });
		await review.share();
		for (let index = 1; index < MAX_SHARE_LINKS; index++) await ownerShares(session, "/api/share/link");

		const capped = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };

		expect(capped.share.links).toHaveLength(MAX_SHARE_LINKS);
		expect(capped.share.reason).toContain(`${MAX_SHARE_LINKS} links`);
	});

	test("a reviewer cannot mint, revoke, or stop sharing", async () => {
		const { review } = await startShared({ networkInterfaces: LAN });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		for (const route of ["/api/share/link", "/api/share/revoke", "/api/share/stop"]) {
			const response = await fetch(apiOf(link.url, route), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ id: link.id }),
			});
			expect(response.status).toBe(403);
		}
		expect(review.shareState()?.links).toHaveLength(1);
	});

	test("a second share reuses the link instead of minting another", async () => {
		const { review } = await startShared({ networkInterfaces: LAN });
		const first = (await review.share())?.state.links[0]?.url;
		const second = (await review.share())?.state.links[0]?.url;
		expect(second).toBe(first);
	});

	test("sharing twice from one review keeps one listener and one token", async () => {
		const { review } = await startShared({ networkInterfaces: LAN });
		const first = await review.share();
		const second = await review.share();
		expect(second?.state.links).toEqual(first?.state.links);
		expect(second?.state.sharing).toBe(true);
	});
});

function stored(content: string): StoredPlan {
	return { path: PATH, relativePath: RELATIVE, content, bytes: Buffer.byteLength(content, "utf-8") };
}

/** An in-memory plan store, so the session tests never touch the filesystem. */
function fakeStore(initial: string) {
	let content = initial;
	let gone = false;
	const store = {
		read: async (): Promise<StoredPlan | undefined> => (gone ? undefined : stored(content)),
		saveFeedback: async (
			_cwd: string,
			_path: string,
			annotations: PlanAnnotation[],
			options: { author?: string } = {},
		): Promise<StoredPlan> => {
			content = formatFeedback(content, annotations, options);
			return stored(content);
		},
	} as unknown as PlanStore;
	return {
		store,
		content: () => content,
		/** Rewrite the plan as another writer would, without announcing anything. */
		rewrite: (next: string) => {
			content = next;
		},
		/** Treat the plan as deleted, as a reader would see it. */
		remove: () => {
			gone = true;
		},
	};
}

const reviews: ReturnType<typeof createPlanWebReview>[] = [];

afterEach(async () => {
	await Promise.all(reviews.map((review) => review.closeAll()));
	reviews.length = 0;
});

async function start(
	content = "# Plan\n\n- [ ] step\n",
	options: PlanReviewOptions = {},
	deps: Partial<PlanWebReviewDeps> = {},
): Promise<PlanReviewSession> {
	const { store } = fakeStore(content);
	const opened: string[] = [];
	const review = createPlanWebReview(store, {
		open: (url) => opened.push(url),
		token: () => "tok",
		port: 0,
		...deps,
	});
	reviews.push(review);
	const session = await review.start("/repo", stored(content), options);
	if (!session) throw new Error("the review server did not start");
	expect(opened).toEqual([session.url]);
	expect(session.url).toContain("token=tok");
	return session;
}

/** A started review plus its server, for the tests that drive sharing. */
async function startShared(
	deps: Partial<PlanWebReviewDeps> = {},
	options: PlanReviewOptions = {},
	plan = "# Plan\n- [ ] one\n- [ ] two\n",
) {
	const { store, content, rewrite, remove } = fakeStore(plan);
	const review = createPlanWebReview(store, { open: () => {}, token: () => "tok", port: 0, ...deps });
	reviews.push(review);
	const session = await review.start("/repo", stored(content()), options);
	if (!session) throw new Error("the review server did not start");
	return { review, session, content, store, rewrite, remove };
}

/** A review that shares one remembered port across turns, as the extension does. */
function sessionSource() {
	const { store } = fakeStore("# Plan\n");
	const review = createPlanWebReview(store, { open: () => {}, token: () => "tok" });
	reviews.push(review);
	const open = async (): Promise<PlanReviewSession> => {
		const session = await review.start("/repo", stored("# Plan\n"));
		if (!session) throw new Error("the review server did not start");
		return session;
	};
	return { open };
}

const feedbackUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/feedback?token=tok`;
const approveUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/approve?token=tok`;
const cancelUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/cancel?token=tok`;
const eventsUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/events?token=tok`;

describe("review session", () => {
	test("serves the review page from the plan", async () => {
		const session = await start("# Plan\n");
		const response = await fetch(session.url);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('id="review-data"');
	});

	test("highlights a fenced code block and builds the outline", async () => {
		const session = await start("# Plan\n\n```ts\nconst x = 1;\n```\n");
		const data = islandOf(await (await fetch(session.url)).text());

		const [key, lines] = Object.entries(data.code)[0] ?? [];
		expect(key).toBeDefined();
		expect(lines?.join("")).toContain("tok-keyword");
		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan" }]);
	});

	test("reports the Steps section progress, not every checkbox", async () => {
		const plan = [
			"# Plan",
			"## Context",
			"- [ ] not a step",
			"## Steps",
			"- [x] Done one",
			"- [ ] Pending one",
			"## Verification",
			"- [ ] not a step either",
		].join("\n");
		const session = await start(plan);
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.steps).toEqual({ done: 1, total: 2 });
	});

	test("marks the outline section that changed since the previous review", async () => {
		const session = await start("# Plan\n\nNew body\n", { baseline: sectionDigests("# Plan\n\nOld body\n") });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan", changed: true }]);
	});

	test("marks the blocks that changed, in the lines the page draws", async () => {
		const plan = ["# Plan", "", "Kept.", "", "Edited now."].join("\n");
		const previous = ["# Plan", "", "Kept.", "", "Edited."].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		// The heading is line 0, "Kept." line 2, the edited paragraph line 4: only the
		// paragraph is new to this review, and the mark names the line the page draws.
		expect(data.changed).toEqual([4]);
		expect(data.blockMarks).toBe(true);
	});

	test("says a section lost blocks, which a document cannot draw in place", async () => {
		const plan = ["# Plan", "", "One."].join("\n");
		const previous = ["# Plan", "", "One.", "", "Two."].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan", changed: true, removed: 1 }]);
	});

	test("marks no blocks against a baseline written before block marks", async () => {
		// A baseline with section digests but no block digests is honoured at the depth it
		// can be: the section dot, and no guessed block marks.
		const aged = sectionDigests("# Plan\n\nOld body\n").map((section) => ({
			title: section.title,
			digest: section.digest,
		}));
		const session = await start("# Plan\n\nNew body\n", { baseline: aged });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.changed).toBeUndefined();
		expect(data.blockMarks).toBeUndefined();
		expect(data.outline[0]?.changed).toBe(true);
	});

	test("marks only the occurrence of a duplicate heading that changed", async () => {
		const plan = ["# Plan", "## Notes", "a", "## Notes", "b"].join("\n");
		const previous = ["# Plan", "## Notes", "a", "## Notes", "B"].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline.map((item) => item.changed === true)).toEqual([false, false, true]);
	});

	test("uses the plan's H1 as the review title and falls back to the slug", async () => {
		const titled = await start("# Add rate limiting\n\nBody\n");
		expect(islandOf(await (await fetch(titled.url)).text()).title).toBe("Add rate limiting");

		const untitled = await start("Just prose, no heading.\n");
		expect(islandOf(await (await fetch(untitled.url)).text()).title).toBe("demo");
	});

	test("keys a tab's draft on the plan text it rendered", async () => {
		const session = await start("# Plan\n\nbody\n");
		const rev = islandOf(await (await fetch(session.url)).text()).rev;
		expect(rev).toBeTruthy();
		// The same text keeps the same key, so a reload restores the draft.
		expect(islandOf(await (await fetch(session.url)).text()).rev).toBe(rev);

		const rewritten = await start("# Plan\n\nother body\n");
		expect(islandOf(await (await fetch(rewritten.url)).text()).rev).not.toBe(rev);
	});

	test("rejects a request without the session token", async () => {
		const session = await start();
		const response = await fetch(`http://127.0.0.1:${session.port}/`);
		expect(response.status).toBe(403);
	});

	test("resolves saved with the annotations written into the plan", async () => {
		const session = await start();
		const response = await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 2, comment: "make it concrete" }] }),
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("saved");
		if (result.status === "saved") {
			expect(result.annotations).toEqual([{ anchor: 2, comment: "make it concrete" }]);
			expect(result.plan.content).toContain("> [!REVIEW] make it concrete");
		}
	});

	test("keeps the moved flag on a comment the page posts back", async () => {
		// A refinement carried the note onto another block, and the page is the only place
		// that still knows. A save must not rewrite it as though it sat there all along.
		const session = await start("# Plan\n\nA paragraph.\n");
		const response = await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 2, comment: "check this", moved: true }] }),
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("saved");
		if (result.status === "saved") expect(result.plan.content).toContain("> [!REVIEW moved] check this");
	});

	test("resolves cancelled when the user cancels", async () => {
		const session = await start();
		expect((await fetch(cancelUrl(session), { method: "POST" })).status).toBe(200);
		expect((await session.done).status).toBe("cancelled");
	});

	test("resolves approved with the saved comments", async () => {
		const session = await start("# Plan\n\n- [ ] step\n", { canApprove: true });
		const response = await fetch(approveUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 2, comment: "ship it" }] }),
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("approved");
		if (result.status === "approved") {
			expect(result.annotations).toEqual([{ anchor: 2, comment: "ship it" }]);
			expect(result.plan.content).toContain("> [!REVIEW] ship it");
		}
	});

	test("refuses approve when the session is comment-only", async () => {
		const session = await start();
		expect((await fetch(approveUrl(session), { method: "POST" })).status).toBe(403);

		await fetch(cancelUrl(session), { method: "POST" });
		expect((await session.done).status).toBe("cancelled");
	});

	test("offers the approve action only when the session allows it", async () => {
		const approvable = await start("# Plan\n", { canApprove: true });
		expect(await (await fetch(approvable.url)).text()).toContain('id="approve"');

		const commentOnly = await start("# Plan\n");
		expect(await (await fetch(commentOnly.url)).text()).not.toContain('id="approve"');
	});

	test("delivers every terminal response before the session closes", async () => {
		const cases = [
			{
				canApprove: false,
				url: feedbackUrl,
				body: JSON.stringify({ annotations: [{ anchor: 0, comment: "note" }] }),
				status: "saved",
			},
			{
				canApprove: true,
				url: approveUrl,
				body: JSON.stringify({ annotations: [{ anchor: 0, comment: "go" }] }),
				status: "approved",
			},
			{ canApprove: false, url: cancelUrl, body: undefined, status: "cancelled" },
		] as const;

		for (const item of cases) {
			const session = await start("# Plan\n", { canApprove: item.canApprove });
			const init: RequestInit = { method: "POST" };
			if (item.body) {
				init.headers = { "Content-Type": "application/json" };
				init.body = item.body;
			}
			const pending = fetch(item.url(session), init);

			expect((await session.done).status).toBe(item.status);
			await session.close();
			expect((await pending).status).toBe(200);
		}
	});

	test("resolves cancelled when the turn aborts", async () => {
		const controller = new AbortController();
		const session = await start("# Plan\n", { signal: controller.signal });

		controller.abort();
		expect((await session.done).status).toBe("cancelled");
	});

	test("a reload that reconnects inside the grace does not cancel the review", async () => {
		// The grace is a timer, so the test owns it: a real deadline of a few tens of
		// milliseconds fails on a loaded runner, which says nothing about the code.
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const session = await start("# Plan\n", {}, { schedule });
		const events = eventsUrl(session);

		// The page loads, then reloads: its stream drops and a new one arrives.
		const first = new AbortController();
		const page = await fetch(events, { signal: first.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		first.abort();
		await waitFor(() => armed !== undefined);

		// A dropped stream is a question with a deadline, not a decision.
		const pending = armed;
		expect(pending).toBeDefined();

		const second = new AbortController();
		expect((await fetch(events, { signal: second.signal })).status).toBe(200);
		await waitFor(() => armed === undefined);

		// The reload got in: the grace that was armed for the first stream is gone.
		pending?.();
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");

		// Closing the tab for real is a drop nobody answers.
		second.abort();
		await waitFor(() => armed !== undefined);
		armed?.();
		expect((await session.done).status).toBe("cancelled");
	});

	test("a reviewer's dropped stream neither arms nor ends the review", async () => {
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const { review, session } = await startShared({ networkInterfaces: LAN, schedule }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The reviewer's page loads, then that tab closes.
		const reviewer = new AbortController();
		const page = await fetch(apiOf(link.url, "/events"), { signal: reviewer.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		reviewer.abort();
		await settle(50);

		// The review's lifetime is the owner's page, not the reviewer's.
		expect(armed).toBeUndefined();
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");
	});

	test("a reviewer's reconnect does not cancel the owner's pending teardown", async () => {
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const { review, session } = await startShared({ networkInterfaces: LAN, schedule }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's tab closes, arming the teardown.
		const owner = new AbortController();
		const page = await fetch(eventsUrl(session), { signal: owner.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		owner.abort();
		await waitFor(() => armed !== undefined);
		const pending = armed;

		// A reviewer opens the shared link before the grace fires.
		const reviewer = new AbortController();
		expect((await fetch(apiOf(link.url, "/events"), { signal: reviewer.signal })).status).toBe(200);
		await settle(20);
		expect(armed).toBe(pending);

		pending?.();
		expect((await session.done).status).toBe("cancelled");
		reviewer.abort();
	});

	test("stop sharing tells a reviewer why and leaves the review open", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stream = await fetch(apiOf(link.url, "/events"));
		const frame = nextFrame(stream.body);

		await review.stopSharing();
		expect(await frame).toBe("revoked");
		// Revoking the link is not a decision about the plan.
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");
		expect((await fetch(session.url)).status).toBe(200);
	});

	test("closing the review tells a reviewer why it stopped", async () => {
		const { review, session } = await startShared({ networkInterfaces: LAN }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stream = await fetch(apiOf(link.url, "/events"));
		const frame = nextFrame(stream.body);

		await session.close();
		expect(await frame).toBe("closed");
	});

	test("rejects an oversize body with a JSON 413, not a dropped connection", async () => {
		const session = await start("# Plan\n", {}, { maxBodyBytes: 64 });
		const response = await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 0, comment: "x".repeat(200) }] }),
		});

		expect(response.status).toBe(413);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	test("hands the client the server's own caps", async () => {
		const session = await start("# Plan\n");
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.limits).toEqual({
			comments: MAX_ANNOTATIONS,
			comment: MAX_COMMENT_LENGTH,
			quote: MAX_QUOTE_LENGTH,
		});
	});

	test("close is idempotent", async () => {
		const session = await start();
		await session.close();
		await session.close();
		expect((await session.done).status).toBe("cancelled");
	});

	test("reuses the same port for the same plan across turns", async () => {
		const source = sessionSource();
		const first = await source.open();
		const port = first.port;
		await first.close();

		const second = await source.open();
		expect(second.port).toBe(port);
	});

	test("falls back to a free port when the remembered one is busy", async () => {
		const source = sessionSource();
		const first = await source.open();
		const port = first.port;
		await first.close();

		const blocker = createServer(() => {});
		await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", () => resolve()));
		try {
			const second = await source.open();
			expect(second.port).not.toBe(port);
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});
});

describe("review outline", () => {
	const entries = [
		{ id: "s-1", level: 1, line: 1, text: "Goal" },
		{ id: "s-8", level: 2, line: 8, text: "Steps", changed: true },
		{ id: "s-20", level: 1, line: 20, text: "Risks" },
	];

	test("names the section a line belongs to, and none above the first", () => {
		expect(sectionFor(entries, 1)?.id).toBe("s-1");
		expect(sectionFor(entries, 7)?.id).toBe("s-1");
		expect(sectionFor(entries, 8)?.id).toBe("s-8");
		expect(sectionFor(entries, 19)?.id).toBe("s-8");
		expect(sectionFor(entries, 400)?.id).toBe("s-20");
		expect(sectionFor(entries, 0)).toBeNull();
		expect(sectionFor([], 4)).toBeNull();
	});

	test("carries the source, safe to splice into the client bundle", () => {
		// The bundle is a template literal: a backtick or an interpolation would end it.
		expect(WEB_OUTLINE_JS).not.toContain("`");
		expect(WEB_OUTLINE_JS).not.toContain("${");
		expect(WEB_OUTLINE_JS.split(String(sectionFor)).length).toBe(2);
		expect(REVIEW_CLIENT_JS).toContain("renderOutline(outlineList, outlineEntries())");
	});

	test("watches the blocks and marks the section the reader is in", () => {
		// The watcher is the page's own rule for "which section am I in": the last block
		// that crossed the top margin wins, and a page with no headings needs none.
		const made: Array<{ rootMargin: string; observed: string[] }> = [];
		class FakeObserver {
			readonly rootMargin: string;
			readonly observed: string[] = [];
			disconnected = false;
			constructor(callback: unknown, options: { rootMargin?: string }) {
				this.rootMargin = options.rootMargin ?? "";
				this.callback = callback as (entries: Array<{ isIntersecting: boolean; target: { id: string } }>) => void;
				made.push(this);
			}
			private readonly callback: (entries: Array<{ isIntersecting: boolean; target: { id: string } }>) => void;
			observe(node: { id: string }): void {
				this.observed.push(node.id);
			}
			disconnect(): void {
				this.disconnected = true;
			}
			fire(...ids: string[]): void {
				this.callback(ids.map((id) => ({ isIntersecting: true, target: { id } })));
			}
		}
		const before = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
		(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
		try {
			const link = (id: string) => {
				const node = {
					id,
					attributes: new Map<string, string>([["data-id", id]]),
					setAttribute(name: string, value: string) {
						node.attributes.set(name, value);
					},
					getAttribute(name: string) {
						return node.attributes.get(name) ?? null;
					},
					removeAttribute(name: string) {
						node.attributes.delete(name);
					},
				};
				return node;
			};
			const links = [link("s-1"), link("s-8")];
			const headings = [{ id: "s-1" }, { id: "s-8" }];
			const list = { querySelectorAll: () => links } as unknown as Parameters<typeof observeSections>[1];
			const planEl = { querySelectorAll: () => headings } as unknown as Parameters<typeof observeSections>[0];

			const watcher = observeSections(planEl, list, null) as unknown as FakeObserver;
			expect(watcher.observed).toEqual(["s-1", "s-8"]);
			expect(watcher.rootMargin).toBe("-88px 0px -68% 0px");

			watcher.fire("s-8");
			expect(links[1]?.getAttribute("aria-current")).toBe("true");
			expect(links[0]?.getAttribute("aria-current")).toBeNull();
			watcher.fire("s-1");
			expect(links[0]?.getAttribute("aria-current")).toBe("true");
			// One section at a time: the previous marker is cleared, not left behind.
			expect(links[1]?.getAttribute("aria-current")).toBeNull();

			const replacement = observeSections(planEl, list, watcher) as unknown as FakeObserver;
			expect(watcher.disconnected).toBe(true);
			expect(replacement.disconnected).toBe(false);

			// No headings, or no list, is no watcher: the page has nothing to follow.
			expect(
				observeSections({ querySelectorAll: () => [] } as unknown as Parameters<typeof observeSections>[0], list, null),
			).toBeNull();
			expect(observeSections(planEl, null, null)).toBeNull();
		} finally {
			(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = before;
		}
	});

	test("paints the facts, and counts each comment under the heading above it", () => {
		// The counters are renderOutline's own output, so the section a comment lands in is
		// the same rule the list was built with; a comment anchored above the first heading
		// is in no section and must not be counted into one.
		const node = (id: string) => ({
			id,
			hidden: false,
			textContent: id === "step-count" || id === "comment-total" || id.startsWith("count-") ? "0" : null,
			style: { width: "" },
		});
		const nodes: Record<string, ReturnType<typeof node>> = {
			"step-fact": node("step-fact"),
			"step-fill": node("step-fill"),
			"step-count": node("step-count"),
			"comment-total": node("comment-total"),
			"count-1": node("count-1"),
			"count-8": node("count-8"),
		};
		nodes["step-count"]!.textContent = "0/0";
		const before = (globalThis as { document?: unknown }).document;
		(globalThis as { document?: unknown }).document = { getElementById: (id: string) => nodes[id] ?? null };
		try {
			const counters = { 1: nodes["count-1"]!, 8: nodes["count-8"]! } as unknown as Parameters<typeof renderFacts>[2];
			const entries = [
				{ id: "s-1", level: 1, line: 1, text: "Goal" },
				{ id: "s-8", level: 2, line: 8, text: "Steps" },
			];
			renderFacts(
				{ done: 2, total: 5 },
				[{ anchor: 0 }, { anchor: 4 }, { anchor: 9 }, { anchor: 12 }],
				counters,
				entries,
			);
			expect(nodes["step-fact"]?.hidden).toBe(false);
			expect(nodes["step-fill"]?.style.width).toBe("40%");
			expect(nodes["step-count"]?.textContent).toBe("2/5");
			// Four comments, three of them in a section: the one above the first heading is not.
			expect(nodes["comment-total"]?.textContent).toBe("4");
			expect(nodes["count-1"]?.textContent).toBe("1");
			expect(nodes["count-1"]?.hidden).toBe(false);
			expect(nodes["count-8"]?.textContent).toBe("2");
			expect(nodes["count-8"]?.hidden).toBe(false);

			// A plan with no Steps section shows no progress: 0/0 is noise.
			renderFacts({ done: 0, total: 0 }, [], counters, entries);
			expect(nodes["step-fact"]?.hidden).toBe(true);
			expect(nodes["count-1"]?.hidden).toBe(true);
		} finally {
			(globalThis as { document?: unknown }).document = before;
		}
	});

	test("builds one list item per heading and returns the counters it made", () => {
		// The fake builder records what it was asked for, so the assertion is about the
		// document this function describes rather than about the strings in it.
		const made: Array<{ tag: string; className: string }> = [];
		const build = (tag: string, className?: string) => {
			const node = {
				tag,
				className: className ?? "",
				textContent: null as string | null,
				hidden: false,
				href: "",
				title: "",
				id: "",
				children: [] as unknown[],
				setAttribute() {},
				appendChild(child: unknown) {
					node.children.push(child);
				},
				replaceChildren() {
					node.children = [];
				},
			};
			made.push({ tag, className: node.className });
			return node;
		};
		const runtime = new Function("el", `${WEB_OUTLINE_JS}\nreturn { renderOutline: renderOutline };`)(build) as {
			renderOutline: typeof import("./web-outline.ts").renderOutline;
		};
		const list = build("ul", "review-nav") as unknown as Parameters<typeof runtime.renderOutline>[0];
		const counters = runtime.renderOutline(list, entries);
		expect(Object.keys(counters)).toEqual(["1", "8", "20"]);
		expect(made.filter((item) => item.tag === "li").map((item) => item.className)).toEqual(["lvl-1", "lvl-2", "lvl-1"]);
		expect(counters[8]?.hidden).toBe(true);
	});
});

describe("review block navigation", () => {
	/** A block node with the two members the rules touch, recording what it was told. */
	const block = (line: number) => ({
		line,
		active: false,
		scrolled: 0,
		classList: {
			toggle(name: string, on?: boolean) {
				if (name === "bf-block--active") this.owner.active = on === true;
			},
			add() {},
			remove() {},
			owner: undefined as unknown as { active: boolean },
		},
		scrollIntoView() {
			this.scrolled += 1;
		},
		getAttribute: () => String(line),
	});
	const make = (lines: number[]) => {
		const blocks = lines.map((line) => {
			const node = block(line);
			node.classList.owner = node;
			return node;
		});
		const planEl = {
			querySelectorAll: () => blocks,
			querySelector: (selector: string) => {
				const line = Number(/data-line="(\d+)"/.exec(selector)?.[1]);
				return blocks.find((node) => node.line === line) ?? null;
			},
		};
		return { blocks, planEl: planEl as unknown as Parameters<typeof blockElements>[0] };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_BLOCKS_JS).not.toContain("`");
		expect(WEB_BLOCKS_JS).not.toContain("${");
		for (const fn of [blockElements, setActive, moveActive, blockAtLine]) {
			expect(WEB_BLOCKS_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("an empty page has no active block, and the index it had is kept", () => {
		// `null` is the "nothing changed" answer: a caller must not be reset to zero by a
		// repaint that happened to run before the blocks were drawn.
		expect(blockElements(null)).toEqual([]);
		expect(setActive(null, 3)).toBeNull();
		expect(moveActive(null, 2, 1)).toBeNull();
	});

	test("clamps, marks one block at a time, and brings it into view", () => {
		const { blocks, planEl } = make([1, 8, 20]);
		expect(blockElements(planEl)).toHaveLength(3);
		expect(setActive(planEl, 9)).toBe(2);
		expect(blocks.map((node) => node.active)).toEqual([false, false, true]);
		expect(blocks[2]?.scrolled).toBe(1);
		expect(setActive(planEl, -4)).toBe(0);
		expect(blocks.map((node) => node.active)).toEqual([true, false, false]);
	});

	test("walks, and starts at the near end when nothing is active yet", () => {
		const { planEl } = make([1, 8, 20]);
		// Nothing active: j starts at the top, k at the bottom.
		expect(moveActive(planEl, -1, 1)).toBe(0);
		expect(moveActive(planEl, -1, -1)).toBe(2);
		// A step past the end clamps rather than wrapping: the reader asked for one more.
		expect(moveActive(planEl, 2, 1)).toBe(2);
		expect(moveActive(planEl, 0, 1)).toBe(1);
	});

	test("a filtered view is walked over, not through", () => {
		const { blocks, planEl } = make([1, 8, 20]);
		// The middle block is hidden by a view: `j` from the first lands on the third rather
		// than on a class nobody can see, and from a hidden block it steps back out.
		(blocks[1] as { hidden?: boolean }).hidden = true;
		expect(moveActive(planEl, 0, 1)).toBe(2);
		expect(moveActive(planEl, 2, -1)).toBe(0);
		expect(moveActive(planEl, 1, 1)).toBe(2);

		// Nothing visible left to walk to says so, instead of moving to a hidden block.
		(blocks[0] as { hidden?: boolean }).hidden = true;
		(blocks[2] as { hidden?: boolean }).hidden = true;
		expect(moveActive(planEl, 1, 1)).toBeNull();
	});

	test("needs both halves of a line to open a composer", () => {
		const { planEl } = make([1, 8]);
		expect(blockAtLine(planEl, [{ start: 1 }, { start: 8 }], 8)?.block.start).toBe(8);
		// Rendered but not in the island, or in the island but not rendered: neither opens.
		expect(blockAtLine(planEl, [{ start: 1 }], 8)).toBeNull();
		expect(blockAtLine(planEl, [{ start: 1 }, { start: 30 }], 30)).toBeNull();
		expect(blockAtLine(null, [{ start: 1 }], 1)).toBeNull();
	});
});

describe("review view filter", () => {
	/** A block or thread node with the members the filter reads. */
	const node = (attrs: Record<string, string>, className = "") => ({
		attrs,
		className,
		hidden: false,
		getAttribute: (name: string) => attrs[name] ?? null,
	});
	/** One page: its blocks, and the comment threads drawn under them. */
	const page = (blocks: ReturnType<typeof node>[], threads: ReturnType<typeof node>[] = []) =>
		({
			querySelectorAll: (selector: string) =>
				selector === ".bf-block" ? blocks : selector === ".bf-comments" ? threads : [],
		}) as unknown as Parameters<typeof applyView>[0];

	test("keeps the headings and what the view asks for, and hides the rest", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph", "data-changed": "1" }),
			node({ "data-line": "2", "data-kind": "paragraph" }),
		];
		const counts = applyView(page(blocks), "changed");
		expect(blocks.map((entry) => entry.hidden)).toEqual([false, false, true]);
		expect(counts).toEqual({ shown: 2, hidden: 1 });
	});

	test("hides a thread with its block, and leaves an orphan thread alone", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph", "data-changed": "1" }),
			node({ "data-line": "2", "data-kind": "paragraph" }),
		];
		const thread = node({ "data-line": "2" });
		const orphan = node({});
		applyView(page(blocks, [thread, orphan]), "changed");
		// A note whose block is hidden has no text to refer to; one no block claims is its own.
		expect(thread.hidden).toBe(true);
		expect(orphan.hidden).toBe(false);

		applyView(page(blocks, [thread, orphan]), "all");
		expect(thread.hidden).toBe(false);
	});

	test("a filter that matches nothing but headings keeps the document whole", () => {
		const blocks = [
			node({ "data-line": "0", "data-kind": "heading" }),
			node({ "data-line": "1", "data-kind": "paragraph" }),
		];
		// No block carries a change mark, so the Changed view has nothing to show.
		const counts = applyView(page(blocks), "changed");
		expect(blocks.map((entry) => entry.hidden)).toEqual([false, false]);
		expect(counts).toEqual({ shown: 2, hidden: 0 });
	});
});

describe("review draft guard", () => {
	const planWith = (value: string) => {
		const area = {
			value,
			focused: 0,
			focus() {
				this.focused += 1;
			},
		};
		const planEl = {
			querySelector: (selector: string) => (selector === ".bf-composer" ? { querySelector: () => area } : null),
		};
		return { area, planEl: planEl as unknown as Parameters<typeof draftTextarea>[0] };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_DRAFT_JS).not.toContain("`");
		expect(WEB_DRAFT_JS).not.toContain("${");
		for (const fn of [draftTextarea, guardDraft]) {
			expect(WEB_DRAFT_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a composer with only whitespace is not a draft", () => {
		expect(draftTextarea(planWith("  \n\t ").planEl)).toBeNull();
		expect(draftTextarea(planWith("half a thought").planEl)?.value).toBe("half a thought");
		expect(draftTextarea(planWith("x").planEl)?.value).toBe("x");
		expect(draftTextarea(null)).toBeNull();
		expect(draftTextarea({ querySelector: () => null } as unknown as Parameters<typeof draftTextarea>[0])).toBeNull();
	});

	test("the way out is refused, named, and the cursor is put where the text is", () => {
		const { area, planEl } = planWith("half a thought");
		const painted: Array<{ text: string; kind: string | undefined }> = [];
		const guard = (value: string) =>
			guardDraft(planEl, {} as Parameters<typeof guardDraft>[1], value, (_node, text, kind) => {
				painted.push({ text, kind });
			});
		expect(guard("Add or discard the comment you are writing.")).toBe(true);
		expect(painted).toEqual([{ text: "Add or discard the comment you are writing.", kind: "error" }]);
		expect(area.focused).toBe(1);

		// With nothing half-written, every way out is allowed and nothing is painted.
		painted.length = 0;
		expect(guardDraft(planWith("").planEl, null, "refusal", () => painted.push({ text: "x", kind: undefined }))).toBe(
			false,
		);
		expect(painted).toEqual([]);
	});
});

describe("review composer lifecycle", () => {
	const node = (className = "") => {
		const self: Record<string, unknown> = {
			className,
			textContent: null as string | null,
			title: "",
			hidden: false,
			href: "",
			id: "",
			style: { width: "" },
			composing: false,
			removed: false,
			classList: {
				add() {},
				remove(name: string) {
					if (name === "bf-block--composing") self.composing = false;
				},
				toggle() {},
			},
			setAttribute() {},
			getAttribute: () => "8",
			removeAttribute() {},
			appendChild() {},
			replaceChildren() {},
			remove() {
				self.removed = true;
			},
			querySelector: () => null,
			querySelectorAll: () => (self.composing ? [self] : []),
			addEventListener() {},
		};
		return self;
	};
	const deps = (over: Partial<Record<string, unknown>> = {}) => {
		const painted: Array<{ text: string; kind?: string }> = [];
		const opened: Array<{ quote: string; initial?: string }> = [];
		return {
			painted,
			opened,
			value: {
				planEl: null,
				statusEl: null,
				refusal: "Add or discard the comment you are writing.",
				setStatus: (text: string, kind?: string) => painted.push({ text, kind }),
				saveDraft: () => painted.push({ text: "saved" }),
				open: (_wrap: unknown, _block: unknown, quote: string, initial?: string) => opened.push({ quote, initial }),
				...over,
			} as Parameters<typeof closeComposer>[0] & { open: (w: unknown, b: unknown, q: string, i?: string) => void },
		};
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_COMPOSER_JS).not.toContain("`");
		expect(WEB_COMPOSER_JS).not.toContain("${");
		for (const fn of [closeComposer, reopenComposer, commentOnActive]) {
			expect(WEB_COMPOSER_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("closing drops the draft only when a composer was open", () => {
		// A close with nothing open must not rewrite — and so drop — a draft a reload restored.
		const empty = deps();
		closeComposer(empty.value);
		expect(empty.painted).toEqual([]);

		const composer = node("bf-composer") as { removed: boolean };
		const planEl = { querySelector: () => composer, querySelectorAll: () => [node()] };
		const filled = deps({ planEl });
		closeComposer(filled.value);
		expect(composer.removed).toBe(true);
		expect(filled.painted).toEqual([{ text: "saved", kind: undefined }]);
	});

	test("a stale refusal is cleared, a fresh status is left alone", () => {
		const stale = deps();
		stale.value.statusEl = { textContent: "Add or discard the comment you are writing." } as never;
		closeComposer(stale.value);
		expect(stale.painted).toEqual([{ text: "", kind: undefined }]);

		const other = deps();
		other.value.statusEl = { textContent: "Comment added." } as never;
		closeComposer(other.value);
		expect(other.painted).toEqual([]);
	});

	test("a settled review has no draft to reopen", () => {
		const withBlock = deps({ planEl: { querySelector: () => node(), querySelectorAll: () => [] } });
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: true, approved: false, closed: false }, [{ start: 8 }]);
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: false, approved: true, closed: false }, [{ start: 8 }]);
		reopenComposer(withBlock.value, { anchor: 8 }, { saved: false, approved: false, closed: true }, [{ start: 8 }]);
		reopenComposer(withBlock.value, undefined, { saved: false, approved: false, closed: false }, []);
		expect(withBlock.opened).toEqual([]);

		// A page still asking gets its half-written comment back, quote and text.
		reopenComposer(
			withBlock.value,
			{ anchor: 8, quote: "the plan", text: "half a thought" },
			{ saved: false, approved: false, closed: false },
			[{ start: 8 }],
		);
		expect(withBlock.opened).toEqual([{ quote: "the plan", initial: "half a thought" }]);
	});

	test("the keyboard's composer opens on the active block, starting one if none is", () => {
		const opened: string[] = [];
		const blocks = [node()];
		const planEl = { querySelector: () => blocks[0], querySelectorAll: () => blocks };
		const subject = deps({ planEl, open: (_w: unknown, _b: unknown, quote: string) => opened.push(quote) });
		// Nothing active: it becomes the first block, and that is what gets the composer.
		expect(commentOnActive(subject.value, -1, [{ start: 8 }])).toBe(0);
		expect(opened).toEqual([""]);
		// No blocks at all: the index is kept rather than reset to zero.
		const bare = deps({ planEl: { querySelector: () => null, querySelectorAll: () => [] } });
		expect(commentOnActive(bare.value, 4, [])).toBe(4);
		expect(bare.opened).toEqual([]);
	});
});

describe("review plan renderer", () => {
	/** A node factory with the members one frame touches, recording what it was told. */
	function makeDom() {
		const made: Array<{
			tag: string;
			className: string;
			attrs: Record<string, string>;
			children: unknown[];
			listeners: Record<string, Array<() => void>>;
			classes: string[];
			textContent: string | null;
			title: string;
			id: string;
			type: string;
			focused: number;
		}> = [];
		const build = (tag: string, className = "") => {
			const node = {
				tag,
				className,
				attrs: {} as Record<string, string>,
				children: [] as unknown[],
				listeners: {} as Record<string, Array<() => void>>,
				classes: className ? className.split(" ") : [],
				textContent: null as string | null,
				title: "",
				id: "",
				type: "",
				focused: 0,
				style: { width: "" },
				scrollTop: 0,
				hidden: false,
				href: "",
				setAttribute(name: string, value: string) {
					node.attrs[name] = value;
				},
				getAttribute: (name: string) => node.attrs[name] ?? null,
				removeAttribute(name: string) {
					delete node.attrs[name];
				},
				appendChild(child: unknown) {
					node.children.push(child);
				},
				replaceChildren() {
					node.children = [];
				},
				remove() {},
				classList: {
					add(name: string) {
						node.classes.push(name);
					},
					remove() {},
					toggle() {},
				},
				addEventListener(type: string, listener: () => void) {
					(node.listeners[type] = node.listeners[type] ?? []).push(listener);
				},
				querySelector: () => null,
				querySelectorAll: () => [],
				contains: () => false,
				focus() {
					node.focused += 1;
				},
				scrollIntoView() {},
			};
			made.push(node);
			return node;
		};
		return { made, build };
	}

	const plan = (over: Record<string, unknown> = {}) => {
		const dom = makeDom();
		const calls = {
			blocks: [] as string[],
			cards: 0,
			facts: 0,
			state: 0,
			closed: 0,
			opened: [] as string[],
			active: [] as number[],
		};
		const planEl = dom.build("main") as unknown as Parameters<typeof renderPlanFrame>[0]["planEl"];
		const deps = {
			planEl,
			outlineList: null,
			focused: null,
			blocks: () => [
				{ start: 1, kind: "heading" },
				{ start: 2, kind: "blank" },
				{ start: 3, kind: "para" },
			],
			annotations: () => [{ anchor: 3 }, { anchor: 99 }],
			activeIndex: () => 1,
			setActiveIndex: (index: number) => calls.active.push(index),
			pendingQuote: () => ({ wrap: null as never, quote: "the plan" }),
			clearPendingQuote: () => {},
			composer: () => ({}) as never,
			renderBlock: (_wrap: unknown, block: { kind?: string }) => {
				calls.blocks.push(String(block.kind ?? ""));
			},
			renderComments: () => {},
			renderCommentCards: () => {
				calls.cards += 1;
			},
			selectionIn: () => "selected text",
			open: (_wrap: unknown, _block: unknown, quote: string) => calls.opened.push(quote),
			facts: () => {
				calls.facts += 1;
			},
			updateState: () => {
				calls.state += 1;
			},
			...over,
		} as Parameters<typeof renderPlanFrame>[0];
		return { deps, dom, calls };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_PLAN_JS).not.toContain("`");
		expect(WEB_PLAN_JS).not.toContain("${");
		expect(WEB_PLAN_JS).toBe(String(renderPlanFrame));
		expect(REVIEW_CLIENT_JS).toContain(
			"renderPlanFrame(planFrame(), closeOpenComposer, observeSections, sectionObserver)",
		);
	});

	test("draws one block per non-blank line, and nothing for a blank", () => {
		const { deps, calls, dom } = plan();
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const observer = { observe() {}, disconnect() {} };
		const installed = runtime(
			deps,
			() => (calls.closed += 1),
			() => observer,
			null,
		);
		expect(installed).toBe(observer);
		// Two blocks drawn, in order, each told which island line and kind it stands for.
		expect(calls.blocks).toEqual(["heading", "para"]);
		expect(calls.closed).toBe(1);
		expect(calls.facts).toBe(1);
		expect(calls.state).toBe(1);
		// The orphaned anchor is the only card set the frame had to draw separately.
		expect(calls.cards).toBe(1);
	});

	test("a click reads the quote at click time, and hands the block its selection", () => {
		const { deps, calls, dom } = plan();
		let pending: { wrap: unknown; quote: string } | null = null;
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const withPending = {
			...deps,
			pendingQuote: () => pending,
			clearPendingQuote: () => {
				pending = null;
			},
		} as Parameters<typeof renderPlanFrame>[0];
		runtime(
			withPending,
			() => {},
			() => null,
			null,
		);
		// Every block's "+" control was wired; firing one with no pending quote asks the
		// page what the reader selected.
		const adds = dom.made.filter((node) => node.className === "bf-block__add");
		expect(adds).toHaveLength(2);
		for (const listener of adds[0]?.listeners.click ?? []) listener();
		expect(calls.opened).toEqual(["selected text"]);
		// With a pending quote for that block — the block itself, not its control — the
		// quote is what the comment carries.
		const blocks = dom.made.filter((node) => node.className === "bf-block");
		expect(blocks).toHaveLength(2);
		pending = { wrap: blocks[1] as never, quote: "the plan" };
		for (const listener of adds[1]?.listeners.click ?? []) listener();
		expect(calls.opened).toEqual(["selected text", "the plan"]);
		expect(pending).toBeNull();
	});

	test("a settled review draws no control to add a comment", () => {
		// The composer would accept the note and report it added, and nothing could ever save
		// it: the rail's control goes with the buttons the settlement disables.
		const { deps, dom } = plan({ settled: () => true });
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		runtime(
			deps,
			() => {},
			() => null,
			null,
		);
		expect(dom.made.filter((node) => node.className === "bf-block__add")).toHaveLength(0);
		// The blocks themselves are still drawn, and still carry their comment cards.
		expect(dom.made.filter((node) => node.className === "bf-block")).toHaveLength(2);
	});

	test("restores focus only when it was inside the plan to begin with", () => {
		const { deps, dom } = plan();
		const runtime = new Function("el", "blockElements", "setActive", `${WEB_PLAN_JS}\nreturn renderPlanFrame;`)(
			dom.build,
			blockElements,
			setActive,
		) as typeof renderPlanFrame;
		const focused = { focus() {}, className: "bf-block__add", focused: 0 } as never;
		// `planEl.contains` answers true for this node, so the tab stop goes back on it.
		const inside = {
			...deps,
			focused: focused,
			planEl: { ...(deps.planEl as object), contains: () => true, querySelector: () => null } as never,
		} as Parameters<typeof renderPlanFrame>[0];
		runtime(
			inside,
			() => {},
			() => null,
			null,
		);
		// No blocks were reachable through the stub's querySelectorAll, so nothing is focused:
		// the rule is visible in the frame's own source rather than in a focused node.
		expect(WEB_PLAN_JS).toContain(
			"const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));",
		);
	});
});

describe("review settlement", () => {
	const harness = (answer: { ok: boolean; status: number; body: unknown }, over: Record<string, unknown> = {}) => {
		const painted: Array<{ text: string; kind?: string }> = [];
		const calls = {
			clean: 0,
			draft: 0,
			state: 0,
			reload: 0,
			lock: 0,
			settled: [] as string[],
			adopted: [] as string[],
			sent: [] as string[],
		};
		const buttons = { approve: { disabled: false }, save: { disabled: false }, post: { disabled: false } };
		const deps = {
			token: () => "s3cret",
			role: () => "owner",
			mine: () => [{ anchor: 1 }],
			annotations: () => [{ anchor: 1 }, { anchor: 2 }],
			settled: () => false,
			setStatus: (text: string, kind?: string) => painted.push({ text, kind }),
			buttons: () => buttons,
			clearDraft: () => (calls.draft += 1),
			markClean: () => (calls.clean += 1),
			adoptName: (name: string) => calls.adopted.push(name),
			offerReload: () => (calls.reload += 1),
			markSettled: (kind: string) => calls.settled.push(kind),
			settleStream: () => calls.settled.push("stream"),
			lockActions: () => (calls.lock += 1),
			updateState: () => (calls.state += 1),
			confirmNoDraft: () => false,
			post: async (url: string) => {
				calls.sent.push(url);
				return answer;
			},
			send: async (url: string) => calls.sent.push(url),
			planMoved: "The plan changed on disk \u2014 reload to review again.",
			...over,
		} as Parameters<typeof submitAnnotations>[0];
		return { deps, painted, calls, buttons };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_SETTLE_JS).not.toContain("`");
		expect(WEB_SETTLE_JS).not.toContain("${");
		for (const fn of [submitAnnotations, saveReview, postReviewComments, approveReview, cancelReview]) {
			expect(WEB_SETTLE_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a reviewer posts only her own comments, and an owner posts all of them", async () => {
		const owner = harness({ ok: true, status: 200, body: null });
		await submitAnnotations(owner.deps, "/api/comment", "posted", "failed: ", null);
		expect(owner.calls.sent).toEqual(["/api/comment?token=s3cret"]);

		const reviewer = harness({ ok: true, status: 200, body: null }, { role: () => "reviewer" });
		let sent: unknown = null;
		reviewer.deps.post = async (_url: string, body: unknown) => {
			sent = body;
			return { ok: true, status: 200, body: null };
		};
		await submitAnnotations(reviewer.deps, "/api/comment", "posted", "failed: ", null);
		// The reviewer's payload is her own write, not the page's whole comment list.
		expect(sent).toEqual({ annotations: [{ anchor: 1 }] });
	});

	test("a success clears the draft, paints the sentence, and reports it once", async () => {
		const { deps, painted, calls } = harness({ ok: true, status: 200, body: { author: "mei" } });
		let onOk = 0;
		const result = await submitAnnotations(deps, "/api/feedback", "Saved.", "Could not save: ", () => (onOk += 1));
		expect(result.outcome).toBe("ok");
		expect(calls.clean).toBe(1);
		expect(calls.draft).toBe(1);
		expect(onOk).toBe(1);
		expect(painted).toEqual([{ text: "Saved.", kind: "saved" }]);
		// An owner posts untagged comments; the name the server bound is a reviewer's.
		expect(calls.adopted).toEqual([]);
	});

	test("a reviewer adopts the name the server bound to her link", async () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: { author: "mei" } }, { role: () => "reviewer" });
		await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(calls.adopted).toEqual(["mei"]);
	});

	test("a conflict disables the writes, offers a reload, and says the server's reason", async () => {
		const { deps, buttons, calls, painted } = harness({
			ok: false,
			status: 409,
			body: { error: "a link is bound to @mei" },
		});
		const result = await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(result.outcome).toBe("conflict");
		expect(buttons).toEqual({ approve: { disabled: true }, save: { disabled: true }, post: { disabled: true } });
		expect(calls.reload).toBe(1);
		expect(painted).toEqual([{ text: "a link is bound to @mei", kind: "error" }]);
	});

	test("a conflict with no sentence of its own falls back to the plan-moved line", async () => {
		const { deps, painted } = harness({ ok: false, status: 409, body: null });
		await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(painted).toEqual([{ text: "The plan changed on disk \u2014 reload to review again.", kind: "error" }]);
	});

	test("a refusal surfaces the server's reason under the caller's prefix", async () => {
		const { deps, painted } = harness({ ok: false, status: 422, body: { error: "comment is empty" } });
		const result = await submitAnnotations(deps, "/api/feedback", "saved", "Could not save: ", null);
		expect(result.outcome).toBe("failed");
		expect(painted).toEqual([{ text: "Could not save: comment is empty", kind: "error" }]);
	});

	test("a settled review writes nothing at all", () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: null }, { settled: () => true });
		expect(saveReview(deps)).toBeNull();
		expect(approveReview(deps)).toBeNull();
		expect(postReviewComments(deps)).toBeNull();
		expect(cancelReview(deps)).toBeNull();
		expect(calls.sent).toEqual([]);
	});

	test("saving and approving mark the review settled; cancelling is the owner's alone", async () => {
		const save = harness({ ok: true, status: 200, body: null });
		await saveReview(save.deps);
		expect(save.calls.settled).toEqual(["saved", "stream"]);
		expect(save.calls.lock).toBe(1);

		const approve = harness({ ok: true, status: 200, body: null });
		await approveReview(approve.deps);
		expect(approve.calls.settled).toEqual(["approved", "stream"]);

		const close = harness({ ok: true, status: 200, body: null });
		await cancelReview(close.deps);
		expect(close.calls.settled).toEqual(["closed", "stream"]);
		expect(close.calls.sent).toEqual(["/api/cancel?token=s3cret"]);
		expect(close.painted.at(-1)).toEqual({ text: "Closed \u2014 return to Pi.", kind: undefined });

		const reviewer = harness({ ok: true, status: 200, body: null }, { role: () => "reviewer" });
		expect(cancelReview(reviewer.deps)).toBeNull();
		expect(reviewer.calls.sent).toEqual([]);
	});

	test("a half-written comment refuses the way out before anything is sent", async () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: null }, { confirmNoDraft: () => true });
		expect(saveReview(deps)).toBeNull();
		expect(postReviewComments(deps)).toBeNull();
		expect(cancelReview(deps)).toBeNull();
		expect(calls.sent).toEqual([]);
	});
});

describe("review keyboard", () => {
	const harness = (over: Record<string, unknown> = {}) => {
		const calls: string[] = [];
		const deps = {
			composerOpen: () => false,
			closeComposer: () => calls.push("closeComposer"),
			cancel: () => calls.push("cancel"),
			sheetOpen: () => false,
			toggleSheet: () => calls.push("toggleSheet"),
			moveActive: (delta: number) => calls.push("move" + delta),
			commentOnActive: () => calls.push("comment"),
			askApprove: () => calls.push("approve"),
			save: () => calls.push("save"),
			postComments: () => calls.push("post"),
			hasSaveControl: () => true,
			hasApproveControl: () => true,
			typing: () => false,
			...over,
		} as Parameters<typeof handleKey>[1];
		const event = (key: string, more: Record<string, unknown> = {}) => {
			let prevented = 0;
			return {
				sent: { key, preventDefault: () => (prevented += 1), ...more } as Parameters<typeof handleKey>[0],
				get prevented() {
					return prevented;
				},
			};
		};
		return { deps, calls, event };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_KEYS_JS).not.toContain("`");
		expect(WEB_KEYS_JS).not.toContain("${");
		expect(WEB_KEYS_JS.split(String(handleKey)).length).toBe(2);
		expect(WEB_KEYS_JS.split(String(rememberSelection)).length).toBe(2);
	});

	test("Esc peels the composer first, then closes the review", () => {
		const withComposer = harness({ composerOpen: () => true });
		handleKey(withComposer.event("Escape").sent, withComposer.deps);
		expect(withComposer.calls).toEqual(["closeComposer"]);

		const bare = harness();
		handleKey(bare.event("Escape").sent, bare.deps);
		expect(bare.calls).toEqual(["cancel"]);
	});

	test("a field owns the keyboard, and a modified key is never a shortcut", () => {
		const typing = harness({ typing: () => true });
		handleKey(typing.event("j").sent, typing.deps);
		handleKey(typing.event("?").sent, typing.deps);
		expect(typing.calls).toEqual([]);

		const modified = harness();
		handleKey(modified.event("s", { ctrlKey: true }).sent, modified.deps);
		handleKey(modified.event("k", { metaKey: true }).sent, modified.deps);
		expect(modified.calls).toEqual([]);
	});

	test("the sheet owns the keyboard while it is open, and ? is what opens it", () => {
		const closed = harness();
		const question = closed.event("?");
		handleKey(question.sent, closed.deps);
		expect(closed.calls).toEqual(["toggleSheet"]);
		expect(question.prevented).toBe(1);

		const open = harness({ sheetOpen: () => true });
		for (const key of ["j", "k", "c", "a", "s"]) handleKey(open.event(key).sent, open.deps);
		expect(open.calls).toEqual([]);
	});

	test("j and k walk, c comments, a approves", () => {
		const { deps, calls } = harness();
		handleKey({ key: "j", preventDefault() {} }, deps);
		handleKey({ key: "k", preventDefault() {} }, deps);
		handleKey({ key: "c", preventDefault() {} }, deps);
		handleKey({ key: "a", preventDefault() {} }, deps);
		expect(calls).toEqual(["move1", "move-1", "comment", "approve"]);
	});

	test("s saves for an owner and posts for a reviewer", () => {
		// The same key means "write my work down": the owner's save ends the review, a
		// reviewer's post does not, and the page has one button at a time.
		const owner = harness();
		handleKey({ key: "s", preventDefault() {} }, owner.deps);
		expect(owner.calls).toEqual(["save"]);

		const reviewer = harness({ hasSaveControl: () => false });
		handleKey({ key: "s", preventDefault() {} }, reviewer.deps);
		expect(reviewer.calls).toEqual(["post"]);
	});

	test("a release remembers the selection, and forgets it outside a block", () => {
		const remembered: Array<{ wrap: unknown; quote: string } | null> = [];
		const block = { querySelector: () => null } as never;
		const deps = {
			planEl: {} as never,
			settled: () => false,
			selectionIn: () => "the plan",
			setPending: (quote: { wrap: unknown; quote: string } | null) => remembered.push(quote),
		} as Parameters<typeof rememberSelection>[1];

		rememberSelection({ closest: () => block }, deps);
		expect(remembered).toEqual([{ wrap: block, quote: "the plan" }]);

		// A release outside any block clears what was there: the next click must not quote it.
		rememberSelection({ closest: () => null }, deps);
		expect(remembered).toEqual([{ wrap: block, quote: "the plan" }, null]);

		// A settled review remembers nothing at all.
		const settled = { ...deps, settled: () => true } as Parameters<typeof rememberSelection>[1];
		rememberSelection({ closest: () => block }, settled);
		expect(remembered).toHaveLength(2);
	});
});

describe("the client bundle", () => {
	/**
	 * Every helper the fragments declare, read from their own sources.
	 *
	 * Sources rather than an import list on purpose: the failure this guards against is a
	 * function that lands in a module and is called from the bundle without being added to
	 * that module's `*_JS` source. Nothing else can see it — the bundle is a string, so the
	 * checker never reads it, and a suite that drives the typed function directly never
	 * runs the page's copy.
	 */
	function declaredFunctions(): string[] {
		const names = new Set<string>();
		for (const file of readdirSync(import.meta.dir)) {
			if (!/^web-.*\.ts$/.test(file) || file.endsWith(".test.ts")) continue;
			const source = readFileSync(join(import.meta.dir, file), "utf-8");
			for (const match of source.matchAll(/^(?:export )?function (\w+)/gm)) names.add(match[1] ?? "");
		}
		return [...names].filter((name) => name !== "");
	}

	test("carries every fragment function the bundle calls", () => {
		// `applyView`, `surfaceOf`, and `keyRows` were exactly this: called by the shipped
		// script, documented, and absent from it — a ReferenceError on the page's first
		// render and on every content key, with the whole suite green.
		const missing = declaredFunctions().filter(
			(name) =>
				new RegExp(`\\b${name}\\s*\\(`).test(REVIEW_CLIENT_JS) && !REVIEW_CLIENT_JS.includes(`function ${name}(`),
		);
		expect(missing).toEqual([]);
	});
});
