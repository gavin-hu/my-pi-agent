import { describe, expect, test } from "bun:test";
import {
	BAD_TOKEN,
	commentRef,
	createReviewStore,
	MAX_COMMENT_LENGTH,
	MAX_COMMENTS,
	NO_PAGE,
	SNAPSHOT_MOVED,
	type WriteOp,
} from "./store.ts";

/** A store whose tokens and clock are counted, so a case reads what it minted. */
function countingStore() {
	let tokens = 0;
	let clock = 1000;
	const store = createReviewStore({
		mint: () => `token${++tokens}${"a".repeat(26)}`,
		now: () => clock++,
	});
	/** Every value the store minted: the page token first, then each review and comment id. */
	return { store, count: () => tokens };
}

const REV = "snap-1";

/** A comment op on `a.ts:4`. */
function comment(body = "this needs a guard"): WriteOp {
	return { kind: "comment", rel: "a.ts", line: 4, side: "new", body };
}

/** A reply to `parent`, on the line `comment()` names. */
function replyTo(parent: string, body = "and a test"): WriteOp {
	return { kind: "comment", rel: "a.ts", line: 4, side: "new", parent, body };
}

describe("the review page", () => {
	test("opens with a token and no review: nothing is minted until the first write", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		expect(page.token.length).toBeGreaterThan(20);
		expect(page.review).toBeUndefined();
		expect(store.current()?.scope).toBe("base");
	});

	test("the first write mints one id, and the next keeps it", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const first = store.write(page.token, REV, REV, comment());
		expect(first.ok).toBe(true);
		const second = store.write(page.token, REV, REV, comment("and a test"));
		expect(second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(first.id).toBe(second.id);
		expect(second.review.comments).toHaveLength(2);
		expect(second.review.comments.map((entry) => entry.state)).toEqual(["draft", "draft"]);
	});

	test("a send, a drop and a mark land on a snapshot the page no longer shows", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const first = store.write(page.token, REV, REV, comment());
		if (!first.ok) throw new Error(first.message);
		const id = first.review.comments[0].id;
		// Only a comment anchors to a line, so only a comment is refused by a tree that moved.
		expect(store.write(page.token, REV, "snap-2", comment("stale")).ok).toBe(false);
		expect(store.write(page.token, REV, "snap-2", { kind: "reviewed", rel: "a.ts", reviewed: true }).ok).toBe(true);
		const sent = store.write(page.token, REV, "snap-2", { kind: "send" });
		expect(sent.ok).toBe(true);
		const dropped = store.write(page.token, REV, "snap-2", { kind: "drop", id });
		if (!dropped.ok) throw new Error(dropped.message);
		expect(dropped.review.comments).toEqual([]);
	});

	test("the first write records the page's snapshot, not the one it read", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		// A stale page's first write must not clear the banner saying the diff moved under it, so
		// the review keeps the revision the page rendered rather than the fresh one.
		const marked = store.write(page.token, REV, "snap-2", { kind: "reviewed", rel: "a.ts", reviewed: true });
		if (!marked.ok) throw new Error(marked.message);
		expect(marked.review.rev).toBe(REV);
	});

	test("a reply keeps the comment it answers, and answers nothing itself", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const first = store.write(page.token, REV, REV, comment());
		if (!first.ok) throw new Error(first.message);
		const parent = first.review.comments[0].id;
		const answered = store.write(page.token, REV, REV, replyTo(parent));
		if (!answered.ok) throw new Error(answered.message);
		const child = answered.review.comments[1].id;
		expect(answered.review.comments.map((entry) => entry.parent ?? null)).toEqual([null, parent]);
		// One level: the review refuses to hold a reply to a reply, so the page's order rule can
		// only ever meet roots and their own replies.
		expect(store.write(page.token, REV, REV, replyTo(child))).toEqual({
			ok: false,
			status: 400,
			message: "a reply answers a comment, not another reply",
		});
		expect(store.current()?.review?.comments).toHaveLength(2);
	});

	test("refuses a parent on another line, and one the review does not hold", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const first = store.write(page.token, REV, REV, comment());
		if (!first.ok) throw new Error(first.message);
		const parent = first.review.comments[0].id;
		expect(
			store.write(page.token, REV, REV, {
				kind: "comment",
				rel: "a.ts",
				line: 9,
				side: "new",
				parent,
				body: "x",
			}),
		).toEqual({
			ok: false,
			status: 400,
			message: "a reply answers a comment on its own line — a.ts:4 (new) is not a.ts:9 (new)",
		});
		expect(store.write(page.token, REV, REV, replyTo("not-a-comment"))).toEqual({
			ok: false,
			status: 400,
			message: "a reply answers a comment on this review",
		});
		expect(store.current()?.review?.comments).toHaveLength(1);
	});

	test("a comment on a span keeps its end, and one spelling names it", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const span = store.write(page.token, REV, REV, { ...comment(), endLine: 9 });
		if (!span.ok) throw new Error(span.message);
		const [written] = span.review.comments;
		expect(written).toMatchObject({ line: 4, endLine: 9 });
		expect(commentRef(written)).toBe("a.ts:4-9");
		expect(commentRef({ rel: "a.ts", line: 4 })).toBe("a.ts:4");
	});

	test("refuses a span that ends where it starts, and a reply that carries one", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		expect(store.write(page.token, REV, REV, { ...comment(), endLine: 4 })).toEqual({
			ok: false,
			status: 400,
			message: "a range ends after the line it starts on",
		});
		expect(store.write(page.token, REV, REV, { ...comment(), endLine: 2 })).toEqual({
			ok: false,
			status: 400,
			message: "a range ends after the line it starts on",
		});
		const first = store.write(page.token, REV, REV, comment());
		if (!first.ok) throw new Error(first.message);
		const parent = first.review.comments[0].id;
		// A reply answers a comment, and a comment on a span is answered at its start.
		expect(store.write(page.token, REV, REV, { ...comment("x"), parent, endLine: 9 })).toEqual({
			ok: false,
			status: 400,
			message: "a reply answers one line",
		});
		expect(store.current()?.review?.comments).toHaveLength(1);
	});

	test("a comment keeps its anchor, its quote, and its trimmed body", () => {
		const { store } = countingStore();
		const page = store.open("worktree", "", "worktree");
		const result = store.write(page.token, REV, REV, {
			kind: "comment",
			rel: " src/a.ts ",
			line: 12,
			side: "old",
			quote: "  const a = 1  ",
			body: "  prefer a named constant\n",
		});
		if (!result.ok) throw new Error(result.message);
		const [written] = result.review.comments;
		expect(written).toMatchObject({
			rel: "src/a.ts",
			line: 12,
			side: "old",
			quote: "const a = 1",
			body: "prefer a named constant",
		});
	});

	test("a snapshot the page no longer shows is refused, and nothing changes", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		store.write(page.token, REV, REV, comment());
		const moved = store.write(page.token, REV, "snap-2", comment("stale"));
		expect(moved).toEqual({ ok: false, status: 409, message: SNAPSHOT_MOVED });
		expect(store.current()?.review?.comments).toHaveLength(1);
	});

	test("a token another page minted is refused, and no page is refused", () => {
		const { store } = countingStore();
		expect(store.write("anything", REV, REV, comment())).toEqual({ ok: false, status: 409, message: NO_PAGE });
		const page = store.open("base", "main", "main...HEAD");
		const other = store.open("last", "", "HEAD~1...HEAD");
		const refused = store.write(page.token, REV, REV, comment());
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.message).toBe(BAD_TOKEN);
		expect(store.write(other.token, REV, REV, comment()).ok).toBe(true);
	});
});

