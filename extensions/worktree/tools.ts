/**
 * The model-facing tool for the worktree extension.
 *
 * One tool with four actions, like `plan` and `board`: `enter` creates or enters an
 * isolated checkout, `exit` returns to the main checkout, `list` reports the current
 * isolation and the managed worktrees, and `prune` removes the ones nobody is
 * using. Each action refuses outside the state it applies to, and the lifecycle
 * itself belongs to `lifecycle.ts`.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { basename, relative } from "node:path";
import { Type } from "typebox";
import { messageOf } from "../../lib/errors.ts";
import { shortenPath } from "../../lib/format.ts";
import { StringEnum } from "../../lib/tool-schema.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { inlineRow } from "../../lib/tui/columns.ts";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	callLine,
	detailsOrLine,
	isTailResult,
	messageText,
	moreHint,
	reuseLines,
	TailResult,
	type TailResultInput,
	type WidthLine,
} from "../../lib/tui/tool.ts";
import {
	enterWorktree,
	enteredWorktree,
	exitWorktree,
	exitedWorktree,
	isWorktreeCancelled,
	pruneWorktreesResult,
	worktreeSnapshot,
} from "./lifecycle.ts";
import { formatWorktreeStatus, statusMarks, worktreeLabel } from "./status.ts";
import { getActive, getInactiveOverrides } from "./runtime.ts";
import type { WorktreeState } from "./state.ts";

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

/** One managed worktree as the block draws it: the facts, not the sentence the model gets. */
export interface WorktreeRow {
	/** The directory's own name: the worktree is known by it everywhere else. */
	name: string;
	/** Repository-relative, so a row spends its columns on the branch and the marks. */
	path: string;
	branch: string | null;
	/** What git said about it, from the shared vocabulary: `current`, `dirty (4)`, `merged`. */
	marks: string[];
}

/** The session's own isolation, as the `list` action reports it. */
export interface WorktreeActive {
	path: string;
	branch: string | null;
	borrowed: boolean;
}

/**
 * What each action hands its renderer.
 *
 * The transcript draws from these rather than from `content`: the text is written for the
 * model (a key/value dump, an instruction to the next session), while a block is the
 * person's line among the others.
 */
export type WorktreeDetails =
	| { action: "enter"; state: WorktreeState }
	| { action: "exit"; state: WorktreeState; removed?: boolean; handoff?: string }
	| { action: "list"; active: WorktreeActive | null; inactiveOverrides: string[]; managed: WorktreeRow[] }
	| { action: "prune"; removed: string[]; kept: string[] };

/** Rows drawn collapsed before the rest fold into a hint. */
const COLLAPSED_ROWS = 5;

/** The call line's subject: the verb, then what it acts on. */
export function worktreeSubject(args: Partial<WorktreeArgs>): string {
	switch (args.action) {
		case "enter":
			return `enter ${args.name ?? args.path ?? ""}`.trimEnd();
		case "exit":
			return args.remove === true ? "exit (remove)" : "exit";
		case "prune":
			return "prune";
		default:
			return "list";
	}
}

/**
 * One managed worktree on one line: what it is called, the branch it holds, and what is
 * wrong with it.
 *
 * `inlineRow` keeps the pair together and spends a narrow terminal's columns on the label
 * first, so the marks — the answer the row exists for — survive at 40 columns.
 */
function worktreeRow(item: WorktreeRow, width: number, theme: Theme): string {
	const head = `${paint(theme, "label", item.name)}${paint(theme, "faint", SEPARATORS.item)}${paint(theme, "meta", item.branch ?? "(detached)")}`;
	const marks = paint(theme, item.marks.includes("current") ? "accent" : "faint", item.marks.join(", "));
	return inlineRow(head, marks, width);
}

/** The list action's block: one row per managed worktree, capped when collapsed. */
function listTail(
	details: Extract<WorktreeDetails, { action: "list" }>,
	expanded: boolean,
): TailResultInput<WorktreeRow> {
	const rows = expanded ? details.managed : details.managed.slice(0, COLLAPSED_ROWS);
	return {
		kind: "list",
		rows,
		more: details.managed.length - rows.length,
		rowLine: (item, width, theme) => worktreeRow(item, width, theme),
	};
}

