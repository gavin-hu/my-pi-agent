/**
 * Model-facing tool registration for ask_user_question.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { UNAVAILABLE_TEXT, formatAnswerText, optionSummary, questionHeaders, unavailableResult } from "./answers.ts";
import { askViaDialogs, type QuestionUI } from "./dialogs.ts";
import { AskUserQuestionParams, normalizeQuestions, type AskUserQuestionArgs } from "./schema.ts";
import { askViaTui } from "./tui.ts";
import type { AskResult } from "./types.ts";

export const TOOL_NAME = "ask_user_question";

function dialogUI(ctx: ExtensionContext): QuestionUI {
	const ui = ctx.ui;
	return {
		select: (title, options, opts) => ui.select(title, options, opts),
		input: (title, placeholder, opts) => ui.input(title, placeholder, opts),
		editor: (title, prefill) => ui.editor(title, prefill),
	};
}

export function registerTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Ask user",
		description:
			"Ask the user one or more questions and wait for their answer. Use it when a decision genuinely needs the " +
			"user's input before you continue — a preference, a missing requirement, or a choice between approaches — " +
			"instead of guessing. Each question offers up to four labelled options plus a free-form 'Other' answer; a " +
			"question with no options asks for free-form text. Prefer this over asking in prose when the answer is a " +
			"choice, and keep questions to what you cannot infer from the code or the conversation.",
		promptSnippet: "Ask the user a structured question with options and wait for the answer.",
		promptGuidelines: [
			"Use ask_user_question when a decision needs the user's input; do not guess and continue.",
			"Ask the minimum number of questions needed, and make each option a concrete, distinct choice.",
		],
		parameters: AskUserQuestionParams,
		exposure: "model-only",
		defaultActive: false,
		annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions = normalizeQuestions((params as AskUserQuestionArgs).questions);

			let result: AskResult;
			if (ctx.mode === "tui") {
				result = await withRailsSuppressed(pi, () => askViaTui(ctx, questions, signal));
			} else if (ctx.hasUI) {
				result = await askViaDialogs(dialogUI(ctx), questions, signal);
			} else {
				result = unavailableResult(questions);
			}

			return {
				content: [{ type: "text", text: formatAnswerText(result) }],
				details: result,
				isError: result.unavailable === true,
			};
		},

		renderCall(args, theme, context) {
			const raw = (args as Partial<AskUserQuestionArgs>).questions ?? [];
			const count = raw.length;
			const noun = count === 1 ? "question" : "questions";
			const headers = questionHeaders(raw);
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("muted", `${count} ${noun}`);
			if (headers.length > 0) text += theme.fg("dim", ` (${headers.join(", ")})`);

			// One indented line per question that offers options, so a long option list
			// stays mapped to its question instead of wrapping on a single row.
			for (const line of optionSummary(raw)) text += `\n${theme.fg("dim", `  ${line}`)}`;

			const component = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			component.setText(text);
			return component;
		},

		renderResult(result, _options, theme, context) {
			const component = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as AskResult | undefined;
			if (!details) {
				const first = result.content[0];
				component.setText(first?.type === "text" ? first.text : "");
				return component;
			}
			if (details.unavailable) {
				component.setText(theme.fg("dim", UNAVAILABLE_TEXT));
				return component;
			}
			if (details.answers.length === 0) {
				component.setText(theme.fg("warning", "Cancelled"));
				return component;
			}

			const lines = details.answers.map((answer) => {
				const header = theme.fg("accent", answer.header);
				if (answer.wasCustom) {
					return `${theme.fg("success", "✓ ")}${header}: ${theme.fg("muted", "(wrote) ")}${answer.values.join("; ")}`;
				}
				const numbered = answer.labels.map((label, i) => `${answer.indices?.[i] ?? "?"}. ${label}`).join(", ");
				return `${theme.fg("success", "✓ ")}${header}: ${numbered}`;
			});
			if (details.cancelled) lines.push(theme.fg("warning", "(cancelled)"));
			component.setText(lines.join("\n"));
			return component;
		},
	});
}