describe("a refused first write", () => {
	/**
	 * The state after a refused write, not the answer. These cases used to assert only
	 * `.ok` and the message, which is how a refusal that minted a review stayed green: the
	 * mint sat above every validation, so the page carried an id, the `review <id>` chip and
	 * a resumable URL for a review nobody made. A refusal now mints nothing and adopts
	 * nothing, and the mint count proves the second half.
	 */
	const refusals: Array<[string, WriteOp, number]> = [
		["a comment with no body", { kind: "comment", rel: "a.ts", line: 1, side: "new", body: "   " }, 400],
		[
			"a comment over the length cap",
			{ kind: "comment", rel: "a.ts", line: 1, side: "new", body: "x".repeat(MAX_COMMENT_LENGTH + 1) },
			400,
		],
		["a comment with no file", { kind: "comment", rel: " ", line: 1, side: "new", body: "x" }, 400],
		["a comment with no line", { kind: "comment", rel: "a.ts", line: 0, side: "new", body: "x" }, 400],
		["a drop of an id the review does not hold", { kind: "drop", id: "missing" }, 404],
		["a mark with no file", { kind: "reviewed", rel: "", reviewed: true }, 400],
	];

	for (const [name, op, status] of refusals) {
		test(`${name} mints nothing`, () => {
			const { store, count } = countingStore();
			const page = store.open("base", "main", "main...HEAD");
			const before = count();
			const refused = store.write(page.token, REV, REV, op);
			expect(refused.ok).toBe(false);
			if (!refused.ok) expect(refused.status).toBe(status);
			expect(store.current()?.review).toBeUndefined();
			expect(count(), "a refusal consumed an id").toBe(before);
		});
	}

	test("the first accepted write mints exactly one id, and resume answers for it", () => {
		const { store, count } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		expect(count(), "the page opened with one token").toBe(1);
		const refused = store.write(page.token, REV, REV, {
			kind: "comment",
			rel: "a.ts",
			line: 0,
			side: "new",
			body: "x",
		});
		expect(refused.ok).toBe(false);
		expect(count(), "the refusal consumed nothing").toBe(1);

		// A mark, not a comment: the comment would mint its own id too, and this case is about
		// the review's id being minted once.
		const accepted = store.write(page.token, REV, REV, { kind: "reviewed", rel: "a.ts", reviewed: true });
		if (!accepted.ok) throw new Error(accepted.message);
		expect(count(), "exactly one id was minted").toBe(2);
		expect(store.current()?.review?.id).toBe(accepted.id);
		expect(store.resume(accepted.id, page.token)?.review?.id).toBe(accepted.id);
	});
});

