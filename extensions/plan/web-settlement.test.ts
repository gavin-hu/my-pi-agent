/**
 * The settlements the page can post and the keys that reach them: one submit path
 * for saves, approvals, posts, and cancels, and a keymap that reads the surface the
 * page wired.
 */

import { describe, expect, test } from "bun:test";
import {
	approveReview,
	cancelReview,
	postReviewComments,
	saveReview,
	submitAnnotations,
	WEB_SETTLE_JS,
} from "./web-settle.ts";
import { handleKey, rememberSelection, WEB_KEYS_JS } from "./web-keys.ts";

describe("review settlement", () => {
	const harness = (answer: { ok: boolean; status: number; body: unknown }, over: Record<string, unknown> = {}) => {
		const painted: Array<{ text: string; kind?: string }> = [];
		const calls = {
			clean: 0,
			draft: 0,
			state: 0,
			reload: 0,
			lock: 0,
			settled: [] as string[],
			adopted: [] as string[],
			sent: [] as string[],
		};
		const buttons = { approve: { disabled: false }, save: { disabled: false }, post: { disabled: false } };
		const deps = {
			token: () => "s3cret",
			// The fixture's review answers at the origin's root.
			base: () => "",
			role: () => "owner",
			mine: () => [{ anchor: 1 }],
			annotations: () => [{ anchor: 1 }, { anchor: 2 }],
			settled: () => false,
			setStatus: (text: string, kind?: string) => painted.push({ text, kind }),
			buttons: () => buttons,
			clearDraft: () => (calls.draft += 1),
			markClean: () => (calls.clean += 1),
			adoptName: (name: string) => calls.adopted.push(name),
			offerReload: () => (calls.reload += 1),
			markSettled: (kind: string) => calls.settled.push(kind),
			settleStream: () => calls.settled.push("stream"),
			lockActions: () => (calls.lock += 1),
			updateState: () => (calls.state += 1),
			confirmNoDraft: () => false,
			post: async (url: string) => {
				calls.sent.push(url);
				return answer;
			},
			send: async (url: string) => calls.sent.push(url),
			planMoved: "The plan changed on disk \u2014 reload to review again.",
			...over,
		} as Parameters<typeof submitAnnotations>[0];
		return { deps, painted, calls, buttons };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_SETTLE_JS).not.toContain("`");
		expect(WEB_SETTLE_JS).not.toContain("${");
		for (const fn of [submitAnnotations, saveReview, postReviewComments, approveReview, cancelReview]) {
			expect(WEB_SETTLE_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a reviewer posts only her own comments, and an owner posts all of them", async () => {
		const owner = harness({ ok: true, status: 200, body: null });
		await submitAnnotations(owner.deps, "/api/comment", "posted", "failed: ", null);
		expect(owner.calls.sent).toEqual(["/api/comment?token=s3cret"]);

		const reviewer = harness({ ok: true, status: 200, body: null }, { role: () => "reviewer" });
		let sent: unknown = null;
		reviewer.deps.post = async (_url: string, body: unknown) => {
			sent = body;
			return { ok: true, status: 200, body: null };
		};
		await submitAnnotations(reviewer.deps, "/api/comment", "posted", "failed: ", null);
		// The reviewer's payload is her own write, not the page's whole comment list.
		expect(sent).toEqual({ annotations: [{ anchor: 1 }] });
	});

	test("a success clears the draft, paints the sentence, and reports it once", async () => {
		const { deps, painted, calls } = harness({ ok: true, status: 200, body: { author: "mei" } });
		let onOk = 0;
		const result = await submitAnnotations(deps, "/api/feedback", "Saved.", "Could not save: ", () => (onOk += 1));
		expect(result.outcome).toBe("ok");
		expect(calls.clean).toBe(1);
		expect(calls.draft).toBe(1);
		expect(onOk).toBe(1);
		expect(painted).toEqual([{ text: "Saved.", kind: "saved" }]);
		// An owner posts untagged comments; the name the server bound is a reviewer's.
		expect(calls.adopted).toEqual([]);
	});

	test("a reviewer adopts the name the server bound to her link", async () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: { author: "mei" } }, { role: () => "reviewer" });
		await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(calls.adopted).toEqual(["mei"]);
	});

	test("a conflict disables the writes, offers a reload, and says the server's reason", async () => {
		const { deps, buttons, calls, painted } = harness({
			ok: false,
			status: 409,
			body: { error: "a link is bound to @mei" },
		});
		const result = await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(result.outcome).toBe("conflict");
		expect(buttons).toEqual({ approve: { disabled: true }, save: { disabled: true }, post: { disabled: true } });
		expect(calls.reload).toBe(1);
		expect(painted).toEqual([{ text: "a link is bound to @mei", kind: "error" }]);
	});

	test("a conflict with no sentence of its own falls back to the plan-moved line", async () => {
		const { deps, painted } = harness({ ok: false, status: 409, body: null });
		await submitAnnotations(deps, "/api/comment", "posted", "failed: ", null);
		expect(painted).toEqual([{ text: "The plan changed on disk \u2014 reload to review again.", kind: "error" }]);
	});

	test("a refusal surfaces the server's reason under the caller's prefix", async () => {
		const { deps, painted } = harness({ ok: false, status: 422, body: { error: "comment is empty" } });
		const result = await submitAnnotations(deps, "/api/feedback", "saved", "Could not save: ", null);
		expect(result.outcome).toBe("failed");
		expect(painted).toEqual([{ text: "Could not save: comment is empty", kind: "error" }]);
	});

	test("a settled review writes nothing at all", () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: null }, { settled: () => true });
		expect(saveReview(deps)).toBeNull();
		expect(approveReview(deps)).toBeNull();
		expect(postReviewComments(deps)).toBeNull();
		expect(cancelReview(deps)).toBeNull();
		expect(calls.sent).toEqual([]);
	});

	test("saving and approving mark the review settled; cancelling is the owner's alone", async () => {
		const save = harness({ ok: true, status: 200, body: null });
		await saveReview(save.deps);
		expect(save.calls.settled).toEqual(["saved", "stream"]);
		expect(save.calls.lock).toBe(1);

		const approve = harness({ ok: true, status: 200, body: null });
		await approveReview(approve.deps);
		expect(approve.calls.settled).toEqual(["approved", "stream"]);

		const close = harness({ ok: true, status: 200, body: null });
		await cancelReview(close.deps);
		expect(close.calls.settled).toEqual(["closed", "stream"]);
		expect(close.calls.sent).toEqual(["/api/cancel?token=s3cret"]);
		expect(close.painted.at(-1)).toEqual({ text: "Closed \u2014 return to Pi.", kind: undefined });

		const reviewer = harness({ ok: true, status: 200, body: null }, { role: () => "reviewer" });
		expect(cancelReview(reviewer.deps)).toBeNull();
		expect(reviewer.calls.sent).toEqual([]);
	});

	test("a half-written comment refuses the way out before anything is sent", async () => {
		const { deps, calls } = harness({ ok: true, status: 200, body: null }, { confirmNoDraft: () => true });
		expect(saveReview(deps)).toBeNull();
		expect(postReviewComments(deps)).toBeNull();
		expect(cancelReview(deps)).toBeNull();
		expect(calls.sent).toEqual([]);
	});
});

