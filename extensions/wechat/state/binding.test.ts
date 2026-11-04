/**
 * The session's binding entry: which account this branch runs, and whether a stop
 * outranks it. The branch is passed in as plain entries, as the host replays them.
 */

import { describe, expect, test } from "bun:test";
import { BINDING_ENTRY, loadBinding, persistBinding } from "./binding.ts";

/** One custom entry on a branch, as `sessionManager.getBranch()` reports it. */
function entry(customType: string, data: unknown, type = "custom"): unknown {
	return { type, customType, data };
}

describe("binding", () => {
	test("appends the binding under the wechat entry type", () => {
		const written: Array<{ customType: string; data?: unknown }> = [];
		persistBinding((customType, data) => written.push({ customType, data }), { account: "bot-1" });
		expect(written).toEqual([{ customType: BINDING_ENTRY, data: { account: "bot-1" } }]);
	});

	test("the last entry wins, so a stop outranks the start before it", () => {
		const branch = [entry("wechat", { account: "bot-1" }), entry("wechat", { account: null })];
		expect(loadBinding(branch)).toEqual({ account: null });
	});

	test("a later start replaces an earlier stop", () => {
		const branch = [entry("wechat", { account: null }), entry("wechat", { account: "bot-2" })];
		expect(loadBinding(branch)?.account).toBe("bot-2");
	});

	test("ignores another extension's entry, a message, and a malformed binding", () => {
		const branch = [
			entry("wechat", { account: "bot-1" }),
			entry("worktree", { active: true }),
			entry("wechat", { account: 42 }),
			entry("wechat", { account: "" }),
			entry("wechat", { account: "bot-1" }, "message"),
			entry("wechat", { account: "bot-1" }, "custom"),
		];
		// The malformed entries are skipped rather than clearing the binding, so one
		// hand-edited record cannot silently unbind a session.
		expect(loadBinding(branch)).toEqual({ account: "bot-1" });
	});

	test("reports no binding for a branch that carries none", () => {
		expect(loadBinding([])).toBeUndefined();
		expect(loadBinding([entry("worktree", { active: false })])).toBeUndefined();
	});
});
