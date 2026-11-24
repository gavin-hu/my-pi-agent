/**
 * The review's routes, driven as the server drives them: the envelope first, the
 * token, then one operation.
 *
 * The store and the reader are the real ones over a stub snapshot, so a case
 * reads the state a refusal left alone rather than a mock's promise.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { request, reply, reviewRoute as harness } from "../../../test/helpers/review-route.ts";
import type { ReviewSnapshot } from "../git/diff.ts";
import { SNAPSHOT_MOVED } from "../review/store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One changed file drawing a single added line, which is all an anchor case needs. */
function fileOf(rel: string): ReviewSnapshot["files"][number] {
	return {
		rel,
		status: "M",
		add: 1,
		del: 0,
		binary: false,
		truncated: false,
		lines: [
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "add", text: `// ${rel}`, newNo: 1 },
		],
	};
}

/** The token the page was served with, read from the store it minted. */
function tokenOf(store: ReturnType<typeof harness>["store"]): string {
	const page = store.current();
	if (!page) throw new Error("the page was not opened");
	return page.token;
}

/** Open the page and return its token. */
async function opened(harnessed: ReturnType<typeof harness>): Promise<string> {
	await reply(harnessed.handler, request("GET", "/new"));
	return tokenOf(harnessed.store);
}

describe("the page's GETs", () => {
	test("serves the page at /new, minting the token it will write with", async () => {
		const harnessed = harness();
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(200);
		expect(result.body).toContain('id="rv-data"');
		expect(harnessed.store.current()?.scope).toBe("staged");
	});

	test("draws one file when the address names it, on both page routes", async () => {
		const harnessed = harness();
		// The back link only renders on a focused page, so it is the tell that `file` reached
		// the renderer — the router decides nothing about the snapshot either way.
		const focused = await reply(harnessed.handler, request("GET", "/new?scope=staged&file=a.ts"));
		expect(focused.status).toBe(200);
		expect(focused.body).toContain('id="rv-all-files"');
		const unknown = await reply(harnessed.handler, request("GET", "/new?scope=staged&file=gone.ts"));
		expect(unknown.body).not.toContain('id="rv-all-files"');

		const token = tokenOf(harnessed.store);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		const id = harnessed.store.current()?.review?.id;
		if (id === undefined) throw new Error("no review");
		const resumed = await reply(harnessed.handler, request("GET", `/${id}?token=${token}&file=a.ts`));
		expect(resumed.status).toBe(200);
		expect(resumed.body).toContain('id="rv-all-files"');
	});

	test("serves the page at / too, and at the review's own id", async () => {
		const harnessed = harness();
		const root = await reply(harnessed.handler, request("GET", "/"));
		expect(root.status).toBe(200);
		const token = tokenOf(harnessed.store);
		const comment = await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		expect(comment.status).toBe(200);
		const id = harnessed.store.current()?.review?.id;
		if (id === undefined) throw new Error("no review");
		const resumed = await reply(harnessed.handler, request("GET", `/${id}?token=${token}`));
		expect(resumed.status).toBe(200);
		const refused = await reply(harnessed.handler, request("GET", `/${id}?token=nope`));
		expect(refused.status).toBe(403);
	});

	test("accepts a write a focused page posts about a file it does not draw", async () => {
		const harnessed = harness({ files: [fileOf("a.ts"), fileOf("b.ts")] });
		await reply(harnessed.handler, request("GET", "/new?scope=base"));
		const token = tokenOf(harnessed.store);
		// The rev a focused page carries is the scope's, so the request it posts is the same
		// one the full page would have posted — which is what keeps a hidden file writable.
		const focused = await reply(harnessed.handler, request("GET", "/new?scope=base&file=a.ts"));
		const island = typeof focused.body === "string" ? focused.body : "";
		const rev = /"rev":"([^"]+)"/.exec(island)?.[1];
		if (rev === undefined) throw new Error("no rev in the island");
		const comment = await reply(
			harnessed.handler,
			request("POST", "/api/comment", { token, rev, comment: { rel: "b.ts", line: 1, side: "new", body: "hi" } }),
		);
		expect(comment.status).toBe(200);
		expect(harnessed.store.current()?.review?.comments.map((entry) => entry.rel)).toEqual(["b.ts"]);
	});

	test("refuses a scope change while a draft is on the page", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(409);
		expect(result.body).toContain("1 draft comment");
		expect(harnessed.store.current()?.scope).toBe("base");
	});

	test("refuses a scope change for marks alone, and keeps them", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
		const marked = await reply(
			harnessed.handler,
			request("POST", "/api/reviewed", { token, rev: "rev-1", rel: "a.ts", reviewed: true }),
		);
		expect(marked.status).toBe(200);
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(409);
		expect(result.body).toContain("1 file marked reviewed");
		expect(harnessed.store.current()?.scope).toBe("base");
		expect(harnessed.store.current()?.review?.reviewed).toEqual(["a.ts"]);
	});

	test("names both counts when a draft and a mark are on the page", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		await reply(
			harnessed.handler,
			request("POST", "/api/reviewed", { token, rev: "rev-1", rel: "a.ts", reviewed: true }),
		);
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(409);
		expect(result.body).toContain("1 draft comment");
		expect(result.body).toContain("1 file marked reviewed");
	});

	test("lets a scope change through once nothing is left to lose", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
		await reply(
			harnessed.handler,
			request("POST", "/api/comment", {
				token,
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		await reply(harnessed.handler, request("POST", "/api/send", { token, rev: "rev-1" }));
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(200);
		expect(harnessed.store.current()?.scope).toBe("staged");
		expect(harnessed.store.current()?.review).toBeUndefined();
		expect(harnessed.sent).toHaveLength(1);
	});

	test("serves the client and the shared theme without a token", async () => {
		const harnessed = harness();
		const script = await reply(harnessed.handler, request("GET", "/client.js"));
		expect(script.status).toBe(200);
		expect(script.body).toContain("pageBase");
		const theme = await reply(harnessed.handler, request("GET", "/theme.js"));
		expect(theme.status).toBe(200);
	});
});

