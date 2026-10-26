/**
 * Worktree isolation: enter, exit, prune, and list.
 *
 * These read as a small table, so the fixture is this session's worktrees —
 * the current one, a dirty one, and one already merged.
 */

import type { ToolFixture } from "./types.ts";
import { CWD } from "./workspace.ts";

/** One entry per worktree tool, in gallery order. */
export const WORKTREE_FIXTURES: ToolFixture[] = [
	{
		name: "enter_worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { name: "tool-gallery" },
		result: {
			content: [
				{
					type: "text",
					text: `Worktree: tool-gallery\n  path:   ${CWD}/.pi/worktrees/tool-gallery\n  branch: worktree-tool-gallery\n  base:   origin/main (head)\n  main:   ${CWD}`,
				},
			],
			details: {
				state: {
					active: true,
					name: "tool-gallery",
					path: `${CWD}/.pi/worktrees/tool-gallery`,
					branch: "worktree-tool-gallery",
					repoRoot: CWD,
					baseRef: "origin/main",
					baseRefMode: "head",
					createdByUs: true,
				},
			},
		},
	},
	{
		name: "exit_worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { remove: true },
		result: {
			content: [{ type: "text", text: "Exited worktree tool-gallery and removed it." }],
			details: {
				removed: true,
				state: {
					active: true,
					name: "tool-gallery",
					path: `${CWD}/.pi/worktrees/tool-gallery`,
					branch: "worktree-tool-gallery",
					repoRoot: CWD,
					baseRef: "origin/main",
					baseRefMode: "head",
					createdByUs: true,
				},
			},
		},
	},
	{
		name: "prune_worktrees",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: {},
		result: { content: [{ type: "text", text: "Removed 2 worktrees: feature-auth, fix-typo." }], details: {} },
	},
	{
		name: "list_worktrees",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: {},
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
				active: { path: `${CWD}/.pi/worktrees/tool-gallery`, branch: "worktree-tool-gallery", borrowed: false },
				inactiveOverrides: [],
			},
		},
	},
];
