/**
 * The model-facing tool for the worktree extension.
 *
 * One tool with four actions, like `plan` and `board`: `enter` creates or enters an
 * isolated checkout, `exit` returns to the main checkout, `list` reports the current
 * isolation and the managed worktrees, and `prune` removes the ones nobody is
 * using. Each action refuses outside the state it applies to, and the lifecycle
 * itself belongs to `lifecycle.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { messageOf } from "../../lib/errors.ts";
import {
	enterWorktree,
	enteredWorktree,
	exitWorktree,
	exitedWorktree,
	isWorktreeCancelled,
	pruneWorktrees,
	worktreeStatus,
} from "./lifecycle.ts";
import { getActive, getInactiveOverrides } from "./runtime.ts";

/**
 * The model-facing tool name. `worktree` is the domain, the way `plan` and `board`
 * are, and the four lifecycle verbs are its actions.
 */
export const WORKTREE_TOOL = "worktree";

/** The tool's actions, in the order the description offers them. */
export const WORKTREE_ACTIONS = ["enter", "exit", "list", "prune"] as const;

/** One verb of the `worktree` tool. */
export type WorktreeAction = (typeof WORKTREE_ACTIONS)[number];

const WorktreeParams = Type.Object({
	action: StringEnum(WORKTREE_ACTIONS, {
		description:
			"`enter` creates or enters an isolated worktree, `exit` returns to the main checkout, `list` reports the isolation and the managed worktrees, `prune` removes the unused ones.",
	}),
	name: Type.Optional(
		Type.String({
			description: "`enter`: name for a new worktree (branch worktree-<name>, directory .pi/worktrees/<name>).",
		}),
	),
	path: Type.Optional(
		Type.String({
			description: "`enter`: absolute or repo-relative path of an existing worktree to enter instead of creating one.",
		}),
	),
	remove: Type.Optional(Type.Boolean({ description: "`exit`: force removal (or keep when false) without prompting." })),
	keepBranch: Type.Optional(Type.Boolean({ description: "`exit`: keep the worktree branch when removing." })),
});

/** The fields one action reads, so a test or a caller can name them without the whole schema. */
export type WorktreeArgs = {
	action: WorktreeAction;
	name?: string;
	path?: string;
	remove?: boolean;
	keepBranch?: boolean;
};

/**
 * The result a lifecycle action answers when the user declined.
 *
 * Entering and exiting ask the same question and are refused the same way: the
 * message is the refusal the user just chose, and `cancelled` is what tells a
 * caller it was a choice rather than a failure. A cancelled call still throws —
 * every other error is a real one.
 */
function cancelledResult(error: unknown): { content: [{ type: "text"; text: string }]; details: { cancelled: true } } {
	if (!isWorktreeCancelled(error)) throw error;
	return { content: [{ type: "text", text: messageOf(error) }], details: { cancelled: true } };
}

export function registerTools(pi: ExtensionAPI): void {
	pi.registerTool<typeof WorktreeParams, unknown>({
		name: WORKTREE_TOOL,
		label: "Worktree",
		description:
			"An isolated git worktree for this session. `enter` creates one on its own branch (or enters an existing " +
			"checkout) and switches the session's working directory into it; `exit` leaves it and returns to the main " +
			"checkout, removing it when clean and asking when it holds work; `list` reports whether the session is " +
			"isolated, its path and branch, the inactive overrides, and the managed worktrees on disk; `prune` removes " +
			"the managed worktrees that are clean, have no new commits, are not the current one, are not locked by a " +
			"live process, and are older than the configured age. Every field but `action` says which action reads it.",
		promptSnippet: "Create, enter, leave, list, or prune the session's isolated git worktrees.",
		promptGuidelines: [
			"Use worktree with action enter only when the user or project instructions explicitly ask for a worktree; never start one on your own initiative.",
			"Call action list first if unsure whether the session is already isolated: action enter errors when it is.",
			"Call action exit after work started with action enter; it is the only way back to the main checkout, and asking before ending a task keeps uncommitted work from being discarded.",
			"Use action prune to clean up worktrees left behind by earlier sessions; worktrees with any work are kept.",
		],
		parameters: WorktreeParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "enter": {
					try {
						const { state, summary } = await enterWorktree(pi, ctx, { name: params.name, path: params.path });
						ctx.ui.notify(enteredWorktree(state), "info");
						return {
							content: [{ type: "text", text: summary }],
							details: { action: "enter", state },
						};
					} catch (error) {
						return cancelledResult(error);
					}
				}
				case "exit": {
					try {
						const result = await exitWorktree(pi, ctx, { remove: params.remove, keepBranch: params.keepBranch });
						ctx.ui.notify(exitedWorktree(result.state), "info");
						return {
							content: [{ type: "text", text: result.output }],
							details: {
								action: "exit",
								state: result.state,
								removed: result.removed,
								handoff: result.handoff,
							},
						};
					} catch (error) {
						return cancelledResult(error);
					}
				}
				case "prune":
					return {
						content: [{ type: "text", text: await pruneWorktrees(pi, ctx) }],
						details: { action: "prune" },
					};
				case "list": {
					const current = getActive();
					return {
						content: [{ type: "text", text: await worktreeStatus(pi, ctx) }],
						details: {
							action: "list",
							active: current ? { path: current.path, branch: current.branch, borrowed: !!current.borrowed } : null,
							inactiveOverrides: getInactiveOverrides(),
						},
					};
				}
			}
		},
	});
}
