/**
 * The review's routes, driven as the server drives them: the envelope first, the
 * token, then one operation.
 *
 * The store and the reader are the real ones over a stub snapshot, so a case
 * reads the state a refusal left alone rather than a mock's promise.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { NO_PAGE } from "../review/store.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import {
	openedPage,
	pageToken,
	request,
	reply,
	reviewRoute as harness,
	stubFile,
} from "../../../test/helpers/review-route.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the page's GETs", () => {
	test("serves the page at /new, minting the token it will write with", async () => {
		const harnessed = harness();
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(200);
		expect(result.body).toContain('id="rv-data"');
		expect(harnessed.store.current()?.preset).toBe("staged");
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

		const token = pageToken(harnessed.store);
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
		const token = pageToken(harnessed.store);
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
		const harnessed = harness({ files: [stubFile("a.ts"), stubFile("b.ts")] });
		await reply(harnessed.handler, request("GET", "/new?scope=branch"));
		const token = pageToken(harnessed.store);
		// The rev a focused page carries is the scope's, so the request it posts is the same
		// one the full page would have posted — which is what keeps a hidden file writable.
		const focused = await reply(harnessed.handler, request("GET", "/new?scope=branch&file=a.ts"));
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
		const token = await openedPage(harnessed);
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
		expect(harnessed.store.current()?.preset).toBe("branch");
	});

	test("refuses a scope change for marks alone, and keeps them", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const marked = await reply(
			harnessed.handler,
			request("POST", "/api/reviewed", { token, rev: "rev-1", rel: "a.ts", reviewed: true }),
		);
		expect(marked.status).toBe(200);
		const result = await reply(harnessed.handler, request("GET", "/new?scope=staged"));
		expect(result.status).toBe(409);
		expect(result.body).toContain("1 file marked reviewed");
		expect(harnessed.store.current()?.preset).toBe("branch");
		expect(harnessed.store.current()?.review?.reviewed).toEqual(["a.ts"]);
	});

	test("names both counts when a draft and a mark are on the page", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
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
		// The page must print the same sentence the session's refusal prints, actions and all: the
		// two doors import one `scopeRefusal`, and this is the door no session case reaches.
		expect(result.body).toContain("Send the drafts and clear the marks before switching scope");
	});

	test("lets a scope change through once nothing is left to lose", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
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
		expect(harnessed.store.current()?.preset).toBe("staged");
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

describe("the page's revision", () => {
	test("answers the fingerprint a tab compares, and it moves when the tree does", async () => {
		const harnessed = harness();
		const token = await openedPage(harnessed);
		const first = await reply(harnessed.handler, request("GET", `/rev?token=${token}`));
		expect(first.status).toBe(200);
		expect(JSON.parse(String(first.body))).toEqual({ rev: "rev-1" });
		// The tree a commit moved: the same route, one value later, and nothing else to read.
		harnessed.state.rev = "rev-2";
		const moved = await reply(harnessed.handler, request("GET", `/rev?token=${token}`));
		expect(JSON.parse(String(moved.body))).toEqual({ rev: "rev-2" });
	});

	test("refuses a caller without the page, or without its token", async () => {
		const none = harness({ scope: undefined });
		const noPage = await reply(none.handler, request("GET", "/rev?token=tok-1"));
		expect(noPage.status).toBe(403);
		expect(JSON.parse(String(noPage.body)).error).toBe(NO_PAGE);
		const harnessed = harness();
		await openedPage(harnessed);
		const missing = await reply(harnessed.handler, request("GET", "/rev"));
		expect(missing.status).toBe(403);
		const wrong = await reply(harnessed.handler, request("GET", "/rev?token=not-the-token"));
		expect(wrong.status).toBe(403);
		expect(JSON.parse(String(wrong.body)).error).toBe("Invalid or missing token.");
	});

	test("is a read: a POST on it is refused, and it does not open a page", async () => {
		const harnessed = harness({ scope: undefined });
		const posted = await reply(harnessed.handler, request("POST", "/rev", {}));
		expect(posted.status).toBe(405);
		expect(harnessed.store.current()).toBeUndefined();
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
