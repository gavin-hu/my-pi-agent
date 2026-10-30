/**
 * Model-facing tool registration for ask_user_question.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askHuman, remoteLanguage } from "../../lib/interaction.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { detailsOrLine, reuseCallText, toolCallTitle } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { ASK_USER_QUESTION_TOOL } from "../../lib/tool-names.ts";
import { UNAVAILABLE_TEXT, formatAnswerText, optionSummary, questionHeaders, unavailableResult } from "./answers.ts";
import { askViaDialogs, type QuestionUI } from "./dialogs.ts";
import { AskUserQuestionParams, normalizeQuestions, type AskUserQuestionArgs } from "./schema.ts";
import type { AskResult } from "./types.ts";

export const TOOL_NAME = ASK_USER_QUESTION_TOOL;

function dialogUI(ctx: ExtensionContext): QuestionUI {
	const ui = ctx.ui;
	return {
		select: (title, options, opts) => ui.select(title, options, opts),
		input: (title, placeholder, opts) => ui.input(title, placeholder, opts),
		editor: (title, prefill) => ui.editor(title, prefill),
		language: () => remoteLanguage(ctx) ?? "en",
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
		annotations: { readOnlyHint: true, openWorldHint: false },
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
					custom: async () => {
						// The questionnaire is the TUI's: a remote or headless answer below loads
						// neither it nor the rails wrapper.
						const { askViaTui } = await import("./view/question-screen.ts");
						return withRailsSuppressed(pi, () => askViaTui(ctx, questions, signal));
					},
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
			// The args stream in: `questions` can be absent, and an option can arrive
			// before its label. Read a partial call as a smaller summary and never
			// throw — a throwing renderer makes Pi fall back to its own call line.
			const raw = (args as Partial<AskUserQuestionArgs> | undefined)?.questions;
			const questions = Array.isArray(raw) ? raw : [];
			const count = questions.length;
			const noun = count === 1 ? "question" : "questions";
			const headers = questionHeaders(questions);
			let text = toolCallTitle(theme, `${TOOL_NAME} `) + paint(theme, "meta", `${count} ${noun}`);
			if (headers.length > 0) text += paint(theme, "faint", ` (${headers.join(", ")})`);

			// One line per question that offers options, so a long option list stays
			// mapped to its question instead of wrapping on a single row. The line
			// carries no indent of its own; the tool-block frame supplies it.
			for (const line of optionSummary(questions)) text += `\n${paint(theme, "meta", line)}`;

			const component = reuseCallText(context?.lastComponent);
			component.setText(text);
			return component;
		},

		renderResult(result, options, theme, context) {
			const component = reuseText(context?.lastComponent);
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<AskResult>(result.details));
			if ("line" in outcome) {
				component.setText(outcome.line);
				return component;
			}
			const details = outcome.details;
			if (details.unavailable) {
				component.setText(paint(theme, "bad", UNAVAILABLE_TEXT));
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
