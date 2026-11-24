/**
 * What a write checks before it lands: the token, the route, and the two facts only a comment
 * needs — the line it anchors to, and the snapshot the page rendered it on.
 *
 * The store and the reader are the real ones over a stub snapshot, so a case reads the state a
 * refusal left alone. The routes that only read are `router.test.ts`, and the stage both suites
 * drive is `test/helpers/review-route.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { openedPage, request, reply, reviewRoute as harness } from "../../../test/helpers/review-route.ts";
import { SNAPSHOT_MOVED } from "../review/store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("a write", () => {
	test("refuses a missing or foreign token, and a snapshot the page no longer shows", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const wrong = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token: "not-it",
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "x" },
			}),
		);
		expect(wrong.status).toBe(403);
		harnessed.state.rev = "rev-2";
		const stale = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "x" },
			}),
		);
		expect(stale.status).toBe(409);
		expect(JSON.parse(String(stale.body)).error).toBe(SNAPSHOT_MOVED);
		expect(harnessed.store.current()?.review).toBeUndefined();
	});

	test("refuses a comment on a line or a file the snapshot does not draw", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const offHunk = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 2, side: "new", body: "a line nobody read" },
			}),
		);
		expect(offHunk.status).toBe(400);
		expect(JSON.parse(String(offHunk.body)).error).toBe("a comment anchors to a line this diff draws");
		const otherFile = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "b.ts", line: 1, side: "new", body: "a file this diff does not carry" },
			}),
		);
		expect(otherFile.status).toBe(400);
		// A refusal mints nothing: the page a reviewer opened to look still costs no identity.
		expect(harnessed.store.current()?.review).toBeUndefined();
	});

	test("accepts a comment on the old side's line, which has no new number", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const comment = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "old", body: "x" },
			}),
		);
		expect(comment.status).toBe(200);
	});

	test("carries a reply's parent to the review, and refuses one answering another line", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const wrote = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "one" },
			}),
		);
		const parent = JSON.parse(String(wrote.body)).review.comments[0].id;
		const answered = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", parent, body: "two" },
			}),
		);
		expect(answered.status).toBe(200);
		expect(
			JSON.parse(String(answered.body)).review.comments.map((entry: { parent?: string }) => entry.parent ?? null),
		).toEqual([null, parent]);
		// The old side's line is drawn too, so this reply reaches the store and meets its rule rather
		// than the anchor gate: the sentence names both sides of a line that only differs by side.
		const elsewhere = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "old", parent, body: "three" },
			}),
		);
		expect(elsewhere.status).toBe(400);
		expect(JSON.parse(String(elsewhere.body)).error).toBe(
			"a reply answers a comment on its own line — a.ts:1 (new) is not a.ts:1 (old)",
		);
	});

	test("sends, drops and marks a page whose snapshot moved", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const commented = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "x" },
			}),
		);
		const id = JSON.parse(String(commented.body)).review.comments[0].id;
		harnessed.state.rev = "rev-2";
		const marked = await reply(
			harnessed.handler,
			request("POST", "/api/reviewed", { token, rev: "rev-1", rel: "a.ts", reviewed: true }),
		);
		expect(marked.status).toBe(200);
		const sent = await reply(harnessed.handler, request("POST", "/api/send", { token, rev: "rev-1" }));
		expect(sent.status).toBe(200);
		expect(harnessed.sent).toHaveLength(1);
		// A drop on a stale page is the one a reviewer has no other way out of: the thread is still
		// drawn, and the tree moving is not the comment's problem.
		const dropped = await reply(harnessed.handler, request("POST", "/api/drop", { token, rev: "rev-1", id }));
		expect(dropped.status).toBe(200);
		expect(harnessed.store.current()?.review?.comments).toEqual([]);
		// The review keeps the page's revision, so the stale banner still fires on the next render.
		expect(harnessed.store.current()?.review?.rev).toBe("rev-1");
	});

	test("mints the review on the first write and answers the state it produced", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const result = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "guard this" },
			}),
		);
		expect(result.status).toBe(200);
		const body = JSON.parse(String(result.body));
		expect(body.id).toBeString();
		expect(body.review.comments).toHaveLength(1);
		expect(body.review.comments[0].body).toBe("guard this");
		expect(harnessed.sent).toHaveLength(0);
	});

	test("marks a file reviewed, drops a comment, and refuses an unknown id", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const commented = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "x" },
			}),
		);
		const id = JSON.parse(String(commented.body)).review.comments[0].id;
		const marked = await reply(
			harnessed.handler,
			request("POST", "/api/reviewed", { token, rev: "rev-1", rel: "a.ts", reviewed: true }),
		);
		expect(JSON.parse(String(marked.body)).review.reviewed).toEqual(["a.ts"]);
		const dropped = await reply(harnessed.handler, request("POST", "/api/drop", { token, rev: "rev-1", id }));
		expect(JSON.parse(String(dropped.body)).review.comments).toEqual([]);
		const missing = await reply(harnessed.handler, request("POST", "/api/drop", { token, rev: "rev-1", id }));
		expect(missing.status).toBe(404);
	});

	test("reports the sent comments once, and marks them sent", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "one" },
			}),
		);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "two" },
			}),
		);
		const sent = await reply(harnessed.handler, request("POST", "/api/send", { token, rev: "rev-1" }));
		expect(sent.status).toBe(200);
		expect(harnessed.sent).toHaveLength(1);
		expect(harnessed.sent[0].map((comment) => comment.body)).toEqual(["one", "two"]);
		expect(
			JSON.parse(String(sent.body)).review.comments.every((comment: { state: string }) => comment.state === "sent"),
		).toBe(true);
		await reply(harnessed.handler, request("POST", "/api/send", { token, rev: "rev-1" }));
		expect(harnessed.sent).toHaveLength(1);
	});
});
