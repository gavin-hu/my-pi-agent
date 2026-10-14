/**
 * Slash commands for the goal extension.
 *
 * `/goal <prompt>` runs the understanding loop: the model restates the goal as
 * it understands it, the command asks any questions the model needs answered,
 * the model folds the answers into the final restatement, and the user confirms
 * or corrects it before the goal is recorded and the run starts. Because the
 * command does not produce a tool result, every goal it sets is persisted as a
 * `goal` custom entry (`pi.appendEntry`) so it follows the session branch.
 *
 * `/goal raw <prompt>` skips the loop and records the typed words verbatim.
 * `/goal set [<prompt>]` and `/goal edit [<prompt>]` run the loop but record
 * without starting a run.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prepareGoalPrompt } from "./clarify.ts";
import { formatGoalNotice, GOAL_HELP } from "./format.ts";
import type { GoalRuntime } from "./runtime.ts";
import { normalizeGoal } from "./schema.ts";
import { GOAL_ENTRY_TYPE, type Goal } from "./types.ts";

/** Title of the record-only edit dialog, spelling out both exits. */
const EDIT_TITLE = "Goal — Enter to save, Esc to cancel";

/** Completion values for the goal keywords: `set`/`edit`/`raw` take an argument. */
const GOAL_COMPLETIONS = [
	{ value: "set ", label: "set" },
	{ value: "edit ", label: "edit" },
	{ value: "raw ", label: "raw" },
	{ value: "clear", label: "clear" },
	{ value: "done", label: "done" },
	{ value: "help", label: "help" },
];

/** `/goal set <text>` and `/goal edit <text>`: `text` is optional. */
const RECORD_PATTERN = /^(set|edit)(?:\s+([\s\S]*))?$/i;
/** `/goal raw <text>`: `text` is required. */
const RAW_PATTERN = /^raw(?:\s+([\s\S]*))?$/i;

/**
 * Complete the leading keyword only. `/goal <prompt>` is free-form, so a prefix
 * that matches no keyword yields nothing rather than a misleading suggestion;
 * once the prefix contains a space (or the start of the prompt does not look
 * like a keyword) the argument is left to the user.
 */
function completeGoalArg(prefix: string): Array<{ value: string; label: string }> | null {
	const text = prefix.trimStart();
	if (text.includes(" ")) return null;
	const items = GOAL_COMPLETIONS.filter((item) => item.label.startsWith(text));
	return items.length > 0 ? items : null;
}

export function registerCommands(pi: ExtensionAPI, runtime: GoalRuntime): void {
	const persist = (goal: Goal | null): void => pi.appendEntry(GOAL_ENTRY_TYPE, { goal });

	pi.registerCommand("goal", {
		description:
			"Set the session goal and start working on it, or show/record/edit/clear/complete it: " +
			"/goal [prompt | raw <prompt> | set [prompt] | edit [prompt] | clear | done | help]",
		getArgumentCompletions: completeGoalArg,
		handler: async (args, ctx) => {
			const input = args.trim();

			if (!input) {
				const goal = runtime.getGoal();
				ctx.ui.notify(goal ? formatGoalNotice(goal) : GOAL_HELP, "info");
				return;
			}

			const keyword = input.toLowerCase();
			if (keyword === "help" || keyword === "-h" || keyword === "--help") {
				ctx.ui.notify(GOAL_HELP, "info");
				return;
			}
			if (keyword === "clear") {
				if (!runtime.getGoal()) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}
				runtime.setGoal(null, ctx);
				persist(null);
				ctx.ui.notify("Goal cleared.", "info");
				return;
			}
			if (keyword === "done" || keyword === "achieved") {
				const current = runtime.getGoal();
				if (!current) {
					ctx.ui.notify("No goal set.", "warning");
					return;
				}
				if (current.status === "achieved") {
					ctx.ui.notify(`Goal already achieved: ${current.objective}`, "info");
					return;
				}
				const achieved: Goal = { objective: current.objective, status: "achieved" };
				runtime.setGoal(achieved, ctx);
				persist(achieved);
				ctx.ui.notify(`Goal achieved: ${current.objective}`, "info");
				return;
			}

			// `/goal set|edit [<text>]` records without running; `/goal raw <text>`
			// records the typed words verbatim and runs. A whole-word keyword only:
			// `setfoo` is a free-form prompt, not a malformed keyword.
			const recordMatch = RECORD_PATTERN.exec(input);
			const rawMatch = recordMatch ? null : RAW_PATTERN.exec(input);
			const recordText = (recordMatch?.[2] ?? "").trim();

			const setGoal = async (goal: Goal, run: boolean): Promise<void> => {
				runtime.setGoal(goal, ctx);
				persist(goal);
				ctx.ui.notify(`Goal set (active): ${goal.objective}`, "info");
				if (!run) return;
				// Set the goal before the turn so the reminder it injects carries it.
				// `expandPromptTemplates` stays off: the goal is literal text.
				if (ctx.isIdle()) await pi.sendUserMessage(goal.objective);
				else await pi.sendUserMessage(goal.objective, { deliverAs: "followUp" });
			};

			try {
				// A bare `set`/`edit` has no prompt to comprehend: edit the current goal
				// directly. Without a dialog UI there is nothing to open.
				if (recordMatch && !recordText) {
					if (!ctx.hasUI) {
						ctx.ui.notify(GOAL_HELP, "info");
						return;
					}
					const current = runtime.getGoal();
					const edited = await ctx.ui.editor(EDIT_TITLE, current?.objective ?? "");
					if (edited === undefined) return;
					const goal = normalizeGoal({ objective: edited, status: "active" });
					if (goal === null) {
						ctx.ui.notify("Goal not set: the prompt is empty.", "warning");
						return;
					}
					await setGoal(goal, false);
					return;
				}

				const recordOnly = recordMatch !== null;
				const prompt = rawMatch ? (rawMatch[1] ?? "").trim() : recordMatch ? recordText : input;

				// `/goal raw` with no text is a usage error.
				if (rawMatch && !prompt) {
					ctx.ui.notify(GOAL_HELP, "info");
					return;
				}

				// Only the free-form `/goal <prompt>` and `/goal raw <prompt>` need the
				// guard: an explicit `set`/`edit <text>` is already an instruction to
				// replace. The `goal` tool keeps its silent replacement so the model can
				// refine.
				const current = runtime.getGoal();
				if (!recordMatch && current?.status === "active" && ctx.hasUI) {
					const replace = await ctx.ui.confirm("Replace the active goal?", current.objective);
					if (!replace) {
						ctx.ui.notify("Goal unchanged.", "info");
						return;
					}
				}

				const typed = normalizeGoal({ objective: prompt, status: "active" });
				if (typed === null) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}

				// `/goal raw`: the user already knows what they want; record it as-is.
				if (rawMatch) {
					await setGoal(typed, true);
					return;
				}

				// Run the understanding loop, then record what the user confirmed. A
				// dismissed question or editor cancels the command; a failed
				// comprehension keeps the typed wording.
				const outcome = await prepareGoalPrompt(ctx, typed.objective);
				if (outcome.action === "cancel") return;

				const goal = normalizeGoal({ objective: outcome.text, status: "active" });
				if (goal === null) {
					// An empty editor submission is a cancel, not a clear.
					ctx.ui.notify("Goal not set: the prompt is empty.", "warning");
					return;
				}

				await setGoal(goal, !recordOnly);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Goal not set: ${message}`, "warning");
			}
		},
	});
}
