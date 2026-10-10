/**
 * Passage search over extracted page text.
 *
 * `findPassages` returns the places a query appears, with code-point offsets
 * that line up with `web_fetch`'s `startIndex`, so a hit can be read precisely
 * with a second call. Three modes:
 *
 * - `exact`       case-sensitive substring
 * - `insensitive` case-insensitive substring (default)
 * - `fuzzy`       line candidates scored by query-term coverage
 *
 * It is heuristic, not a full-text index: it runs over the extracted text the
 * model already receives, not the raw HTML.
 */

import { toChars } from "../text.ts";

export type FindMode = "insensitive" | "exact" | "fuzzy";

export interface FindOptions {
	mode: FindMode;
	contextChars: number;
	maxMatches: number;
}

export interface Passage {
	query: string;
	/** Code-point offset of the match start. */
	offset: number;
	/** Context around the match, with `…` when clipped. */
	passage: string;
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Convert a UTF-16 string index to a code-point offset. */
export function toCodePointOffset(text: string, utf16Index: number): number {
	let offset = 0;
	for (let i = 0; i < utf16Index && i < text.length; i++) {
		const code = text.charCodeAt(i);
		// Skip a low surrogate so a pair counts once.
		if (code >= 0xdc00 && code <= 0xdfff) continue;
		offset++;
	}
	return offset;
}

function passageAround(points: string[], start: number, end: number, contextChars: number): string {
	const from = Math.max(0, start - contextChars);
	const to = Math.min(points.length, end + contextChars);
	const prefix = from > 0 ? "…" : "";
	const suffix = to < points.length ? "…" : "";
	return `${prefix}${points.slice(from, to).join("").trim()}${suffix}`;
}

function substringMatches(text: string, query: string, insensitive: boolean): Array<[number, number]> {
	const haystack = insensitive ? text.toLowerCase() : text;
	const needle = insensitive ? query.toLowerCase() : query;
	if (!needle) return [];
	const hits: Array<[number, number]> = [];
	let from = 0;
	while (hits.length < 1000) {
		const at = haystack.indexOf(needle, from);
		if (at < 0) break;
		hits.push([at, at + needle.length]);
		from = at + Math.max(1, needle.length);
	}
	return hits;
}

function tokenize(query: string): string[] {
	const terms = query.toLowerCase().split(WORD_SPLIT).filter(Boolean);
	if (terms.length === 1 && terms[0].length > 1 && CJK.test(terms[0])) return Array.from(terms[0]);
	return terms;
}

function fuzzyMatches(text: string, query: string): Array<[number, number]> {
	const terms = tokenize(query);
	if (terms.length === 0) return [];

	// Candidate windows are lines, each scored by the fraction of query terms it contains.
	const candidates: Array<{ start: number; end: number; score: number }> = [];
	let lineStart = 0;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) {
			const lowerLine = trimmed.toLowerCase();
			const matched = terms.filter((term) => lowerLine.includes(term)).length;
			const score = matched / terms.length;
			if (score >= 0.5) {
				const indent = line.indexOf(trimmed);
				candidates.push({ start: lineStart + indent, end: lineStart + indent + trimmed.length, score });
			}
		}
		lineStart += line.length + 1;
	}

	candidates.sort((a, b) => b.score - a.score || a.start - b.start);
	return candidates.map((candidate) => [candidate.start, candidate.end] as [number, number]);
}

/**
 * Find up to `maxMatches` passages across `queries`.
 *
 * Substring modes scan in order; fuzzy ranks candidate lines by term coverage.
 * Offsets are code points; overlapping hits are skipped.
 */
export function findPassages(text: string, queries: string[], options: FindOptions): Passage[] {
	if (text.length === 0) return [];
	const points = toChars(text);
	const results: Passage[] = [];
	const seen = new Set<string>();

	for (const query of queries) {
		const trimmed = query.trim();
		if (!trimmed) continue;
		const hits =
			options.mode === "fuzzy"
				? fuzzyMatches(text, trimmed)
				: substringMatches(text, trimmed, options.mode === "insensitive");

		for (const [start, end] of hits) {
			if (results.length >= options.maxMatches) return results;
			const offset = toCodePointOffset(text, start);
			const key = `${trimmed}\u0000${offset}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const endOffset = toCodePointOffset(text, end);
			results.push({ query: trimmed, offset, passage: passageAround(points, offset, endOffset, options.contextChars) });
		}
	}

	return results;
}
