/**
 * Reply parsing for the goal clarify step (pure).
 *
 * The clarifier is a model, so its answer is untrusted input: this module
 * extracts the JSON object, validates every field, and routes each string
 * through `sanitizeLine` before it can reach a dialog or the terminal. A reply
 * with no JSON object is treated as a plain restatement of the goal, so a model
 * that ignores the JSON instruction still yields an understanding.
 *
 * The limits are goal's own: at most {@link MAX_QUESTIONS} questions, each with
 * an optional small set of labelled options. They are not tied to any other
 * extension.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { MAX_OBJECTIVE } from "./schema.ts";

/** Most clarifying questions kept from one clarifier reply. */
export const MAX_QUESTIONS = 3;
/** Fewest options for a question to be a choice; fewer becomes free-form. */
export const MIN_OPTIONS = 2;
/** Most options kept per question. */
export const MAX_OPTIONS = 4;

/** One selectable answer the clarifier proposes. */
export interface ClarifyOption {
	label: string;
}

/** One clarifying question the clarifier proposes. */
export interface ClarifyQuestion {
	question: string;
	options: ClarifyOption[];
}

/** One answer the user gave to a clarifying question. */
export interface ClarifyAnswer {
	question: string;
	answer: string;
}

/** The clarifier's parsed reply: its understanding of the user's goal. */
export interface Clarification {
	/** True when the goal is understood well enough to record without questions. */
	understood: boolean;
	/** One-sentence restatement of the goal, in the user's terms, or `""`. */
	goal: string;
	/** Questions to ask, already clamped and sanitized. Empty when `understood`. */
	questions: ClarifyQuestion[];
}

/** Quote characters a model may wrap its reply in. */
const WRAPPING_QUOTES = /^["'`\u2018\u2019\u201c\u201d]+|["'`\u2018\u2019\u201c\u201d]+$/g;

/** A leading `Goal:` / `Objective -` label, which the goal itself does not need. */
const LEADING_LABEL = /^(?:goal|objective)\s*[:\-]\s*/i;

/** Remove one layer of wrapping quotes/labels from an already-trimmed reply. */
function stripDecoration(text: string): string {
	return text.replace(WRAPPING_QUOTES, "").trim().replace(LEADING_LABEL, "").replace(WRAPPING_QUOTES, "").trim();
}

/** Sanitize one objective to a single line, or `""` when empty or over the limit. */
function toObjective(text: string): string {
	const objective = sanitizeLine(stripDecoration(text));
	return objective.length > MAX_OBJECTIVE ? "" : objective;
}

/**
 * Turn a plain-text reply into a goal objective, or `undefined` when it is
 * unusable. A fenced block is unwrapped, a leading label and wrapping quotes are
 * dropped, and the result is sanitized to one line.
 */
function parsePlainGoal(raw: string): string | undefined {
	const fenced = /```[^\n]*\n?([\s\S]*?)```/.exec(raw);
	return toObjective(fenced ? fenced[1] : raw) || undefined;
}

/**
 * Index of the `}` that closes the `{` at `start`, or `-1` when it never closes.
 *
 * Brace depth is tracked outside JSON strings, so a `}` inside a value cannot end
 * the scan early and trailing prose cannot widen it.
 */
function matchingBrace(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * The first complete `{...}` object in `text`.
 *
 * A parseable object makes `found` true. When the braces do not form one, a
 * reply that opens with `{` was trying to be JSON and is unusable (`found`
 * true); anything else is prose, so the caller falls back to plain text. This
 * keeps an incidental brace in a restatement from discarding it.
 */
function extractJsonObject(text: string): { found: boolean; value?: unknown } {
	const unfenced = text.replace(/```/g, "").trim();
	const start = unfenced.indexOf("{");
	if (start === -1) return { found: false };
	const end = matchingBrace(unfenced, start);
	if (end !== -1) {
		try {
			const value = JSON.parse(unfenced.slice(start, end + 1));
			if (value && typeof value === "object" && !Array.isArray(value)) return { found: true, value };
		} catch {
			// Fall through: unparseable braces.
		}
	}
	return { found: start === 0 };
}

/** A single-line, control-character-free string, or `""`. */
function clean(value: unknown): string {
	return typeof value === "string" ? sanitizeLine(value) : "";
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
		options.push({ label });
		if (options.length >= MAX_OPTIONS) break;
	}
	return options.length >= MIN_OPTIONS ? options : [];
}

/** One validated question, or `undefined` when it has no usable question text. */
function normalizeQuestion(raw: unknown): ClarifyQuestion | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const question = clean(record.question);
	if (!question) return undefined;
	return { question, options: normalizeOptions(record.options) };
}

/** Validated questions, capped at {@link MAX_QUESTIONS}. */
function normalizeQuestions(raw: unknown): ClarifyQuestion[] {
	if (!Array.isArray(raw)) return [];
	const questions: ClarifyQuestion[] = [];
	for (const entry of raw) {
		if (questions.length >= MAX_QUESTIONS) break;
		const question = normalizeQuestion(entry);
		if (question) questions.push(question);
	}
	return questions;
}

/**
 * Parse the clarifier's reply into a {@link Clarification}, or `undefined` when
 * there is nothing usable.
 *
 * A JSON object with a boolean `understood` drives the result; when `understood`
 * is false the questions are clamped and sanitized. A reply with no JSON object
 * is treated as a plain restatement (`understood`). When no question survives,
 * the reply is understood.
 */
export function parseClarification(raw: string | undefined): Clarification | undefined {
	if (typeof raw !== "string") return undefined;
	const { found, value } = extractJsonObject(raw);
	if (found) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			if (typeof record.understood === "boolean") {
				const goal = toObjective(clean(record.goal));
				const questions = record.understood ? [] : normalizeQuestions(record.questions);
				const understood = record.understood || questions.length === 0;
				return { understood, goal, questions: understood ? [] : questions };
			}
		}
		// Braces were present but yielded no usable clarification.
		return undefined;
	}
	const goal = parsePlainGoal(raw);
	return goal === undefined ? undefined : { understood: true, goal, questions: [] };
}
