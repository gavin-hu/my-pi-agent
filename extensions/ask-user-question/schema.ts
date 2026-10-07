/**
 * Parameter schema and validation for ask_user_question.
 *
 * Everything here is pure: no host APIs, no terminal, no model calls. The
 * limits are enforced before a UI driver runs so an invalid call fails fast
 * with a message the model can act on.
 */

import { Type, type Static } from "typebox";
import type { Question, RawOption, RawQuestion } from "./types.ts";

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
/** Maximum visible width of a tab header. */
export const HEADER_MAX_WIDTH = 12;

const OptionSchema = Type.Object({
	label: Type.String({ description: "Text shown to the user and returned as the answer" }),
	description: Type.Optional(Type.String({ description: "Optional second line explaining the option" })),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	header: Type.Optional(
		Type.String({ description: `Short label (≤ ${HEADER_MAX_WIDTH} chars) for the tab bar, e.g. "Auth"` }),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			minItems: MIN_OPTIONS,
			maxItems: MAX_OPTIONS,
			description: `Up to ${MAX_OPTIONS} choices. Omit to ask for free-form text.`,
		}),
	),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Allow selecting several options at once (default false)" }),
	),
});

export const AskUserQuestionParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: MAX_QUESTIONS,
		description: "One to four questions to ask in one pass",
	}),
});

export type AskUserQuestionArgs = Static<typeof AskUserQuestionParams>;

/** Clip a header to `HEADER_MAX_WIDTH` display columns (counts code points). */
function normalizeHeader(raw: unknown, index: number): string {
	const trimmed = typeof raw === "string" ? raw.trim() : "";
	if (!trimmed) return `Q${index + 1}`;
	return Array.from(trimmed).slice(0, HEADER_MAX_WIDTH).join("") || `Q${index + 1}`;
}

function normalizeOptions(raw: unknown, index: number): RawOption[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error(`Question ${index + 1}: options must be an array.`);
	if (raw.length === 0) return [];
	if (raw.length < MIN_OPTIONS) {
		throw new Error(
			`Question ${index + 1}: provide at least ${MIN_OPTIONS} options, or no options at all for free-form text.`,
		);
	}
	if (raw.length > MAX_OPTIONS) {
		throw new Error(`Question ${index + 1}: at most ${MAX_OPTIONS} options are allowed.`);
	}

	const options: RawOption[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const option = (entry ?? {}) as Partial<RawOption>;
		const label = typeof option.label === "string" ? option.label.trim() : "";
		if (!label) throw new Error(`Question ${index + 1}: every option needs a label.`);
		const key = label.toLowerCase();
		if (seen.has(key)) throw new Error(`Question ${index + 1}: duplicate option "${label}".`);
		seen.add(key);
		const description =
			typeof option.description === "string" && option.description.trim() ? option.description.trim() : undefined;
		options.push(description ? { label, description } : { label });
	}
	return options;
}

/**
 * Validate and normalize the model's questions.
 *
 * Throws an `Error` with a model-readable message; the tool turns that into a
 * failed result so the model can retry with a corrected call.
 */
export function normalizeQuestions(raw: unknown): Question[] {
	const list = Array.isArray(raw) ? (raw as unknown[]) : [];
	if (list.length === 0) throw new Error("At least one question is required.");
	if (list.length > MAX_QUESTIONS) throw new Error(`At most ${MAX_QUESTIONS} questions are allowed per call.`);

	const questions: Question[] = [];
	const seenHeaders = new Set<string>();

	for (let i = 0; i < list.length; i++) {
		const item = (list[i] ?? {}) as Partial<RawQuestion>;
		const text = typeof item.question === "string" ? item.question.trim() : "";
		if (!text) throw new Error(`Question ${i + 1} is missing its question text.`);

		const options = normalizeOptions(item.options, i);
		const header = normalizeHeader(item.header, i);
		const key = header.toLowerCase();
		if (seenHeaders.has(key)) throw new Error(`Duplicate header "${header}"; headers must be unique.`);
		seenHeaders.add(key);

		questions.push({
			id: `q${i + 1}`,
			header,
			question: text,
			options,
			allowOther: options.length > 0,
			multiSelect: item.multiSelect === true,
		});
	}
	return questions;
}
