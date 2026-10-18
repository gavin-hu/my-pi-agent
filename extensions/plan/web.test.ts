import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { formatFeedback, type PlanAnnotation } from "./feedback.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import { createPlanWebReview, type PlanReviewOptions, type PlanReviewSession } from "./web.ts";

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

async function start(
	content = "# Plan\n\n- [ ] step\n",
	opened: string[] = [],
	options?: PlanReviewOptions,
): Promise<PlanReviewSession> {
	const { store } = fakeStore(content);
	review = createPlanWebReview(store, { open: (url) => opened.push(url), token: () => "tok", port: 0 });
	const session = await review.start("/repo", stored(content), options);
	expect(session).toBeDefined();
	return session as PlanReviewSession;
}

const feedbackUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/feedback?token=tok`;
const approveUrl = (session: PlanReviewSession) => `http://127.0.0.1:${session.port}/api/approve?token=tok`;
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

	test("highlights a fenced code block and builds the outline", async () => {
		const session = await start("# Plan\n\n```ts\nconst x = 1;\n```\n");
		const html = await (await fetch(session.url)).text();
		const island = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
		expect(island).not.toBeNull();
		const data = JSON.parse(island![1]);
		const keys = Object.keys(data.code);
		expect(keys).toHaveLength(1);
		expect(data.code[keys[0]].join("")).toContain("tok-keyword");
		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan" }]);
	});

	test("marks the outline section that changed since the previous review", async () => {
		const session = await start("# Plan\n\nNew body\n", [], { previous: "# Plan\n\nOld body\n" });
		const html = await (await fetch(session.url)).text();
		const island = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
		const data = JSON.parse(island![1]);
		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan", changed: true }]);
	});

	test("uses the plan's H1 as the review title and falls back to the slug", async () => {
		const titled = await start("# Add rate limiting\n\nBody\n");
		const titledHtml = await (await fetch(titled.url)).text();
		const titledIsland = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(titledHtml);
		expect(JSON.parse(titledIsland![1]).title).toBe("Add rate limiting");
		await titled.close();

		const untitled = await start("Just prose, no heading.\n");
		const untitledHtml = await (await fetch(untitled.url)).text();
		const untitledIsland = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(untitledHtml);
		expect(JSON.parse(untitledIsland![1]).title).toBe("demo");
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

	test("resolves approved with the saved comments", async () => {
		const session = await start("# Plan\n\n- [ ] step\n", [], { canApprove: true });
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
		// The session stays live; cancel it so the fixture resolves.
		await fetch(cancelUrl(session), { method: "POST" });
		expect((await session.done).status).toBe("cancelled");
	});

	test("delivers the approve response before the session closes", async () => {
		const session = await start("# Plan\n", [], { canApprove: true });
		const pending = fetch(approveUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 0, comment: "go" }] }),
		});
		expect((await session.done).status).toBe("approved");
		await session.close();
		expect((await pending).status).toBe(200);
	});

	test("marks the page approvable only when the session allows it", async () => {
		const approvable = await start("# Plan\n", [], { canApprove: true });
		expect(await (await fetch(approvable.url)).text()).toContain('id="approve"');
		await approvable.close();

		const commentOnly = await start("# Plan\n");
		expect(await (await fetch(commentOnly.url)).text()).not.toContain('id="approve"');
	});

	test("resolves cancelled when the turn aborts", async () => {
		const { store } = fakeStore("# Plan\n");
		review = createPlanWebReview(store, { open: () => {}, token: () => "tok", port: 0 });
		const controller = new AbortController();
		const session = (await review.start("/repo", stored("# Plan\n"), {
			signal: controller.signal,
		})) as PlanReviewSession;
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

	test("delivers the save response before the session closes", async () => {
		const session = await start();
		const pending = fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 2, comment: "note" }] }),
		});
		expect((await session.done).status).toBe("saved");
		await session.close();
		expect((await pending).status).toBe(200);
	});

	test("delivers the cancel response before the session closes", async () => {
		const session = await start();
		const pending = fetch(cancelUrl(session), { method: "POST" });
		expect((await session.done).status).toBe("cancelled");
		await session.close();
		expect((await pending).status).toBe(200);
	});

	test("reuses the same port for the same plan across turns", async () => {
		const { store } = fakeStore("# Plan\n");
		review = createPlanWebReview(store, { open: () => {}, token: () => "tok" });
		const first = (await review.start("/repo", stored("# Plan\n"))) as PlanReviewSession;
		const port = first.port;
		await first.close();
		const second = (await review.start("/repo", stored("# Plan\n"))) as PlanReviewSession;
		expect(second.port).toBe(port);
		await second.close();
	});

	test("falls back to a free port when the remembered one is busy", async () => {
		const { store } = fakeStore("# Plan\n");
		review = createPlanWebReview(store, { open: () => {}, token: () => "tok" });
		const first = (await review.start("/repo", stored("# Plan\n"))) as PlanReviewSession;
		const port = first.port;
		await first.close();
		const blocker = createServer(() => {});
		await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", () => resolve()));
		const second = (await review.start("/repo", stored("# Plan\n"))) as PlanReviewSession;
		expect(second.port).not.toBe(port);
		await second.close();
		await new Promise<void>((resolve) => blocker.close(() => resolve()));
	});
});
