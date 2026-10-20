/**
 * Answer normalization and model-facing formatting (pure).
 */

import { lineOf, sanitizeLine } from "../../lib/format.ts";
import type { Answer, AskResult, Question, Selection } from "./types.ts";

export const CANCELLED_TEXT = "User cancelled the question.";
export const UNAVAILABLE_TEXT = "No interactive UI available; ask the user in your reply instead.";
/**
 * Label of the automatic free-form entry appended to every option list. The
 * canonical value lives in `lib/interaction.ts` so a remote channel can recognize
 * it without importing this extension.
 */
export { INTERACTION_OTHER_LABEL as OTHER_LABEL } from "../../lib/interaction.ts";

/** Build one `Answer` from a driver's `Selection`. */
export function buildAnswer(question: Question, selection: Selection): Answer {
	if (selection.type === "custom") {
		return {
			id: question.id,
			header: question.header,
			question: question.question,
			values: [selection.text],
			labels: [selection.text],
			wasCustom: true,
		};
	}
	return {
		id: question.id,
		header: question.header,
		question: question.question,
		values: [...selection.values],
		labels: [...selection.labels],
		wasCustom: false,
		indices: [...selection.indices],
	};
}

/** Answers for the questions that have a selection, in question order. */
export function collectAnswers(questions: Question[], selections: Map<string, Selection>): Answer[] {
	const answers: Answer[] = [];
	for (const question of questions) {
		const selection = selections.get(question.id);
		if (selection) answers.push(buildAnswer(question, selection));
	}
	return answers;
}

/** A completed (non-cancelled) result. */
export function completedResult(questions: Question[], selections: Map<string, Selection>): AskResult {
	return { questions, answers: collectAnswers(questions, selections), cancelled: false };
}

/** A cancelled result, optionally carrying answers gathered before the cancel. */
export function cancelledResult(questions: Question[], answers: Answer[] = []): AskResult {
	return { questions, answers, cancelled: true };
}

/** A result for a session with no interactive UI. */
export function unavailableResult(questions: Question[]): AskResult {
	return { questions, answers: [], cancelled: false, unavailable: true };
}

/** Format one answer as a single model-readable line. */
function formatAnswer(answer: Answer): string {
	if (answer.wasCustom) return `${answer.header}: user wrote: ${answer.values.join("; ")}`;
	const numbered = answer.labels.map((label, i) => `${answer.indices?.[i] ?? "?"}. ${label}`);
	return `${answer.header}: user selected: ${numbered.join(", ")}`;
}

/** Model-facing text for a result. */
export function formatAnswerText(result: AskResult): string {
	if (result.unavailable) return UNAVAILABLE_TEXT;
	if (result.answers.length === 0) {
		return result.cancelled ? CANCELLED_TEXT : "No answer recorded.";
	}
	const lines = result.answers.map(formatAnswer);
	if (result.cancelled) lines.push("(the remaining questions were cancelled)");
	return lines.join("\n");
}

/**
 * Minimal shape needed to summarize a call, before or after normalization.
 *
 * The transcript renderer reads this from a call's *streaming* args, where a
 * field can be missing or still be a fragment: a partial parse can hand back an
 * option before its label has arrived. Every field is therefore `unknown`, and
 * the helpers below read a non-string as absent rather than throw.
 */
export interface CallQuestion {
	header?: unknown;
	options?: unknown;
}

/** Display headers with positional defaults (`Q1`, `Q2`, …). */
export function questionHeaders(questions: CallQuestion[]): string[] {
	return questions.map((question, i) => lineOf(question?.header) || `Q${i + 1}`);
}

/** One `Header: a, b, Other` summary per question that offers options. */
export function optionSummary(questions: CallQuestion[]): string[] {
	return questions
		.map((question, i) => ({ header: lineOf(question?.header) || `Q${i + 1}`, options: question?.options }))
		.filter(({ options }) => Array.isArray(options) && options.length > 0)
		.map(({ header, options }) => {
			// A partial option has no label yet; list the ones that have arrived.
			const labels = (options as unknown[])
				.map((option) => (option as { label?: unknown } | undefined)?.label)
				.filter((label): label is string => typeof label === "string")
				.map((label) => sanitizeLine(label));
			return `${header}: ${labels.length > 0 ? `${labels.join(", ")}, Other` : "Other"}`;
		});
}

/** Human-readable summary of a selection, used in the Submit tab. */
export function describeSelection(selection: Selection | undefined): string {
	if (!selection) return "(unanswered)";
	if (selection.type === "custom") return `(wrote) ${selection.text}`;
	return selection.labels.map((label, i) => `${selection.indices[i] ?? "?"}. ${label}`).join(", ");
}
