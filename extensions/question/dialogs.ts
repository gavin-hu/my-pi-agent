/**
 * Dialog fallback for hosts that can forward `select`/`input`/`editor` but not
 * custom terminal components (RPC clients, for example).
 *
 * The driver depends on `QuestionUI`, not on `ctx`, so it is testable with a
 * fake and reusable by any host.
 */

import { OTHER_LABEL, cancelledResult, collectAnswers, completedResult } from "./answers.ts";
import type { Answer, AskResult, Question, Selection } from "./types.ts";

export interface QuestionUI {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
	/** Prompt language, when the host knows it. */
	language?(): "zh" | "en";
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

/** The one-message prompt for a multi-question ask. */
export function batchPrompt(questions: Question[], language: "zh" | "en" = "en"): string {
	const zh = language === "zh";
	const lines = [zh ? "请一次性回答所有问题：" : "Answer all questions in one message:", ""];
	questions.forEach((question, index) => {
		lines.push(`${index + 1}. ${question.question}`);
		if (question.options.length === 0) {
			lines.push(zh ? "   文字" : "   text");
			return;
		}
		const options = question.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}`).join("  ");
		lines.push(`   ${options}${question.multiSelect ? (zh ? "（可多选）" : " (multi)") : ""}`);
	});
	lines.push("", zh ? "格式：1: 2；2: A, B；3: 文字" : "Format: 1: 2; 2: A, B; 3: text");
	return lines.join("\n");
}

/**
 * Parse one batch reply. Each line/semicolon chunk starts with the question
 * number; a chunk with no prefix makes the whole reply ambiguous.
 */
export function parseBatchAnswers(questions: Question[], text: string): Map<string, Selection> | undefined {
	const entries = new Map<number, string>();
	for (const chunk of text.split(/[\n;]+/)) {
		const match = /^\s*(\d+)\s*[:.)-]\s*(.*)$/.exec(chunk);
		if (!match) {
			if (chunk.trim() !== "") return undefined;
			continue;
		}
		const index = Number.parseInt(match[1] ?? "", 10);
		if (index < 1 || index > questions.length) return undefined;
		entries.set(index, (match[2] ?? "").trim());
	}
	const selections = new Map<string, Selection>();
	for (const [index, question] of questions.entries()) {
		const raw = entries.get(index + 1);
		if (raw === undefined || raw === "") return undefined;
		if (question.options.length === 0) {
			selections.set(question.id, { type: "custom", text: raw });
			continue;
		}
		if (question.multiSelect) {
			const selection = parseMultiSelect(question, raw);
			if (!selection) return undefined;
			selections.set(question.id, selection);
			continue;
		}
		const asNumber = Number.parseInt(raw, 10);
		const optionIndex =
			String(asNumber) === raw && asNumber >= 1 && asNumber <= question.options.length
				? asNumber - 1
				: question.options.findIndex((option) => option.label.toLowerCase() === raw.toLowerCase());
		if (optionIndex >= 0) {
			const option = question.options[optionIndex];
			if (!option) return undefined;
			selections.set(question.id, {
				type: "options",
				values: [option.label],
				labels: [option.label],
				indices: [optionIndex + 1],
			});
			continue;
		}
		if (!question.allowOther) return undefined;
		selections.set(question.id, { type: "custom", text: raw });
	}
	return selections;
}

/** One batch editor, with one retry only when the format was not understood. */
async function askViaBatch(ui: QuestionUI, questions: Question[], signal?: AbortSignal): Promise<AskResult> {
	const language = ui.language?.() ?? "en";
	const prompt = batchPrompt(questions, language);
	const first = await ui.editor(prompt, "");
	if (first === undefined) return cancelledResult(questions);
	const parsed = parseBatchAnswers(questions, first);
	if (parsed) return completedResult(questions, parsed);
	if (signal?.aborted) return cancelledResult(questions);
	const retry = await ui.editor(
		`${prompt}\n\n${language === "zh" ? "格式不对，请按“1: 答案”重发。" : "Please reply again as “1: answer”."}`,
		"",
	);
	if (retry === undefined) return cancelledResult(questions);
	const again = parseBatchAnswers(questions, retry);
	return again ? completedResult(questions, again) : cancelledResult(questions, collectAnswers(questions, new Map()));
}

/** Ask every question through forwarded dialogs, stopping on cancel or abort. */
export async function askViaDialogs(ui: QuestionUI, questions: Question[], signal?: AbortSignal): Promise<AskResult> {
	if (questions.length > 1) return askViaBatch(ui, questions, signal);
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
