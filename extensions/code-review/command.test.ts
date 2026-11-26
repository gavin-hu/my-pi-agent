import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { registerReviewCommand, REVIEW_USAGE, REVIEW_WORDS } from "./command.ts";
import type { OpenOutcome, ReviewSession, ReviewStatus } from "./review/session.ts";
import { comparisonOf } from "../../test/helpers/review-scope.ts";

/** A session the command drives, recording what it was asked. */
function fakeSession(options: { opened?: OpenOutcome; status?: Partial<ReviewStatus> } = {}) {
	const calls: Array<Record<string, unknown>> = [];
	const status: ReviewStatus = {
		url: "http://127.0.0.1:4781/review/new",
		scope: comparisonOf("change", "origin/main"),
		label: "main...HEAD",
		files: 2,
		comments: 1,
		drafts: 0,
		sent: 1,
		reviewed: 0,
		...options.status,
	};
	const session: ReviewSession = {
		open: async (input) => {
			calls.push({ kind: "open", input });
			return options.opened ?? { kind: "open", status };
		},
		status: async () => status,
		sent: () => [],
		close: async () => {
			calls.push({ kind: "close" });
		},
	};
	return { session, calls, status };
}

/** The command, registered through a double. */
function commandFor(session: ReviewSession) {
	const { pi, commands } = createFakePi();
	registerReviewCommand(pi, async () => session);
	return commands.get("review");
}

describe("/review", () => {
	test("completes every word it offers, and nothing else", () => {
		const { session } = fakeSession();
		const command = commandFor(session);
		const complete = (prefix: string): string[] =>
			(command.getArgumentCompletions(prefix) ?? []).map((item: { value: string }) => item.value);
		expect(complete("")).toEqual([...REVIEW_WORDS]);
		expect(complete("st")).toEqual(["staged", "status", "stop"]);
		expect(complete("ch")).toEqual(["change"]);
		expect(complete("branch")).toEqual(["branch"]);
		expect(complete("nope")).toEqual([]);
		expect(command.getArgumentCompletions("branch extra")).toBeNull();
	});

	test("a bare /review opens the page at the default scope", async () => {
		const { session, calls } = fakeSession();
		const { ctx, notices } = fakeCtx();
		await commandFor(session).handler("", ctx);
		expect(calls).toEqual([{ kind: "open", input: {} }]);
		expect(notices).toEqual([]);
	});

	test("a scope word opens at that scope", async () => {
		const { session, calls } = fakeSession();
		await commandFor(session).handler("worktree", fakeCtx().ctx);
		expect(calls).toEqual([{ kind: "open", input: { scope: "worktree" } }]);
	});

	test("an unknown word names the usage and opens nothing", async () => {
		const { session, calls } = fakeSession();
		const { ctx, notices } = fakeCtx();
		await commandFor(session).handler("Head", ctx);
		expect(calls).toEqual([]);
		expect(notices.at(-1)).toEqual({ message: `review: ${REVIEW_USAGE}`, kind: "error" });
	});

	test("status prints the page's line; stop closes it and says what was sent", async () => {
		const status = fakeSession({ status: { sent: 2 } });
		const shown = fakeCtx();
		await commandFor(status.session).handler("status", shown.ctx);
		expect(shown.notices.at(-1)?.message).toContain("2 files");

		const stopped = fakeSession({ status: { sent: 2 } });
		const { ctx, notices } = fakeCtx();
		await commandFor(stopped.session).handler("stop", ctx);
		expect(stopped.calls).toEqual([{ kind: "close" }]);
		expect(notices.at(-1)?.message).toBe("review: stopped — 2 comments sent this session");
	});
});