/**
 * The rows an `enter`, `exit` or `prune` block draws.
 *
 * One verdict row names what changed and where, and a prune lists its rows only because
 * they are the answer: which worktrees went, and which were kept with the reason git gave.
 */
function resultLines(
	details: Exclude<WorktreeDetails, { action: "list" }>,
	expanded: boolean,
	theme: Theme,
): WidthLine[] {
	const check = paint(theme, "ok", `${GLYPHS.check} `);
	if (details.action === "enter") {
		const label = details.state.branch ?? worktreeLabel(details.state);
		const where = relative(details.state.repoRoot, details.state.path) || details.state.path;
		return [
			{
				text: `${check}${paint(theme, "label", label)}${paint(theme, "faint", SEPARATORS.item)}${paint(theme, "meta", where)}`,
				clip: "middle",
			},
		];
	}
	if (details.action === "exit") {
		const fate = details.removed === true ? "removed" : "kept";
		const lines: WidthLine[] = [
			{
				text: `${check}Exited ${paint(theme, "label", worktreeLabel(details.state))}${paint(theme, "meta", `${SEPARATORS.item}${fate}`)}`,
			},
		];
		// The handoff is the next person's instruction, so it keeps its lines when there are any.
		for (const line of (details.handoff ?? "").split("\n")) {
			if (line.trim() !== "") lines.push({ text: paint(theme, "meta", line) });
		}
		return lines;
	}
	if (details.removed.length === 0 && details.kept.length === 0) {
		return [{ text: paint(theme, "meta", "Nothing to prune.") }];
	}
	const removed: WidthLine[] = details.removed.map((path) => ({
		text: `${check}${paint(theme, "label", shortenPath(path))}`,
		clip: "middle",
	}));
	const kept: WidthLine[] = details.kept.map((entry) => ({
		text: `${paint(theme, "faint", `${GLYPHS.changed} `)}${paint(theme, "meta", shortenPath(entry))}`,
		clip: "middle",
	}));
	const rows = [...removed, ...kept];
	const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
	if (shown.length === rows.length) return shown;
	return [...shown, { text: moreHint(theme, rows.length - shown.length) }];
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
				case "prune": {
					const pruned = await pruneWorktreesResult(pi, ctx);
					return {
						content: [{ type: "text", text: pruned.output }],
						details: { action: "prune", removed: pruned.removed, kept: pruned.kept },
					};
				}
				case "list": {
					const snapshot = await worktreeSnapshot(pi, ctx);
					const current = getActive();
					const root = snapshot.active?.repoRoot ?? ctx.cwd;
					return {
						content: [{ type: "text", text: formatWorktreeStatus(snapshot) }],
						details: {
							action: "list",
							active: current ? { path: current.path, branch: current.branch, borrowed: !!current.borrowed } : null,
							inactiveOverrides: getInactiveOverrides(),
							// The rows the block draws, read once here: a renderer may not shell out, and the
							// sentence above is the model's copy rather than a table to re-parse.
							managed: snapshot.managed.map((row) => ({
								name: basename(row.entry.path),
								path: relative(root, row.entry.path),
								branch: row.entry.branch ?? null,
								marks: statusMarks(row.status, snapshot.active?.path === row.entry.path),
							})),
						},
					};
				}
			}
		},

		renderCall(args, theme, context) {
			return callLine(theme, context.lastComponent, WORKTREE_TOOL, worktreeSubject(args), "middle");
		},

		renderResult(result, options, theme, context) {
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<WorktreeDetails>(result.details));
			if ("line" in outcome) {
				const text = reuseText(context.lastComponent);
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;
			if (!("action" in details)) {
				// A cancelled enter or exit: the sentence the person chose is the whole answer, in
				// the warning role because nothing failed and nothing changed.
				const text = reuseText(context.lastComponent);
				text.setText(paint(theme, "warn", messageText(result)));
				return text;
			}

			if (details.action === "list") {
				const input = listTail(details, options.expanded);
				const previous = context.lastComponent;
				if (isTailResult<WorktreeRow>(previous)) {
					previous.setInput(input, theme);
					return previous;
				}
				return new TailResult<WorktreeRow>(input, theme);
			}

			return reuseLines(context.lastComponent, resultLines(details, options.expanded, theme));
		},
	});
}
