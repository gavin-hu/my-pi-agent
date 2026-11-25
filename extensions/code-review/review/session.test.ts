/**
 * The session's page: one per session, opened on demand, re-scoped only while the page
 * holds nothing a replacement would destroy, and closed without touching what was sent.
 *
 * A real repository is the reader's input and a stub mount stands in for the
 * session's server, so a case reads the page's own state — and, for the scope
 * lock, writes through the real handler the mount was handed.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_ROOT } from "../../../lib/env.ts";
import type { LoopbackHandler, LoopbackRequest, LoopbackReply, MountSpec } from "../../../lib/http/index.ts";
import { execP, makeRepo, makeTempTracker } from "../../../test/helpers/git.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import { useEnv } from "../../../test/helpers/env.ts";
import { TOOL_NAME } from "../schema.ts";
import { registerReviewTool } from "../tools.ts";
import { createReviewSession } from "./session.ts";
import { scopeRefusal } from "./scope-work.ts";
import { SNAPSHOT_MOVED, type Review } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

beforeEach(() => {
	useEnv({ [ENV_ROOT]: undefined });
});

/** The exec seam a Pi host hands a reader: the suite's own git process. */
const host = {
	async exec(command: string, args: string[], options: { cwd?: string } = {}) {
		const result = await execP(command, args, { cwd: options.cwd });
		return { ...result, truncated: false };
	},
	events: { on: () => () => {}, emit: () => {} },
};

/** A repository on `feature` with one committed file the base does not carry. */
async function featureRepo(): Promise<string> {
	const repo = temps.track(await makeRepo());
	await execP("git", ["checkout", "-q", "-b", "feature"], { cwd: repo });
	writeFileSync(join(repo, "a.ts"), "const a = 1;\n");
	await execP("git", ["add", "a.ts"], { cwd: repo });
	await execP("git", ["commit", "-qm", "add a"], { cwd: repo });
	return repo;
}

/** A mount that answers the session's server with one fake prefix, keeping the handler. */
function fakeMount() {
	const state = { released: 0, specs: [] as MountSpec[] };
	return {
		state,
		mount: async (spec: MountSpec) => {
			state.specs.push(spec);
			return {
				kind: "mounted" as const,
				mount: {
					base: "/review",
					origin: "http://127.0.0.1:4781",
					port: 4781,
					release: async () => {
						state.released += 1;
					},
					share: async () => undefined,
					unshare: async () => {},
				},
			};
		},
	};
}

/** One request as the loopback server hands it to the mounted handler. */
async function ask(handler: LoopbackHandler, method: string, url: string, body?: unknown) {
	const req: LoopbackRequest = {
		method,
		url,
		headers: { host: "127.0.0.1:4781", ...(body === undefined ? {} : { "content-type": "application/json" }) },
		body: body === undefined ? "" : JSON.stringify(body),
		remoteAddress: "127.0.0.1",
	};
	const answered = (await handler(req)) as LoopbackReply;
	return answered.result;
}

/** The island's value from a page body. */
function reviewIsland(body: string): { token: string; rev: string } {
	const start = body.indexOf('id="rv-data">') + 'id="rv-data">'.length;
	return JSON.parse(body.slice(start, body.indexOf("</script>", start)));
}