describe("the envelope", () => {
	test("refuses another method, a foreign Host, and a cross-origin write", async () => {
		const harnessed = harness();
		const put = await reply(harnessed.handler, request("PUT", "/new"));
		expect(put.status).toBe(405);
		const host = await reply(harnessed.handler, request("GET", "/new", undefined, { host: "evil.example:80" }));
		expect(host.status).toBe(403);
		const origin = await reply(
			harnessed.handler,
			request("POST", "/api/comment", { token: "x" }, { origin: "http://evil.example" }),
		);
		expect(origin.status).toBe(403);
	});

	test("requires a JSON body on every write", async () => {
		const harnessed = harness();
		const result = await reply(
			harnessed.handler,
			request("POST", "/api/comment", { token: "x" }, { "content-type": "text/plain" }),
		);
		expect(result.status).toBe(415);
	});

	test("answers 405 to a GET on a write route, and 404 to an unknown API route", async () => {
		const harnessed = harness();
		const refused = await reply(harnessed.handler, request("GET", "/api/comment"));
		expect(refused.status).toBe(405);
		// The per-route refusal survives the envelope: a read of a write route is told the method
		// that route takes, not the page's whole allowlist.
		expect(refused.headers.Allow).toBe("POST");
		expect(JSON.parse(String(refused.body)).error).toBe("Use POST to change this review.");
		expect((await reply(harnessed.handler, request("POST", "/api/nope", { token: "x" }))).status).toBe(404);
	});
});

describe("a write", () => {
	test("refuses a missing or foreign token, and a snapshot the page no longer shows", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
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
		const token = await opened(harnessed);
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
		const token = await opened(harnessed);
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

	test("sends, drops and marks a page whose snapshot moved", async () => {
		const harnessed = harness();
		const token = await opened(harnessed);
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
		const token = await opened(harnessed);
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
		const token = await opened(harnessed);
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
		const token = await opened(harnessed);
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
