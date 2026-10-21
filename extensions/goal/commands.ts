/**
 * Slash commands for the goal extension.
 *
 * `/goal <prompt>` runs the understanding loop: the model restates the goal as
 * it understands it, the command asks any questions the model needs answered,
 * and the user confirms or corrects the restatement — folding an answer into it
 * where the model's questions left a gap — before the goal is recorded and the
 * run starts. Because the command does not produce a tool result, every goal it
 * sets is persisted as a `goal` custom entry (`pi.appendEntry`) so it follows
 * the session branch.
 *
 * `/goal raw <prompt>` skips the loop and records the typed words verbatim.
 * `/goal set [<prompt>]` and `/goal edit [<prompt>]` run the loop but record
 * without starting a run. The argument grammar is parsed by {@link parseGoalCommand}.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPursuedGoal } from "../../lib/goal-state.ts";
import { prepareGoalPrompt } from "./clarify.ts";
import { formatGoalNotice, formatGoalText, GOAL_HELP } from "./format.ts";
import { goalPhase } from "./plan-route.ts";
import type { GoalRuntime } from "./runtime.ts";
import { normalizeGoal } from "./schema.ts";
import { openTodoCount } from "./state.ts";
import { GOAL_ENTRY_TYPE, type Goal } from "./types.ts";

/** Title of the record-only edit dialog, spelling out both exits. */
const EDIT_TITLE = "Goal — Enter to save, Esc to cancel";

/**
 * One reserved `/goal` verb: the word, what a bare occurrence means, and whether
 * it takes the rest of the line as its argument.
 */
type GoalVerb =
	| { word: string; kind: "usage" | "clear" | "done"; argument: "none" }
	| { word: string; kind: "raw"; argument: "required" }
	| { word: string; kind: "record"; argument: "required" | "optional" };

/**
 * The single list behind the parser, the completions, and the help text, so a
 * new verb cannot land in one of them and be missing from another.
 * `set`/`edit` share the `record` kind; the two words are interchangeable.
 */
export const GOAL_VERBS: readonly GoalVerb[] = [
	{ word: "set", kind: "record", argument: "optional" },
	{ word: "edit", kind: "record", argument: "optional" },
	{ word: "raw", kind: "raw", argument: "required" },
	{ word: "clear", kind: "clear", argument: "none" },
	{ word: "done", kind: "done", argument: "none" },
	{ word: "achieved", kind: "done", argument: "none" },
	{ word: "help", kind: "usage", argument: "none" },
	{ word: "-h", kind: "usage", argument: "none" },
	{ word: "--help", kind: "usage", argument: "none" },
];

/** Completion values: a verb that takes an argument completes with a space. */
const GOAL_COMPLETIONS = GOAL_VERBS.map((verb) => ({
	value: verb.argument === "none" ? verb.word : `${verb.word} `,
	label: verb.word,
}));

/** One parsed `/goal` invocation. */
export type GoalCommand =
	| { kind: "show" } // no argument: show the goal, or the usage
	| { kind: "usage" } // help, or `raw` with no text
	| { kind: "clear" }
	| { kind: "done" }
	| { kind: "editor" } // bare set/edit: edit the current goal
	| { kind: "record"; text: string } // set/edit <text>: comprehend, record only
	| { kind: "raw"; text: string } // raw <text>: record verbatim and run
	| { kind: "prompt"; text: string }; // free-form: comprehend, record, and run

/**
 * Parse `/goal`'s argument into one command.
 *
 * Only the first word is looked up, so a keyword matches a whole word: `setfoo`
 * and `edit-foo` are free-form prompts, not malformed keywords, and a verb that
 * takes no argument leaves the whole line a prompt (`clear the cache`). Anything
 * unlisted is a prompt.
 */
