/**
 * Model-facing tools for the worktree extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	enterWorktree,
	exitWorktree,
	isWorktreeCancelled,
	pruneWorktrees,
	worktreeLabel,
	worktreeStatus,
} from "./lifecycle.ts";
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
			"Create or enter an isolated git worktree and switch the session's working directory into it. Pass `name` to " +
			"create one or `path` to enter an existing one. Errors when the session is already isolated.",
		promptSnippet: "Create or enter an isolated git worktree (only when instructed).",
		promptGuidelines: [
			"Use enter_worktree only when the user or project instructions explicitly ask for a worktree; never start one on your own initiative.",
			"Call list_worktrees first if unsure whether the session is already isolated: enter_worktree errors when it is.",
		],
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
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const { state, summary } = await enterWorktree(pi, ctx, { name: params.name, path: params.path });
				ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}`, "info");
				return {
					content: [{ type: "text", text: summary }],
					details: { state },
				};
			} catch (error) {
				if (isWorktreeCancelled(error)) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: "text", text: message }], details: { cancelled: true } };
				}
				throw error;
			}
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.exit,
		label: "Exit worktree",
		description:
			"Leave the current git worktree and return to the main checkout. The worktree is removed when clean; with " +
			"uncommitted changes or new commits the user chooses whether to keep it.",
		promptSnippet: "Leave the current git worktree and return to the main checkout.",
		promptGuidelines: [
			"Use exit_worktree after work started with enter_worktree; it is the only way back to the main checkout.",
			"Ask before ending the task rather than exiting on your own initiative, so uncommitted work is not discarded without a choice.",
		],
		parameters: Type.Object({
			remove: Type.Optional(Type.Boolean({ description: "Force removal (or keep when false) without prompting." })),
			keepBranch: Type.Optional(Type.Boolean({ description: "Keep the worktree branch when removing." })),
		}),
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = await exitWorktree(pi, ctx, { remove: params.remove, keepBranch: params.keepBranch });
				ctx.ui.notify(`Exited worktree ${worktreeLabel(result.state)}`, "info");
				return {
					content: [{ type: "text", text: result.output }],
					details: { state: result.state, removed: result.removed },
				};
			} catch (error) {
				if (isWorktreeCancelled(error)) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: "text", text: message }], details: { cancelled: true } };
				}
				throw error;
			}
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.prune,
		label: "Prune worktrees",
		description:
			"Remove managed git worktrees that are clean, have no new commits, are not the current one, are not locked by " +
			"a live process, and are older than the configured pruneAfterDays. Worktrees with any work are kept.",
		promptSnippet: "Remove clean, unused managed git worktrees older than the configured age.",
		promptGuidelines: [
			"Use prune_worktrees to clean up worktrees left behind by earlier sessions; worktrees with any work are kept.",
		],
		parameters: Type.Object({}),
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return { content: [{ type: "text", text: await pruneWorktrees(pi, ctx) }], details: {} };
		},
	});

	pi.registerTool({
		name: WORKTREE_TOOLS.list,
		label: "List worktrees",
		description:
			"Report whether the session is isolated in a git worktree, its path and branch, any inactive isolation " +
			"overrides, and the managed worktrees on disk. Read-only.",
		promptSnippet: "Report whether the session is isolated in a git worktree and list managed worktrees.",
		promptGuidelines: ["Use list_worktrees to check isolation and see managed worktrees before entering or pruning."],
		parameters: Type.Object({}),
		annotations: { readOnlyHint: true, openWorldHint: false },
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
