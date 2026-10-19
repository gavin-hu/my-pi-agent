import { describe, expect, test } from "bun:test";
import { THEME_JS } from "../../lib/web/index.ts";
import type { PlanAnnotation } from "./feedback.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "./web-router.ts";

/** A loopback `Host`; the router now rejects a missing or foreign one. */
const HOST = { host: "127.0.0.1:1234" };

function setup(overrides: Partial<ReviewContext> = {}) {
	const saved: PlanAnnotation[][] = [];
	const approved: PlanAnnotation[][] = [];
	const cancelled: number[] = [];
	let nextSave: SaveResult = { ok: true };
	const ctx: ReviewContext = {
		token: "tok",
		canApprove: true,
		page: async () => ({
			title: "T",
			blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["hello"] }],
			annotations: [],
			outline: [],
			steps: { done: 0, total: 0 },
			code: {},
			limits: { comments: 200, comment: 2000, quote: 500 },
			canApprove: true,
			token: "tok",
		}),
		save: async (annotations) => {
			saved.push(annotations);
			return nextSave;
		},
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

const GET = (url: string) => handleReviewRequest(setup().ctx, "GET", url, HOST);

describe("handleReviewRequest — routes", () => {
	test("answers a malformed request target with 400", async () => {
		const response = await GET("http://[");

		expect(response.status).toBe(400);
		expect(response.body).toContain("Malformed request URL.");
	});

	test("serves the client script without a token", async () => {
		const response = await GET("/client.js");
		expect(response.status).toBe(200);
		expect(response.body).toBe(REVIEW_CLIENT_JS);
		expect(response.headers["Content-Type"]).toContain("text/javascript");
	});

	test("serves the shared theme bootstrap without a token", async () => {
		const response = await GET("/theme.js");
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/javascript");
		expect(response.body).toBe(THEME_JS);
	});

	test("serves the review page with a token", async () => {
		const response = await GET("/?token=tok");
		expect(response.status).toBe(200);
		expect(response.body).toContain('id="review-data"');
		expect(response.headers["Content-Security-Policy"]).toContain("default-src 'none'");
	});

	test("refuses to be framed, so Approve cannot be clickjacked", async () => {
		const response = await GET("/?token=tok");
		expect(response.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
		expect(response.headers["X-Frame-Options"]).toBe("DENY");
	});

	test("rejects the page without the token", async () => {
		expect((await GET("/")).status).toBe(403);
	});

	test("opens the event stream only with the token", async () => {
		const response = await GET("/events?token=tok");
		expect(response.status).toBe(200);
		expect(response.stream).toBe(true);
		expect(response.headers["Content-Type"]).toContain("text/event-stream");
		expect((await GET("/events")).status).toBe(403);
	});

	test("serves a favicon without a content type", async () => {
		const response = await GET("/favicon.ico");
		expect(response.status).toBe(204);
		expect(response.headers["Content-Type"]).toBeUndefined();
	});

	test("returns 404 for an unknown route", async () => {
		expect((await GET("/nope?token=tok")).status).toBe(404);
	});
});

describe("handleReviewRequest — envelope", () => {
	test("rejects a method that is neither GET nor POST", async () => {
		const response = await handleReviewRequest(setup().ctx, "PUT", "/?token=tok", {});
		expect(response.status).toBe(405);
	});

	test("rejects a foreign Host header", async () => {
		const response = await handleReviewRequest(setup().ctx, "GET", "/?token=tok", { host: "evil.example" });
		expect(response.status).toBe(403);
	});

	test("rejects a missing Host header", async () => {
		expect((await handleReviewRequest(setup().ctx, "GET", "/?token=tok", {})).status).toBe(403);
	});

	test("rejects a non-string Host header", async () => {
		const response = await handleReviewRequest(setup().ctx, "GET", "/?token=tok", { host: ["127.0.0.1"] });
		expect(response.status).toBe(403);
	});
});

describe("handleReviewRequest — feedback", () => {
	test("saves valid annotations and signals the save", async () => {
		let resolved = 0;
		const { ctx, saved } = setup({ onSaved: () => (resolved += 1) });
		const response = await handleReviewRequest(
			ctx,
			"POST",
			"/api/feedback?token=tok",
			HOST,
			JSON.stringify({ annotations: [{ anchor: 1, comment: "note" }] }),
		);
		expect(response.status).toBe(200);
		expect(saved).toEqual([[{ anchor: 1, comment: "note" }]]);
		expect(resolved).toBe(1);
	});

	test("rejects a bad token before touching the plan", async () => {
		const { ctx, saved } = setup();
		const response = await handleReviewRequest(
			ctx,
			"POST",
			"/api/feedback?token=nope",
			HOST,
			JSON.stringify({ annotations: [] }),
		);
		expect(response.status).toBe(403);
		expect(saved).toEqual([]);
	});

	test("rejects a malformed body", async () => {
		const { ctx } = setup();
		expect((await handleReviewRequest(ctx, "POST", "/api/feedback?token=tok", HOST, "not json")).status).toBe(400);
		expect(
			(await handleReviewRequest(ctx, "POST", "/api/feedback?token=tok", HOST, JSON.stringify({ annotations: 1 })))
				.status,
		).toBe(400);
	});

	test("reports a save conflict from the store", async () => {
		const { ctx, setSave } = setup();
		setSave({ ok: false, status: 409, message: "The plan changed." });
		const response = await handleReviewRequest(
			ctx,
			"POST",
			"/api/feedback?token=tok",
			HOST,
			JSON.stringify({ annotations: [] }),
		);
		expect(response.status).toBe(409);
		expect(response.body).toContain("The plan changed.");
	});

	test("cancels on request", async () => {
		const { ctx, cancelled } = setup();
		const response = await handleReviewRequest(ctx, "POST", "/api/cancel?token=tok", HOST);
		expect(response.status).toBe(200);
		expect(cancelled).toHaveLength(1);
	});
});

describe("handleReviewRequest — approval", () => {
	test("saves the comments and signals an approve", async () => {
		const { ctx, saved, approved } = setup();
		const response = await handleReviewRequest(
			ctx,
			"POST",
			"/api/approve?token=tok",
			HOST,
			JSON.stringify({ annotations: [{ anchor: 1, comment: "note" }] }),
		);
		expect(response.status).toBe(200);
		expect(saved).toEqual([[{ anchor: 1, comment: "note" }]]);
		expect(approved).toEqual([[{ anchor: 1, comment: "note" }]]);
	});

	test("refuses approve when the review is comment-only", async () => {
		const { ctx, approved } = setup({ canApprove: false });
		const response = await handleReviewRequest(ctx, "POST", "/api/approve?token=tok", HOST);
		expect(response.status).toBe(403);
		expect(approved).toEqual([]);
	});

	test("rejects a non-POST approve", async () => {
		expect((await handleReviewRequest(setup().ctx, "GET", "/api/approve?token=tok", HOST)).status).toBe(405);
	});

	test("reports an approve conflict from the store", async () => {
		const { ctx, approved, setSave } = setup();
		setSave({ ok: false, status: 409, message: "The plan changed." });
		const response = await handleReviewRequest(
			ctx,
			"POST",
			"/api/approve?token=tok",
			HOST,
			JSON.stringify({ annotations: [] }),
		);
		expect(response.status).toBe(409);
		expect(approved).toEqual([]);
	});
});