describe("the comments a review holds", () => {
	test("an empty body, an over-long one, a bad line, and a full review are refused", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const write = (op: WriteOp) => store.write(page.token, REV, REV, op);
		const empty = write(comment("   "));
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.message).toContain("needs something written");
		const long = write({
			kind: "comment",
			rel: "a.ts",
			line: 1,
			side: "new",
			body: "x".repeat(MAX_COMMENT_LENGTH + 1),
		});
		expect(long.ok).toBe(false);
		if (!long.ok) expect(long.message).toContain(String(MAX_COMMENT_LENGTH));
		expect(write({ kind: "comment", rel: "a.ts", line: 0, side: "new", body: "x" }).ok).toBe(false);
		expect(write({ kind: "comment", rel: "", line: 1, side: "new", body: "x" }).ok).toBe(false);
		for (let index = 0; index < MAX_COMMENTS; index++) {
			expect(write(comment(`note ${index}`)).ok).toBe(true);
		}
		const full = write(comment("one more"));
		expect(full.ok).toBe(false);
		if (!full.ok) expect(full.message).toContain(String(MAX_COMMENTS));
	});

	test("drop removes one comment and refuses an id that is not there", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const added = store.write(page.token, REV, REV, comment());
		if (!added.ok) throw new Error(added.message);
		const id = added.review.comments[0].id;
		const dropped = store.write(page.token, REV, REV, { kind: "drop", id });
		expect(dropped.ok && dropped.review.comments).toEqual([]);
		const missing = store.write(page.token, REV, REV, { kind: "drop", id });
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.status).toBe(404);
	});

	test("a reviewed mark is set once and cleared again", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		store.write(page.token, REV, REV, comment());
		const marked = store.write(page.token, REV, REV, { kind: "reviewed", rel: "a.ts", reviewed: true });
		if (!marked.ok) throw new Error(marked.message);
		expect(marked.review.reviewed).toEqual(["a.ts"]);
		const again = store.write(page.token, REV, REV, { kind: "reviewed", rel: "a.ts", reviewed: true });
		if (!again.ok) throw new Error(again.message);
		expect(again.review.reviewed).toEqual(["a.ts"]);
		const cleared = store.write(page.token, REV, REV, { kind: "reviewed", rel: "a.ts", reviewed: false });
		if (!cleared.ok) throw new Error(cleared.message);
		expect(cleared.review.reviewed).toEqual([]);
	});
});

