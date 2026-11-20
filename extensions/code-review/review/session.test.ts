/**
 * The session's page: one per session, opened on demand, re-scoped only while no
 * comment is written, and closed without touching what was sent.
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
import { useEnv } from "../../../test/helpers/env.ts";
import { createReviewSession, scopeLocked } from "./session.ts";

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
async function request(handler: LoopbackHandler, method: string, url: string, body?: unknown) {
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

	test("refuses a scope change once the review holds a comment, naming the count", async () => {
		const repo = await featureRepo();
		const mounted = fakeMount();
		const ctx = fakeCtx({ cwd: repo }).ctx;
		const session = createReviewSession({ pi: host, ctx, open: () => {}, mount: mounted.mount });
		await session.open({}, ctx);
		const handler = mounted.state.specs[0].handler;
		const page = reviewIsland(String((await request(handler, "GET", "/new")).body ?? ""));
		const written = await request(handler, "POST", "/api/comment", {
			token: page.token,
			rev: page.rev,
			comment: { rel: "a.ts", line: 1, side: "new", body: "name the constant" },
		});
		expect(written.status).toBe(200);
		const refused = await session.open({ scope: "staged" }, ctx);
		expect(refused).toEqual({ kind: "refused", reason: scopeLocked(1, "main...HEAD") });
		expect(mounted.state.specs).toHaveLength(1);
		await session.close();
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

describe("the refusal a locked scope prints", () => {
	test("names the count and the comparison", () => {
		expect(scopeLocked(1, "main...HEAD")).toBe(
			"this review has 1 comment on main...HEAD — send them before switching scope",
		);
		expect(scopeLocked(3, "worktree")).toContain("3 comments");
	});
});