describe("review keyboard", () => {
	const harness = (over: Record<string, unknown> = {}) => {
		const calls: string[] = [];
		const deps = {
			composerOpen: () => false,
			closeComposer: () => calls.push("closeComposer"),
			cancel: () => calls.push("cancel"),
			sheetOpen: () => false,
			toggleSheet: () => calls.push("toggleSheet"),
			moveActive: (delta: number) => calls.push("move" + delta),
			commentOnActive: () => calls.push("comment"),
			askApprove: () => calls.push("approve"),
			save: () => calls.push("save"),
			postComments: () => calls.push("post"),
			hasSaveControl: () => true,
			hasApproveControl: () => true,
			typing: () => false,
			...over,
		} as Parameters<typeof handleKey>[1];
		const event = (key: string, more: Record<string, unknown> = {}) => {
			let prevented = 0;
			return {
				sent: { key, preventDefault: () => (prevented += 1), ...more } as Parameters<typeof handleKey>[0],
				get prevented() {
					return prevented;
				},
			};
		};
		return { deps, calls, event };
	};

	test("carries the source, safe to splice into the client bundle", () => {
		expect(WEB_KEYS_JS).not.toContain("`");
		expect(WEB_KEYS_JS).not.toContain("${");
		expect(WEB_KEYS_JS.split(String(handleKey)).length).toBe(2);
		expect(WEB_KEYS_JS.split(String(rememberSelection)).length).toBe(2);
	});

	test("Esc peels the composer first, then closes the review", () => {
		const withComposer = harness({ composerOpen: () => true });
		handleKey(withComposer.event("Escape").sent, withComposer.deps);
		expect(withComposer.calls).toEqual(["closeComposer"]);

		const bare = harness();
		handleKey(bare.event("Escape").sent, bare.deps);
		expect(bare.calls).toEqual(["cancel"]);
	});

	test("a field owns the keyboard, and a modified key is never a shortcut", () => {
		const typing = harness({ typing: () => true });
		handleKey(typing.event("j").sent, typing.deps);
		handleKey(typing.event("?").sent, typing.deps);
		expect(typing.calls).toEqual([]);

		const modified = harness();
		handleKey(modified.event("s", { ctrlKey: true }).sent, modified.deps);
		handleKey(modified.event("k", { metaKey: true }).sent, modified.deps);
		expect(modified.calls).toEqual([]);
	});

	test("the sheet owns the keyboard while it is open, and ? is what opens it", () => {
		const closed = harness();
		const question = closed.event("?");
		handleKey(question.sent, closed.deps);
		expect(closed.calls).toEqual(["toggleSheet"]);
		expect(question.prevented).toBe(1);

		const open = harness({ sheetOpen: () => true });
		for (const key of ["j", "k", "c", "a", "s"]) handleKey(open.event(key).sent, open.deps);
		expect(open.calls).toEqual([]);
	});

	test("n and N walk the comments, v cycles the view", () => {
		const { deps, calls } = harness({
			moveComment: (delta: number) => calls.push("comment" + delta),
			cycleView: () => calls.push("view"),
		});
		handleKey({ key: "n", preventDefault() {} }, deps);
		handleKey({ key: "N", preventDefault() {} }, deps);
		handleKey({ key: "v", preventDefault() {} }, deps);
		expect(calls).toEqual(["comment1", "comment-1", "view"]);
	});

	test("does not answer a key the page never wired", () => {
		// The surface decides what is documented, and the same surface decides what acts:
		// a page without the walk leaves `n` to the browser rather than swallowing it.
		const { deps, calls } = harness();
		handleKey({ key: "n", preventDefault() {} }, deps);
		handleKey({ key: "v", preventDefault() {} }, deps);
		expect(calls).toEqual([]);
	});

	test("j and k walk, c comments, a approves", () => {
		const { deps, calls } = harness();
		handleKey({ key: "j", preventDefault() {} }, deps);
		handleKey({ key: "k", preventDefault() {} }, deps);
		handleKey({ key: "c", preventDefault() {} }, deps);
		handleKey({ key: "a", preventDefault() {} }, deps);
		expect(calls).toEqual(["move1", "move-1", "comment", "approve"]);
	});

	test("s saves for an owner and posts for a reviewer", () => {
		// The same key means "write my work down": the owner's save ends the review, a
		// reviewer's post does not, and the page has one button at a time.
		const owner = harness();
		handleKey({ key: "s", preventDefault() {} }, owner.deps);
		expect(owner.calls).toEqual(["save"]);

		const reviewer = harness({ hasSaveControl: () => false });
		handleKey({ key: "s", preventDefault() {} }, reviewer.deps);
		expect(reviewer.calls).toEqual(["post"]);
	});

	test("a release remembers the selection, and forgets it outside a block", () => {
		const remembered: Array<{ wrap: unknown; quote: string } | null> = [];
		const block = { querySelector: () => null } as never;
		const deps = {
			planEl: {} as never,
			settled: () => false,
			selectionIn: () => "the plan",
			setPending: (quote: { wrap: unknown; quote: string } | null) => remembered.push(quote),
		} as Parameters<typeof rememberSelection>[1];

		rememberSelection({ closest: () => block }, deps);
		expect(remembered).toEqual([{ wrap: block, quote: "the plan" }]);

		// A release outside any block clears what was there: the next click must not quote it.
		rememberSelection({ closest: () => null }, deps);
		expect(remembered).toEqual([{ wrap: block, quote: "the plan" }, null]);

		// A settled review remembers nothing at all.
		const settled = { ...deps, settled: () => true } as Parameters<typeof rememberSelection>[1];
		rememberSelection({ closest: () => block }, settled);
		expect(remembered).toHaveLength(2);
	});
});
