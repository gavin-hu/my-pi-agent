import { describe, expect, test } from "bun:test";
import type { ReviewComment } from "./review/store.ts";
import type { OpenOutcome, ReviewSession, ReviewStatus } from "./review/session.ts";
import { registerReviewTool, statusLine } from "./tools.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { TOOL_NAME } from "./schema.ts";

/** A review page the tool drives, recording what it was asked. */
function fakeSession(options: { status?: Partial<ReviewStatus>; open?: OpenOutcome; sent?: ReviewComment[] } = {}) {
	const calls: string[] = [];
	const status: ReviewStatus = {
		url: "http://127.0.0.1:4781/review/new",
		scope: "base",
		label: "main...HEAD",
		files: 2,
		comments: 1,
		drafts: 1,
		sent: 0,
		reviewed: 1,
		...options.status,
	};
	const session: ReviewSession = {
		open: async () => {
			calls.push("open");
			return options.open ?? { kind: "open", status };
		},
		status: async () => status,
		sent: () => options.sent ?? [],
		close: async () => {
			calls.push("close");
		},
	};
	return { session, calls, status };
}

/** The tool, registered through a double and driven over a fake session. */
function toolFor(session: ReviewSession) {
	const { pi, tools } = createFakePi();
	registerReviewTool(pi, async () => session);
	return tools.get(TOOL_NAME);
}

describe("code_review", () => {
	test("is a codemode tool that starts a page, so plan mode keeps it behind the gate", () => {
		const { session } = fakeSession();
		const { pi, tools } = createFakePi();
		registerReviewTool(pi, async () => session);
		const tool = tools.get(TOOL_NAME);
		expect(tool.exposure).toBe("codemode");
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
		expect(tool.outputSchema).toBeDefined();
	});

	test("open serves the page and names the address and the size", async () => {
		const { session } = fakeSession();
		const ctx = fakeCtx().ctx;
		const result = await toolFor(session).execute("c1", { action: "open", scope: "base" }, undefined, undefined, ctx);
		expect(result.content[0].text).toContain("Review page: http://127.0.0.1:4781/review/new");
		expect(result.details).toMatchObject({
			open: true,
			files: 2,
			comments: 1,
			url: "http://127.0.0.1:4781/review/new",
		});
	});

	test("open reports a refusal with the state the page already had", async () => {
		const { session, status } = fakeSession({ open: { kind: "refused", reason: "it has 2 comments" } });
		const result = await toolFor(session).execute("c1", { action: "open" }, undefined, undefined, fakeCtx().ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("it has 2 comments");
		expect(result.details).toMatchObject({ open: true, files: status.files });
	});

	test("status names the page, its files, and the counts", async () => {
		const { session } = fakeSession();
		const result = await toolFor(session).execute("c1", { action: "status" }, undefined, undefined, fakeCtx().ctx);
		expect(result.content[0].text).toContain("2 files");
		expect(result.content[0].text).toContain("main...HEAD");
	});

	test("comments hands back every sent comment, uncapped", async () => {
		const sent: ReviewComment[] = [
			{ id: "c1", rel: "a.ts", line: 4, side: "new", body: "one", state: "sent", at: 1 },
			{ id: "c2", rel: "b.ts", line: 9, side: "old", body: "two", state: "sent", at: 2 },
		];
		const { session } = fakeSession({ sent });
		const result = await toolFor(session).execute("c1", { action: "comments" }, undefined, undefined, fakeCtx().ctx);
		expect(result.content[0].text).toContain("a.ts:4 (new) — one");
		expect(result.content[0].text).toContain("b.ts:9 (old) — two");
		expect(result.details.list).toHaveLength(2);
	});

	test("comments says so when nothing was sent", async () => {
		const { session } = fakeSession();
		const result = await toolFor(session).execute("c1", { action: "comments" }, undefined, undefined, fakeCtx().ctx);
		expect(result.content[0].text).toBe("No review comments have been sent.");
	});

	test("close refuses while drafts are on the page, and closes once they are sent", async () => {
		const { session, calls } = fakeSession({ status: { drafts: 2 } });
		const refused = await toolFor(session).execute("c1", { action: "close" }, undefined, undefined, fakeCtx().ctx);
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain("2 comments are still a draft");
		expect(calls).not.toContain("close");

		const clear = fakeSession({ status: { drafts: 0 } });
		const closed = await toolFor(clear.session).execute("c1", { action: "close" }, undefined, undefined, fakeCtx().ctx);
		expect(closed.content[0].text).toBe("Review closed.");
		expect(closed.details.open).toBe(false);
		expect(clear.calls).toContain("close");
	});
});

describe("statusLine", () => {
	test("says how to serve one when no page is open", () => {
		expect(statusLine({ scope: "base", label: "", files: 0, comments: 0, drafts: 0, sent: 0, reviewed: 0 })).toContain(
			'action "open"',
		);
	});

	test("names the sent comments a closed page left behind", () => {
		const line = statusLine({ scope: "base", label: "", files: 0, comments: 0, drafts: 0, sent: 3, reviewed: 0 });
		expect(line).toContain("3 review comments have been sent");
	});
});
