import { describe, expect, test } from "bun:test";
import { loadState, persistState, type WorktreeState } from "./state.ts";

const state: WorktreeState = {
	active: true,
	path: "/tmp/wt",
	repoRoot: "/tmp/repo",
	baseRef: "HEAD",
	baseRefMode: "head",
	createdByUs: true,
};

function ctxWithBranch(entries: unknown[]) {
	return { sessionManager: { getBranch: () => entries } } as unknown as Parameters<typeof loadState>[0];
}

describe("persistState", () => {
	test("appends a worktree custom entry", () => {
		const calls: Array<{ customType: string; data?: unknown }> = [];
		persistState((customType, data) => calls.push({ customType, data }), state);
		expect(calls).toEqual([{ customType: "worktree", data: state }]);
	});
});

describe("loadState", () => {
	test("returns undefined when nothing was recorded", () => {
		expect(loadState(ctxWithBranch([]))).toBeUndefined();
	});

	test("returns the last recorded state, ignoring other entries", () => {
		const entries = [
			{ type: "message", data: "hello" },
			{ type: "custom", customType: "worktree", data: state },
			{ type: "custom", customType: "other", data: { path: "/nope" } },
			{ type: "custom", customType: "worktree", data: { ...state, path: "/tmp/wt2" } },
		];
		expect(loadState(ctxWithBranch(entries))?.path).toBe("/tmp/wt2");
	});

	test("ignores records without a string path", () => {
		const entries = [
			{ type: "custom", customType: "worktree", data: { active: true } },
			{ type: "custom", customType: "worktree", data: null },
			{ type: "custom", customType: "worktree", data: "nope" },
		];
		expect(loadState(ctxWithBranch(entries))).toBeUndefined();
	});

	test("keeps an earlier valid record when a later one is malformed", () => {
		const entries = [
			{ type: "custom", customType: "worktree", data: state },
			{ type: "custom", customType: "worktree", data: { path: 42 } },
		];
		expect(loadState(ctxWithBranch(entries))?.path).toBe("/tmp/wt");
	});
});
