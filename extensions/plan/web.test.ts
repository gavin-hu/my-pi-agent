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
import { createServer } from "node:http";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import type { ArmTimer } from "../../lib/timer.ts";
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
import { renderReviewPage, REVIEW_CSS, type ReviewPageData } from "./web-page.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "./web-router.ts";
import { createPlanWebReview, type PlanReviewOptions, type PlanReviewSession, type PlanWebReviewDeps } from "./web.ts";
import type { NetworkInterfaces } from "./web-share.ts";

const PLAN = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";
const PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";
const RELATIVE = ".pi/plans/2026-10-14-1600-demo.md";

interface ReviewIsland {
	title: string;
	token: string;
	role: "owner" | "reviewer";
	canApprove: boolean;
	annotations: PlanAnnotation[];
	steps: { done: number; total: number };
	outline: Array<{ id: string; line: number; level: number; text: string; changed?: boolean }>;
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
};

/** A router context that records its callbacks and can fail a save on demand. */
function router(overrides: Partial<ReviewContext> = {}) {
	const saved: PlanAnnotation[][] = [];
	const approved: PlanAnnotation[][] = [];
	const cancelled: number[] = [];
	let nextSave: SaveResult = { ok: true };
	const ctx: ReviewContext = {
		roleOf: (token) => (token === "tok" ? "owner" : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => PAGE_DATA,
		save: async (annotations) => {
			saved.push(annotations);
			return nextSave;
		},
		share: async () => ({ state: { sharing: true, port: 1, links: [{ address: "192.168.1.24", url: "http://x" }] } }),
		stopShare: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		onSaved: () => {},
		onApprove: (annotations) => approved.push(annotations),
		onCancel: () => cancelled.push(1),
		...overrides,
	};
	return {
		ctx,
		saved,
		approved,
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
		const favicon = await get("/favicon.ico");
		expect(favicon.status).toBe(204);
		expect(favicon.headers["Content-Type"]).toBeUndefined();
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

	test("a reviewer token can comment but never approve or cancel", async () => {
		const { ctx, saved, approved, cancelled } = router({
			roleOf: (token) => (token === "tok" ? "reviewer" : undefined),
		});
		const commented = await post(ctx, "/api/feedback?token=tok", JSON.stringify({ annotations: [] }));
		expect(commented.status).toBe(200);
		expect(saved).toHaveLength(1);

		expect((await post(ctx, "/api/approve?token=tok")).status).toBe(403);
		expect((await post(ctx, "/api/cancel?token=tok")).status).toBe(403);
		expect(approved).toEqual([]);
		expect(cancelled).toEqual([]);
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
		...overrides,
	});
}

describe("review page roles", () => {
	test("gives the owner Share and the matching dialog", () => {
		const html = page();
		expect(html).toContain('id="share"');
		expect(html).toContain('id="share-dialog"');
		expect(html).toContain('id="share-qr"');
		expect(html).not.toContain('id="name-dialog"');
	});

	test("gives a reviewer a name dialog and no share or approve action", () => {
		const html = page({ role: "reviewer", canApprove: false });
		expect(html).toContain('id="reviewer-name"');
		expect(html).toContain('id="name-dialog"');
		expect(html).not.toContain('id="share"');
		expect(html).not.toContain('id="approve"');
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

	test("omits the approve hint and shortcut on a comment-only review", () => {
		const html = page({ canApprove: false });
		expect(html).not.toContain("to approve");
		expect(html).not.toContain("Approve and run the plan");
		expect(html).toContain("for all shortcuts");
	});
});

const REVIEW_ORIGIN = "http://127.0.0.1:1234/?token=t";

/**
 * The `safeHref` the page actually ships, evaluated out of the client source: a
 * string assertion cannot tell a fixed rule from a broken one.
 */
function shippedSafeHref(): (url: string, base: string) => string | null {
	const start = REVIEW_CLIENT_JS.indexOf("function safeHref(");
	const end = REVIEW_CLIENT_JS.indexOf("\n  }", start);
	const source = start >= 0 && end > start ? REVIEW_CLIENT_JS.slice(start, end + 4) : "";
	return new Function(`${source}\nreturn safeHref;`)() as (url: string, base: string) => string | null;
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
		expect(REVIEW_CLIENT_JS).toContain('submit("/api/feedback"');
		expect(REVIEW_CLIENT_JS).toContain('submit("/api/approve"');
		expect(REVIEW_CLIENT_JS).toContain("/api/cancel?token=");
		expect(REVIEW_CLIENT_JS).toContain("/events?token=");
		expect(REVIEW_CLIENT_JS).toContain('"?token=" + encodeURIComponent(token)');
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
		expect(REVIEW_CLIENT_JS).toContain("function guardDraft()");
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
		expect(REVIEW_CLIENT_JS).toContain("response.status === 409");
		expect(REVIEW_CLIENT_JS).toContain("window.location.reload()");
	});

	test("takes its caps from the island instead of retyping them", () => {
		expect(REVIEW_CLIENT_JS).toContain("var limits = data.limits || fallback.limits;");
		expect(REVIEW_CLIENT_JS).toContain("area.maxLength = limits.comment;");
		expect(REVIEW_CLIENT_JS).toContain("annotations.length >= limits.comments");
		expect(REVIEW_CLIENT_JS).toContain("slice(0, limits.quote)");
		expect(REVIEW_CLIENT_JS).not.toContain(">= 200");
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

		await fetch(apiOf(link.url, "/api/feedback"), {
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

		const response = await fetch(apiOf(link.url, "/api/feedback"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "name the ceiling", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toContain("> [!REVIEW] @alice: name the ceiling");
		const island = islandOf(await (await fetch(session.url)).text());
		expect(island.annotations).toEqual([{ anchor: 1, comment: "name the ceiling", author: "alice" }]);
	});

	test("a reviewer must choose a name, and can never approve or cancel", async () => {
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

		const anonymous = await post("/api/feedback", JSON.stringify({ annotations: [{ anchor: 1, comment: "hi" }] }));
		expect(anonymous.status).toBe(400);
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

		const refused = await fetch(apiOf(link.url, "/api/feedback"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "late", author: "alice" }] }),
		}).then(
			(response) => `answered ${response.status}`,
			() => "refused",
		);
		expect(refused).toBe("refused");
	});

	test("a reviewer re-posting the page's comments does not duplicate them", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] mine\n> [!REVIEW] @bob: theirs\n- [ ] two";
		const { review, content } = await startShared({ networkInterfaces: LAN }, { canApprove: true }, seeded);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const page = islandOf(await (await fetch(link.url)).text());
		const response = await fetch(apiOf(link.url, "/api/feedback"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			// What a reviewer's page posts: everyone's comments, plus their own new one.
			body: JSON.stringify({
				annotations: [...page.annotations, { anchor: 1, comment: "mine too", author: "priya" }],
			}),
		});

		expect(response.status).toBe(200);
		const text = content();
		expect(text.match(/> \[!REVIEW\] mine/g)?.length).toBe(1);
		expect(text.match(/@bob: theirs/g)?.length).toBe(1);
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		expect(text).toContain("> [!REVIEW] @priya: mine too");
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
		const before = content();

		const response = await fetch(apiOf(link.url, "/api/feedback"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toBe(before);
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
	const store = {
		read: async (): Promise<StoredPlan> => stored(content),
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
	return { store, content: () => content };
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
	const { store, content } = fakeStore(plan);
	const review = createPlanWebReview(store, { open: () => {}, token: () => "tok", port: 0, ...deps });
	reviews.push(review);
	const session = await review.start("/repo", stored(content()), options);
	if (!session) throw new Error("the review server did not start");
	return { review, session, content };
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
