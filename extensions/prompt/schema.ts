/**
 * Parsing and validation for the clarifier's JSON reply.
 *
 * The clarifier is a model, so its answer is untrusted input: this module
 * extracts the JSON object, validates every field, and runs each string through
 * `sanitizeLine` before it can reach a dialog or the terminal. Anything that
 * does not fit is dropped rather than failing the whole refinement.
 */

import { sanitizeLine } from "../../lib/format.ts";

/** Maximum display width of a question header. */
export const HEADER_MAX_WIDTH = 12;
/** Fewest options a question needs to be asked as a choice; fewer becomes free-form. */
export const MIN_OPTIONS = 2;
/** Most options kept per question. */
export const MAX_OPTIONS = 4;
/** Longest goal kept, in characters. */
export const GOAL_MAX_CHARS = 500;

export interface ClarifyOption {
	label: string;
	description?: string;
}

export interface ClarifyQuestion {
	header: string;
	question: string;
	options: ClarifyOption[];
}

/** The clarifier's parsed reply. */
export interface Clarification {
	/** True when the request is specific enough to act on without questions. */
	clear: boolean;
	/** One-sentence statement of the goal the clarifier believes the user wants. */
	goal: string;
	/** Questions to ask, already clamped and sanitized. Empty when `clear`. */
	questions: ClarifyQuestion[];
}

/** One answered question, carried into the transformed prompt. */
export interface Answer {
	header: string;
	question: string;
	answer: string;
}

/** A single-line, control-character-free string, or `""`. */
function clean(value: unknown): string {
	return typeof value === "string" ? sanitizeLine(value) : "";
}

/** Clip to `max` code points. */
function clip(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join("");
}

/**
 * The first `{...}` object in `text`, parsed; `undefined` when there is none.
 *
 * Code fences are stripped first, because models wrap JSON in them often enough
 * to matter.
 */
function extractJsonObject(text: string): unknown {
	const unfenced = text.replace(/```/g, "");
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(unfenced.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

/** Sanitized options, deduplicated and capped; a lone option becomes free-form. */
function normalizeOptions(raw: unknown): ClarifyOption[] {
	if (!Array.isArray(raw)) return [];
	const options: ClarifyOption[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const label = clean(record.label);
		if (!label) continue;
		const key = label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const description = clean(record.description);
		options.push(description ? { label, description } : { label });
		if (options.length >= MAX_OPTIONS) break;
	}
	return options.length >= MIN_OPTIONS ? options : [];
}

/** One validated question, or `undefined` when it has no usable text. */
function normalizeQuestion(raw: unknown, index: number): ClarifyQuestion | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const question = clean(record.question);
	if (!question) return undefined;
	const header = clip(clean(record.header), HEADER_MAX_WIDTH) || `Q${index + 1}`;
	return { header, question, options: normalizeOptions(record.options) };
}

/**
 * Parse the clarifier's reply.
 *
 * Returns `undefined` when there is no JSON object at all; otherwise a
 * best-effort value with invalid questions dropped. A `clear: true` reply never
 * carries questions.
 */
export function parseClarification(text: string, maxQuestions: number): Clarification | undefined {
	const parsed = extractJsonObject(typeof text === "string" ? text : "");
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

	const record = parsed as Record<string, unknown>;
	const clear = record.clear === true;
	const goal = clip(clean(record.goal), GOAL_MAX_CHARS);
	const limit = Math.max(0, Math.floor(maxQuestions));

	const questions: ClarifyQuestion[] = [];
	const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
	for (let i = 0; i < rawQuestions.length && questions.length < limit; i++) {
		const question = normalizeQuestion(rawQuestions[i], i);
		if (question) questions.push(question);
	}

	return { clear, goal, questions: clear ? [] : questions };
}