export function parseGoalCommand(input: string): GoalCommand {
	const text = input.trim();
	if (!text) return { kind: "show" };

	const head = text.split(/\s+/, 1)[0] ?? "";
	const rest = text.slice(head.length).trim();
	const verb = GOAL_VERBS.find((candidate) => candidate.word === head.toLowerCase());
	if (!verb) return { kind: "prompt", text };
	if (verb.argument === "none") return rest ? { kind: "prompt", text } : { kind: verb.kind };
	if (verb.kind === "raw") return rest ? { kind: "raw", text: rest } : { kind: "usage" };
	return rest ? { kind: "record", text: rest } : { kind: "editor" };
}

/**
 * Complete the leading keyword only. `/goal <prompt>` is free-form, so a prefix
 * that matches no keyword yields nothing rather than a misleading suggestion;
 * once the prefix contains a space (or the start of the prompt does not look
 * like a keyword) the argument is left to the user.
 */
export function completeGoalArg(prefix: string): Array<{ value: string; label: string }> | null {
	const text = prefix.trimStart();
	if (text.includes(" ")) return null;
	// The parser lowercases the first word, so a completion must too: `/goal S`
	// has to offer `set` rather than nothing.
	const lower = text.toLowerCase();
	const items = GOAL_COMPLETIONS.filter((item) => item.label.startsWith(lower));
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
			const command = parseGoalCommand(args);

			if (command.kind === "show") {
				const goal = runtime.getGoal();
				ctx.ui.notify(goal ? formatGoalNotice(goal) : GOAL_HELP, "info");
				return;
			}
			if (command.kind === "usage") {
				ctx.ui.notify(GOAL_HELP, "info");
				return;
			}
			if (command.kind === "clear") {
				if (!runtime.getGoal()) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}
				runtime.setGoal(null, ctx);
				persist(null);
				ctx.ui.notify("Goal cleared.", "info");
				return;
			}
			if (command.kind === "done") {
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
				// The same text the tool returns, so completing the *what* points at the
				// list's open *how* on both paths.
				ctx.ui.notify(formatGoalText(achieved, openTodoCount(ctx.sessionManager.getBranch())), "info");
				return;
			}

			const setGoal = async (goal: Goal, run: boolean): Promise<void> => {
				// The phase is decided before the write, so the recorded status is the one
				// the user just chose (and never claims a plan mode that was declined).
				const status = await goalPhase(pi, ctx, runtime.getGoal(), { ask: run });
				const recorded: Goal = { objective: goal.objective, status };
				runtime.setGoal(recorded, ctx);
				persist(recorded);
				ctx.ui.notify(formatGoalNotice(recorded), "info");
				if (!run) return;
				// Set the goal before the turn so the reminder it injects carries it.
				// `expandPromptTemplates` stays off: the goal is literal text.
				if (ctx.isIdle()) await pi.sendUserMessage(goal.objective);
				else await pi.sendUserMessage(goal.objective, { deliverAs: "followUp" });
			};

			try {
				// A bare `set`/`edit` has no prompt to comprehend: edit the current goal
				// directly. Without a dialog UI there is nothing to open.
				if (command.kind === "editor") {
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

				// Only the free-form `/goal <prompt>` and `/goal raw <prompt>` need the
				// guard: an explicit `set`/`edit <text>` is already an instruction to
				// replace. The `goal` tool keeps its silent replacement so the model can
				// refine.
				const current = runtime.getGoal();
				if (command.kind !== "record" && current && isPursuedGoal(current) && ctx.hasUI) {
					const replace = await ctx.ui.confirm("Replace the active goal?", current.objective);
					if (!replace) {
						ctx.ui.notify("Goal unchanged.", "info");
						return;
					}
				}

				const typed = normalizeGoal({ objective: command.text, status: "active" });
				if (typed === null) {
					ctx.ui.notify("No goal set.", "info");
					return;
				}

				// `/goal raw`: the user already knows what they want; record it as-is.
				if (command.kind === "raw") {
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

				await setGoal(goal, command.kind === "prompt");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Goal not set: ${message}`, "warning");
			}
		},
	});
}
