/**
 * Dialog fallback for hosts that can forward `select`/`input`/`editor` but not
 * custom terminal components (RPC clients, for example).
 *
 * The driver depends on `QuestionUI`, not on `ctx`, so it is testable with a
 * fake and reusable by any host.
 */

import { OTHER_LABEL, cancelledResult, completedResult } from "./answers.ts";
import type { Answer, AskResult, Question, Selection } from "./types.ts";

export interface QuestionUI {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
}

const MULTI_INSTRUCTIONS = "Enter one or more option numbers or labels, separated by commas.";

/** Parse a multi-select editor value into a selection, or undefined when empty. */
export function parseMultiSelect(question: Question, text: string): Selection | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;

	const tokens = trimmed
		.split(/[,\n]/)
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) return undefined;

	const values: string[] = [];
	const labels: string[] = [];
	const indices: number[] = [];
	let allOptions = true;
	for (const token of tokens) {
		const asNumber = Number.parseInt(token, 10);
		let index = -1;
		if (String(asNumber) === token && asNumber >= 1 && asNumber <= question.options.length) {
			index = asNumber - 1;
		} else {
			index = question.options.findIndex((option) => option.label.toLowerCase() === token.toLowerCase());
		}
		if (index < 0) {
			allOptions = false;
			break;
		}
		if (!indices.includes(index + 1)) {
			indices.push(index + 1);
			values.push(question.options[index].label);
			labels.push(question.options[index].label);
		}
	}

	// A value that does not resolve cleanly is treated as free-form text.
	if (!allOptions || indices.length === 0) return { type: "custom", text: trimmed };
	return { type: "options", values, labels, indices };
}

/** Ask every question through forwarded dialogs, stopping on cancel or abort. */
export async function askViaDialogs(ui: QuestionUI, questions: Question[], signal?: AbortSignal): Promise<AskResult> {
	const selections = new Map<string, Selection>();
	const opts = { signal };

	for (const question of questions) {
		if (question.options.length === 0) {
			const text = await ui.input(question.question, undefined, opts);
			if (text === undefined) return cancelledResult(questions, collectPartial(questions, selections));
			const trimmed = text.trim();
			if (trimmed) selections.set(question.id, { type: "custom", text: trimmed });
			continue;
		}

		if (question.multiSelect) {
			const numbered = question.options.map((option, i) => `${i + 1}. ${option.label}`).join("\n");
			const answer = await ui.editor(`${question.question}\n\n${numbered}\n\n${MULTI_INSTRUCTIONS}`, "");
			if (answer === undefined) return cancelledResult(questions, collectPartial(questions, selections));
			const selection = parseMultiSelect(question, answer);
			if (!selection) return cancelledResult(questions, collectPartial(questions, selections));
			selections.set(question.id, selection);
			continue;
		}

		const labels = question.options.map((option) => option.label);
		const choice = await ui.select(question.question, [...labels, OTHER_LABEL], opts);
		if (choice === undefined) return cancelledResult(questions, collectPartial(questions, selections));
		if (choice === OTHER_LABEL) {
			const text = await ui.input(question.question, undefined, opts);
			if (text === undefined) return cancelledResult(questions, collectPartial(questions, selections));
			const trimmed = text.trim();
			if (trimmed) selections.set(question.id, { type: "custom", text: trimmed });
			continue;
		}
		const index = question.options.findIndex((option) => option.label === choice);
		if (index >= 0) {
			selections.set(question.id, {
				type: "options",
				values: [choice],
				labels: [choice],
				indices: [index + 1],
			});
		}
	}

	return completedResult(questions, selections);
}

function collectPartial(questions: Question[], selections: Map<string, Selection>): Answer[] {
	return completedResult(questions, selections).answers;
}
