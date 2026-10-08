/**
 * Model-facing tools for the worktree extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { enterWorktree, exitWorktree, pruneWorktrees, worktreeStatus } from "./lifecycle.ts";
import { getActive, getInactiveOverrides } from "./runtime.ts";

/**
 * Model-facing tool names, verb-first to match Claude Code's plan/worktree tools
 * (`EnterWorktree`/`ExitWorktree`). Exported so the naming guard test can check
 * them without loading the extension.
 */
export const WORKTREE_TOOLS = {
	enter: "enter_worktree",
	exit: "exit_worktree",
	prune: "prune_worktrees",
	list: "list_worktrees",
} as const;

export function registerTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: WORKTREE_TOOLS.enter,
		label: "Enter worktree",
		description:
			"Use this tool ONLY when explicitly instructed to work in a git worktree, either by the user or by project " +
			"instructions. It creates an isolated git worktree and switches the session's working directory into it, so " +
			"edits stay isolated from the main checkout. Pass `name` to create a new worktree, or `path` to switch into an " +
			"existing worktree. The tool errors if the session is already isolated; call exit_worktree first.",
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({
					description: "Name for a new worktree (branch worktree-<name>, directory .pi/worktrees/<name>).",
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Absolute or repo-relative path of an existing worktree to enter instead of creating one.",
				}),
			),
		}),
		annotations: { destructiveHint: true, openWorldHint: true },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { state, summary } = await enterWorktree(pi, ctx, { name: params.name, path: params.path });
			return {
				content: [{ type: "text", text: summary }],
				details: { state },
			};
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.exit,
		label: "Exit worktree",
		description:
			"Leave the current git worktree and return to the main checkout. The worktree is removed when it is clean; " +
			"when it has uncommitted changes or new commits the user is asked whether to keep it. Use this after merging " +
			"or finishing work started with enter_worktree.",
		parameters: Type.Object({
			remove: Type.Optional(Type.Boolean({ description: "Force removal (or keep when false) without prompting." })),
			keepBranch: Type.Optional(Type.Boolean({ description: "Keep the worktree branch when removing." })),
		}),
		annotations: { destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await exitWorktree(pi, ctx, { remove: params.remove, keepBranch: params.keepBranch });
			return {
				content: [{ type: "text", text: result.output }],
				details: { state: result.state, removed: result.removed },
			};
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.prune,
		label: "Prune worktrees",
		description:
			"Remove managed git worktrees that are clean, have no new commits, are not the current worktree, are not " +
			"locked by a live process, and are older than the configured pruneAfterDays. Worktrees with any work are kept.",
		parameters: Type.Object({}),
		annotations: { destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return { content: [{ type: "text", text: await pruneWorktrees(pi, ctx) }], details: {} };
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.list,
		label: "Worktree status",
		description:
			"Report whether the session is isolated in a git worktree, its path and branch, any isolation overrides that " +
			"are not active, and the managed worktrees on disk. Read-only; use it before assuming you are or are not isolated.",
		parameters: Type.Object({}),
		annotations: { readOnlyHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const current = getActive();
			return {
				content: [{ type: "text", text: await worktreeStatus(pi, ctx) }],
				details: {
					active: current ? { path: current.path, branch: current.branch, borrowed: !!current.borrowed } : null,
					inactiveOverrides: getInactiveOverrides(),
				},
			};
		},
	});
}
