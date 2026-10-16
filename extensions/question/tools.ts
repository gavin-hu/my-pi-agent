/**
 * Model-facing tool registration for ask_user_question.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askHuman } from "../../lib/interaction.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { ASK_USER_QUESTION_TOOL } from "../../lib/tool-names.ts";
import { UNAVAILABLE_TEXT, formatAnswerText, optionSummary, questionHeaders, unavailableResult } from "./answers.ts";
import { askViaDialogs, type QuestionUI } from "./dialogs.ts";
import { AskUserQuestionParams, normalizeQuestions, type AskUserQuestionArgs } from "./schema.ts";
import { askViaTui } from "./tui.ts";
import type { AskResult } from "./types.ts";

export const TOOL_NAME = ASK_USER_QUESTION_TOOL;

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
			"Ask the user one or more questions and wait for their answer. Each question offers up to four labelled " +
			"options plus a free-form 'Other' answer, and `multiSelect` allows several selections; a question with no " +
			"options asks for free-form text.",
		promptSnippet: "Ask the user a structured question and wait for the answer.",
		promptGuidelines: [
			"Use ask_user_question when a decision needs the user's input — a preference, a missing requirement, or a choice between approaches — instead of guessing.",
			"Prefer it over prose when the answer is a choice, and ask only what you cannot infer from the code or conversation.",
			"Ask the minimum number of questions; ask independent questions in one call, and make each option concrete and distinct.",
		],
		parameters: AskUserQuestionParams,
		exposure: "model-only",
		defaultActive: false,
		annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions = normalizeQuestions((params as AskUserQuestionArgs).questions);

			let result: AskResult;
			if (!ctx.hasUI) {
				result = unavailableResult(questions);
			} else {
				// A remote-answered turn falls back to dialogs; only a local TUI turn uses
				// the full-screen questionnaire.
				result = await askHuman(ctx, {
					custom: () => withRailsSuppressed(pi, () => askViaTui(ctx, questions, signal)),
					dialogs: () => askViaDialogs(dialogUI(ctx), questions, signal),
				});
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
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + paint(theme, "meta", `${count} ${noun}`);
			if (headers.length > 0) text += paint(theme, "faint", ` (${headers.join(", ")})`);

			// One indented line per question that offers options, so a long option list
			// stays mapped to its question instead of wrapping on a single row.
			for (const line of optionSummary(raw)) text += `\n${paint(theme, "faint", `  ${line}`)}`;

			const component = reuseText(context?.lastComponent);
			component.setText(text);
			return component;
		},

		renderResult(result, _options, theme, context) {
			const component = reuseText(context?.lastComponent);
			const details = toolDetails<AskResult>(result.details);
			if (!details) {
				const first = result.content[0];
				component.setText(first?.type === "text" ? first.text : "");
				return component;
			}
			if (details.unavailable) {
				component.setText(paint(theme, "faint", UNAVAILABLE_TEXT));
				return component;
			}
			if (details.answers.length === 0) {
				component.setText(paint(theme, "warn", "Cancelled"));
				return component;
			}

			const lines = details.answers.map((answer) => {
				const header = paint(theme, "accent", sanitizeLine(answer.header));
				if (answer.wasCustom) {
					const values = answer.values.map((value) => sanitizeLine(value)).join("; ");
					return `${paint(theme, "ok", `${GLYPHS.check} `)}${header}: ${paint(theme, "meta", "(wrote) ")}${values}`;
				}
				const numbered = answer.labels
					.map((label, i) => `${answer.indices?.[i] ?? "?"}. ${sanitizeLine(label)}`)
					.join(", ");
				return `${paint(theme, "ok", `${GLYPHS.check} `)}${header}: ${numbered}`;
			});
			if (details.cancelled) lines.push(paint(theme, "warn", "(cancelled)"));
			// A blank line separates the call header from a multi-line answer body.
			component.setText(lines.length > 1 ? `\n${lines.join("\n")}` : lines.join("\n"));
			return component;
		},
	});
}
