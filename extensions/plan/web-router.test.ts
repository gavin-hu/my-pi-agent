/**
 * The browser review's request surface: the comment codec stored in the plan file,
 * and the router that serves the page, the client, and the feedback routes behind
 * its token, Host, and origin guards.
 */

import { describe, expect, test } from "bun:test";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import { THEME_JS } from "../../lib/web/index.ts";
import {
	coerceAnnotations,
	feedbackSummary,
	formatFeedback,
	MAX_ANNOTATIONS,
	MAX_COMMENT_LENGTH,
	parseFeedback,
	stripFeedback,
} from "./feedback.ts";
import { get, HOST, PLAN, post, router } from "../../test/helpers/fixtures/plan-web.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { handleReviewRequest } from "./web-router.ts";
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
