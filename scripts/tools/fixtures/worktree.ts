/**
 * Worktree isolation in the gallery: enter, exit, list, and prune — one block per
 * action of the folded `worktree` tool.
 *
 * These read as a small table, so the fixture is this session's worktrees — the
 * current one, a dirty one, and one already merged.
 */

import type { ToolFixture } from "./types.ts";
import { CWD } from "./workspace.ts";

/** The state a worktree session carries, as the lifecycle hands it back. */
const STATE = {
	active: true,
	name: "tool-gallery",
	path: `${CWD}/.pi/worktrees/tool-gallery`,
	branch: "worktree-tool-gallery",
	repoRoot: CWD,
	baseRef: "origin/main",
	baseRefMode: "head",
	createdByUs: true,
};

/** One entry per action of the `worktree` tool, in gallery order. */
export const WORKTREE_FIXTURES: ToolFixture[] = [
	{
		name: "worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { action: "enter", name: "tool-gallery" },
		result: {
			content: [
				{
					type: "text",
					text: `Worktree: tool-gallery\n  path:   ${STATE.path}\n  branch: worktree-tool-gallery\n  base:   origin/main (head)\n  main:   ${CWD}`,
				},
			],
			details: { action: "enter", state: STATE },
		},
	},
	{
		name: "worktree-exit",
		tool: "worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { action: "exit", remove: true },
		result: {
			content: [{ type: "text", text: "Exited worktree tool-gallery and removed it." }],
			details: { action: "exit", state: STATE, removed: true },
		},
	},
	{
		name: "worktree-list",
		tool: "worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { action: "list" },
		result: {
			content: [
				{
					type: "text",
					text: [
						"Managed worktrees (3):",
						`  ${CWD}/.pi/worktrees/tool-gallery  worktree-tool-gallery  [current, clean]`,
						`  ${CWD}/.pi/worktrees/feature-auth  worktree-feature-auth  [dirty (4), ahead 2]`,
						`  ${CWD}/.pi/worktrees/fix-typo      worktree-fix-typo       [merged, used 3d ago]`,
					].join("\n"),
				},
			],
			details: {
				action: "list",
				active: { path: STATE.path, branch: STATE.branch, borrowed: false },
				inactiveOverrides: [],
			},
		},
	},
	{
		name: "worktree-prune",
		tool: "worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { action: "prune" },
		result: {
			content: [{ type: "text", text: "Removed 2 worktrees: feature-auth, fix-typo." }],
			details: { action: "prune" },
		},
	},
];
