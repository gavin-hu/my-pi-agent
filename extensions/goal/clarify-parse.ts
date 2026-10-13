/**
 * Reply parsing for the goal clarify step (pure).
 *
 * The clarifier is a model, so its answer is untrusted input: this module
 * extracts the JSON object, validates every field, and routes each string
 * through `sanitizeLine` before it can reach a dialog or the terminal. A reply
 * with no JSON object is treated as a plain refined goal, so a model that
 * ignores the JSON instruction still refines.
 *
 * The question limits mirror `extensions/ask-user-question/schema.ts`, which
 * validates the same shape when the agent calls `ask_user_question`; extensions
 * cannot import each other, so the two are kept aligned by a compatibility test.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { MAX_OBJECTIVE } from "./schema.ts";

/** Most clarifying questions kept from one clarifier reply. */
export const MAX_QUESTIONS = 3;
/** Maximum display width of a question header. */
export const HEADER_MAX_WIDTH = 12;
/** Fewest options for a question to be a choice; fewer becomes free-form. */
export const MIN_OPTIONS = 2;
/** Most options kept per question. */
export const MAX_OPTIONS = 4;

/** One selectable answer the clarifier proposes. */
export interface ClarifyOption {
	label: string;
	description?: string;
}

/** One clarifying question the clarifier proposes. */
export interface ClarifyQuestion {
	header: string;
	question: string;
	options: ClarifyOption[];
}

/** The clarifier's parsed reply. */
export interface Clarification {
	/** True when the goal is specific enough to record without questions. */
	clear: boolean;
	/** One-sentence statement of the goal the clarifier believes the user wants, or `""`. */
	goal: string;
	/** Questions to ask, already clamped and sanitized. Empty when `clear`. */
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
 * The first `{...}` object in `text`.
 *
 * `found` is true whenever braces are present, so the caller can tell "no JSON
 * at all" (fall back to plain text) from "JSON that did not parse" (unusable).
 */
function extractJsonObject(text: string): { found: boolean; value?: unknown } {
	const unfenced = text.replace(/```/g, "");
	const start = unfenced.indexOf("{");
	if (start === -1) return { found: false };
	const end = unfenced.lastIndexOf("}");
	if (end <= start) return { found: true };
	try {
		return { found: true, value: JSON.parse(unfenced.slice(start, end + 1)) };
	} catch {
		return { found: true };
	}
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

/** A header unique among `seen`, renumbering a duplicate or missing one. */
function uniqueHeader(candidate: string, index: number, seen: Set<string>): string {
	let header = candidate;
	let n = index + 1;
	while (!header || seen.has(header.toLowerCase())) {
		header = `Q${n}`;
		n += 1;
	}
	seen.add(header.toLowerCase());
	return header;
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

/** One validated question, or `undefined` when it has no usable question text. */
function normalizeQuestion(raw: unknown, index: number, seenHeaders: Set<string>): ClarifyQuestion | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const question = clean(record.question);
	if (!question) return undefined;
	const candidate = clip(clean(record.header), HEADER_MAX_WIDTH).trim();
	return { header: uniqueHeader(candidate, index, seenHeaders), question, options: normalizeOptions(record.options) };
}

/** Validated questions, capped at {@link MAX_QUESTIONS}. */
function normalizeQuestions(raw: unknown): ClarifyQuestion[] {
	if (!Array.isArray(raw)) return [];
	const questions: ClarifyQuestion[] = [];
	const seenHeaders = new Set<string>();
	for (const entry of raw) {
		if (questions.length >= MAX_QUESTIONS) break;
		const question = normalizeQuestion(entry, questions.length, seenHeaders);
		if (question) questions.push(question);
	}
	return questions;
}

/**
 * Parse the clarifier's reply into a {@link Clarification}, or `undefined` when
 * there is nothing usable.
 *
 * A JSON object with a boolean `clear` drives the result; when `clear` is false
 * the questions are clamped and sanitized. A reply with no JSON object is
 * treated as a plain refined goal (`clear`). When no question survives, the
 * reply is clear.
 */
export function parseClarification(raw: string | undefined): Clarification | undefined {
	if (typeof raw !== "string") return undefined;
	const { found, value } = extractJsonObject(raw);
	if (found) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			if (typeof record.clear === "boolean") {
				const goal = toObjective(clean(record.goal));
				const questions = record.clear ? [] : normalizeQuestions(record.questions);
				const clear = record.clear || questions.length === 0;
				return { clear, goal, questions: clear ? [] : questions };
			}
		}
		// Braces were present but yielded no usable clarification.
		return undefined;
	}
	const goal = parsePlainGoal(raw);
	return goal === undefined ? undefined : { clear: true, goal, questions: [] };
}