describe("sending", () => {
	test("marks every draft sent and hands the session the list once", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		store.write(page.token, REV, REV, comment("one"));
		store.write(page.token, REV, REV, comment("two"));
		const sent = store.write(page.token, REV, REV, { kind: "send" });
		if (!sent.ok) throw new Error(sent.message);
		expect(sent.sent.map((entry) => entry.body)).toEqual(["one", "two"]);
		expect(sent.review.comments.every((entry) => entry.state === "sent")).toBe(true);
		expect(sent.review.sentAt).toBeGreaterThan(0);
		const second = store.write(page.token, REV, REV, { kind: "send" });
		if (!second.ok) throw new Error(second.message);
		expect(second.sent).toEqual([]);
	});

	/**
	 * Not the defection the refusal cases fixed: a person asked to send, so the write was
	 * accepted rather than refused, and the page says so by answering `ok` with nothing
	 * sent. The review it mints is the record of the request — the signed plan states that
	 * `send` mints on success — and the second send answers the same id with the same empty
	 * list, so the route stays idempotent for a page that sends twice.
	 */
	test("an empty send is accepted: it mints one review and answers no comments", () => {
		const { store, count } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		expect(store.current()?.review).toBeUndefined();
		const sent = store.write(page.token, REV, REV, { kind: "send" });
		if (!sent.ok) throw new Error(sent.message);
		expect(sent.sent).toEqual([]);
		expect(store.current()?.review?.id).toBe(sent.id);
		expect(count(), "the send minted the review's one id").toBe(2);

		const again = store.write(page.token, REV, REV, { kind: "send" });
		if (!again.ok) throw new Error(again.message);
		expect(again.id).toBe(sent.id);
		expect(again.sent).toEqual([]);
		expect(count(), "a second send mints nothing").toBe(2);
	});

	test("a comment written after a send is a fresh draft", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		store.write(page.token, REV, REV, comment("one"));
		store.write(page.token, REV, REV, { kind: "send" });
		const later = store.write(page.token, REV, REV, comment("two"));
		if (!later.ok) throw new Error(later.message);
		expect(later.review.comments.map((entry) => entry.state)).toEqual(["sent", "draft"]);
	});
});

describe("resuming and closing", () => {
	test("resumes only the current review, and only with its own token", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		const written = store.write(page.token, REV, REV, comment());
		if (!written.ok) throw new Error(written.message);
		expect(store.resume(written.id, page.token)?.review?.id).toBe(written.id);
		expect(store.resume(written.id, "not-the-token")).toBeUndefined();
		expect(store.resume("another", page.token)).toBeUndefined();
	});

	test("closing forgets the page, and a second close is a no-op", () => {
		const { store } = countingStore();
		const page = store.open("base", "main", "main...HEAD");
		store.close();
		expect(store.current()).toBeUndefined();
		store.close();
		expect(store.write(page.token, REV, REV, comment())).toEqual({ ok: false, status: 409, message: NO_PAGE });
	});
});
