import { afterEach, describe, expect, test } from "bun:test";
import { formatFeedback, type PlanAnnotation } from "./feedback.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import { createPlanWebReview, type PlanReviewSession } from "./web.ts";

const PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";
const RELATIVE = ".pi/plans/2026-10-14-1600-demo.md";

function stored(content: string): StoredPlan {
	return { path: PATH, relativePath: RELATIVE, content, bytes: Buffer.byteLength(content, "utf-8") };
}

/** An in-memory plan store, so these tests never touch the filesystem. */
function fakeStore(initial: string) {
	let content = initial;
	const store = {
		read: async (): Promise<StoredPlan> => stored(content),
		saveFeedback: async (_cwd: string, _path: string, annotations: PlanAnnotation[]): Promise<StoredPlan> => {
			content = formatFeedback(content, annotations);
			return stored(content);
		},
	} as unknown as PlanStore;
	return { store, content: () => content };
}

let review: ReturnType<typeof createPlanWebReview> | undefined;

afterEach(async () => {
	await review?.closeAll();
	review = undefined;
});

async function start(content = "# Plan\n\n- [ ] step\n", opened: string[] = []): Promise<PlanReviewSession> {
	const { store } = fakeStore(content);
	review = createPlanWebReview(store, { open: (url) => opened.push(url), token: () => "tok", port: 0 });
	const session = await review.start("/repo", stored(content));
	expect(session).toBeDefined();
	return session as PlanReviewSession;
}

const feedbackUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/feedback?token=tok`;
const cancelUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/cancel?token=tok`;

describe("createPlanWebReview", () => {
	test("opens the tokenized URL and serves the review page", async () => {
		const opened: string[] = [];
		const session = await start("# Plan\n", opened);
		expect(opened).toEqual([session.url]);
		expect(session.url).toContain("token=tok");
		const response = await fetch(session.url);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('id="review-data"');
	});

	test("rejects a request without the session token", async () => {
		const session = await start();
		const response = await fetch(`http://127.0.0.1:${session.port}/`);
		expect(response.status).toBe(403);
	});

	test("resolves saved once feedback is posted", async () => {
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
		const response = await fetch(cancelUrl(session), { method: "POST" });
		expect(response.status).toBe(200);
		expect((await session.done).status).toBe("cancelled");
	});

	test("resolves cancelled when the turn aborts", async () => {
		const { store } = fakeStore("# Plan\n");
		review = createPlanWebReview(store, { open: () => {}, token: () => "tok", port: 0 });
		const controller = new AbortController();
		const session = (await review.start("/repo", stored("# Plan\n"), controller.signal)) as PlanReviewSession;
		controller.abort();
		expect((await session.done).status).toBe("cancelled");
		await session.close();
	});

	test("close is idempotent and closeAll stops every session", async () => {
		const session = await start();
		await session.close();
		await session.close();
		expect((await session.done).status).toBe("cancelled");
	});
});