describe("opening the page", () => {
	test("serves one page per session, reports the one already open, and closes it", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const opened: string[] = [];
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: (url) => opened.push(url), mount: mounted.mount });

		const first = await session.open({}, ctx);
		expect(first.kind).toBe("open");
		if (first.kind !== "open") return;
		expect(first.status.url).toBe("http://127.0.0.1:4781/review/new");
		expect(first.status.label).toBe("main...HEAD");
		expect(first.status.files).toBe(1);
		expect(opened).toEqual(["http://127.0.0.1:4781/review/new"]);

		const second = await session.open({}, ctx);
		expect(second.kind === "open" && second.status.url).toBe(first.status.url);
		expect(mounted.state.specs).toHaveLength(1);

		await session.close();
		expect(mounted.state.released).toBe(1);
		await session.close();
		expect(mounted.state.released).toBe(1);
	});

	test("re-scopes a page that holds no comment", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({ scope: "worktree" }, ctx);
		const staged = await session.open({ scope: "staged" }, ctx);
		expect(staged.kind).toBe("open");
		if (staged.kind !== "open") return;
		expect(staged.status.scope).toBe("staged");
		expect(mounted.state.specs).toHaveLength(2);
		await session.close();
	});

	test("follows the session's tree when a worktree switch moves it", async () => {
		const first = await featureRepo();
		const second = temps.track(await makeRepo());
		writeFileSync(join(second, "b.ts"), "const b = 2;\n");
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: first }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({ scope: "worktree" }, ctx);
		const handler = mounted.state.specs[0].handler;
		const before = reviewIsland(String((await ask(handler, "GET", "/new?scope=worktree")).body ?? ""));
		// The tree moves under the page, as `worktree enter` moves the session's root.
		ctx.cwd = second;
		const after = await ask(handler, "GET", "/new?scope=worktree");
		expect(String(after.body)).toContain('data-path="b.ts"');
		// The write names the tree it rendered, so the page read before the move no longer matches.
		const stale = await ask(handler, "POST", "/api/comment", {
			token: before.token,
			rev: before.rev,
			comment: { rel: "b.ts", line: 1, side: "new", body: "name the constant" },
		});
		expect(JSON.parse(String(stale.body)).error).toBe(SNAPSHOT_MOVED);
		await session.close();
	});

	test("a sent comment does not hold a scope change", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({}, ctx);
		const handler = mounted.state.specs[0].handler;
		const page = reviewIsland(String((await ask(handler, "GET", "/new")).body ?? ""));
		await ask(handler, "POST", "/api/comment", {
			token: page.token,
			rev: page.rev,
			comment: { rel: "a.ts", line: 1, side: "new", body: "name the constant" },
		});
		const sent = await ask(handler, "POST", "/api/send", { token: page.token, rev: page.rev });
		expect(sent.status).toBe(200);
		// Sent comments are the session's already, so a switch destroys nothing they hold: the
		// rule counts what a page replacement would lose, not what the page has written.
		const opened = await session.open({ scope: "staged" }, ctx);
		expect(opened.kind).toBe("open");
		expect(mounted.state.specs).toHaveLength(2);
		await session.close();
	});

	test("refuses a scope change while a draft would be lost, naming it and the page's address", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		const first = await session.open({}, ctx);
		if (first.kind !== "open") throw new Error("the page did not open");
		const handler = mounted.state.specs[0].handler;
		const page = reviewIsland(String((await ask(handler, "GET", "/new")).body ?? ""));
		const written = await ask(handler, "POST", "/api/comment", {
			token: page.token,
			rev: page.rev,
			comment: { rel: "a.ts", line: 1, side: "new", body: "name the constant" },
		});
		expect(written.status).toBe(200);
		const refused = await session.open({ scope: "staged" }, ctx);
		if (refused.kind !== "refused") throw new Error("the scope change was allowed");
		expect(refused.reason).toContain("1 draft comment on main...HEAD");
		expect(refused.reason).toContain("Send the drafts before switching scope");
		// The page is still the reader's, so the refusal names where it still is.
		expect(refused.reason).toContain(`still open at ${first.status.url}`);
		expect(mounted.state.specs).toHaveLength(1);
		await session.close();
	});

	test("refuses a scope change while a mark alone would be lost", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({}, ctx);
		const handler = mounted.state.specs[0].handler;
		const page = reviewIsland(String((await ask(handler, "GET", "/new")).body ?? ""));
		const marked = await ask(handler, "POST", "/api/reviewed", {
			token: page.token,
			rev: page.rev,
			rel: "a.ts",
			reviewed: true,
		});
		expect(marked.status).toBe(200);
		const refused = await session.open({ scope: "staged" }, ctx);
		if (refused.kind !== "refused") throw new Error("the scope change was allowed");
		expect(refused.reason).toContain("1 file marked reviewed");
		expect(refused.reason).toContain("Clear the marks before switching scope");
		await session.close();
	});

	test("the tool closes the page once its only comment is deleted from it", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({}, ctx);
		const handler = mounted.state.specs[0].handler;
		const page = reviewIsland(String((await ask(handler, "GET", "/new")).body ?? ""));
		const written = await ask(handler, "POST", "/api/comment", {
			token: page.token,
			rev: page.rev,
			comment: { rel: "a.ts", line: 1, side: "new", body: "name the constant" },
		});
		expect(written.status).toBe(200);
		const { pi, tools } = createFakePi();
		registerReviewTool(pi, async () => session);
		const tool = tools.get(TOOL_NAME);
		const refused = await tool.execute("c1", { action: "close" }, undefined, undefined, ctx);
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain("still a draft");
		// The delete is by id, which is what the page's list of comments it cannot draw does for one a
		// moved diff left without a row: the reviewer's only way back to a close.
		const id = JSON.parse(String(written.body)).review.comments[0].id;
		const dropped = await ask(handler, "POST", "/api/drop", { token: page.token, rev: page.rev, id });
		expect(dropped.status).toBe(200);
		const closed = await tool.execute("c1", { action: "close" }, undefined, undefined, ctx);
		expect(closed.content[0].text).toBe("Review closed.");
	});

	test("reports a page with no diff as open, naming the problem", async () => {
		const repo = temps.track(await makeRepo());
		await execP("git", ["checkout", "-q", "-b", "empty"], { cwd: repo });
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		const outcome = await session.open({ scope: "last" }, ctx);
		expect(outcome.kind).toBe("open");
		if (outcome.kind !== "open") return;
		expect(outcome.status.files).toBe(0);
		expect(outcome.problem).toBeDefined();
		await session.close();
	});
});

/** A review holding `drafts` draft comments and `marks` reviewed files, for the sentence cases. */
function held(drafts: number, marks: number): Review {
	return {
		id: "r1",
		scope: "base",
		base: "main",
		label: "main...HEAD",
		rev: "rev-1",
		createdAt: 1,
		updatedAt: 1,
		comments: Array.from({ length: drafts }, (_, index) => ({
			id: `c${index}`,
			rel: "a.ts",
			line: index + 1,
			side: "new" as const,
			body: "note",
			state: "draft" as const,
			at: 1,
		})),
		reviewed: Array.from({ length: marks }, (_, index) => `f${index}.ts`),
	};
}

describe("the sentence a scope change refuses with", () => {
	test("names the drafts and the page action that clears them", () => {
		expect(scopeRefusal(held(1, 0), "main...HEAD")).toBe(
			"1 draft comment on main...HEAD. Send the drafts before switching scope.",
		);
	});

	test("names the marks alone, so a marked page is not told about comments", () => {
		expect(scopeRefusal(held(0, 2), "worktree")).toBe(
			"2 files marked reviewed on worktree. Clear the marks before switching scope.",
		);
	});

	test("names both when both would be lost", () => {
		expect(scopeRefusal(held(2, 1), "main...HEAD")).toBe(
			"2 draft comments and 1 file marked reviewed on main...HEAD. Send the drafts and clear the marks before switching scope.",
		);
	});
});
