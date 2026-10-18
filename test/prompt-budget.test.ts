/**
 * Always-on prompt budget for the per-turn injected context.
 *
 * Covers the injected-context builders, which are pure, so a regression in the
 * text re-injected every turn fails fast.
 */

import { describe, expect, test } from "bun:test";
import { GOAL_CONTEXT_MARKER, buildGoalContext } from "../extensions/goal/index.ts";
import { PLAN_MODE_CONTEXT, PLAN_MODE_MARKER } from "../extensions/plan/index.ts";
import { WECHAT_CHANNEL_PROMPT } from "../extensions/wechat/channel.ts";
import { formatWorktreeSection } from "../extensions/worktree/index.ts";
import type { WorktreeState } from "../extensions/worktree/state.ts";

const WORKTREE: WorktreeState = {
	active: true,
	path: "/main/.pi/worktrees/feat",
	branch: "worktree-feat",
	repoRoot: "/main",
	baseRef: "HEAD",
	baseRefMode: "head",
	createdByUs: true,
};

describe("injected prompt budget", () => {
	test("plan mode context stays within its ceiling", () => {
		expect(PLAN_MODE_CONTEXT.length).toBeLessThanOrEqual(1100);
		expect(PLAN_MODE_CONTEXT).toContain(PLAN_MODE_MARKER);
	});

	test("goal context is the marker plus the objective, with no fixed prose", () => {
		expect(buildGoalContext({ objective: "ship it", status: "active" })).toBe(`${GOAL_CONTEXT_MARKER}\nship it`);
	});

	test("worktree section stays within its ceiling and keeps the facts", () => {
		const section = formatWorktreeSection(WORKTREE);
		expect(section.length).toBeLessThanOrEqual(260);
		expect(section).toContain(WORKTREE.path);
		expect(section).toContain("exit_worktree");
	});

	test("an inherited worktree says not to exit it", () => {
		expect(formatWorktreeSection({ ...WORKTREE, borrowed: true })).toContain("inherited");
	});

	test("the wechat channel contract stays within its ceiling and names the medium", () => {
		// Always on for every peer request: keep it small, and keep the two rules
		// that a terminal-shaped answer gets wrong (the phone, and commands).
		expect(WECHAT_CHANNEL_PROMPT.length).toBeLessThanOrEqual(700);
		expect(WECHAT_CHANNEL_PROMPT.split("\n").length).toBeLessThanOrEqual(12);
		expect(WECHAT_CHANNEL_PROMPT).toContain("phone chat");
		expect(WECHAT_CHANNEL_PROMPT).toContain("run a command");
	});
});
