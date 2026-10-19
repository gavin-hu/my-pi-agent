/**
 * Model-facing text formatting and slicing for `web_fetch`.
 *
 * `formatPage` renders one page — header, a code-point slice from `startIndex`,
 * and the truncation note — within `maxChars`. The header and the note are
 * counted against the budget up front, so the "call web_fetch again with
 * startIndex=" instruction always survives inside the limit.
 *
 * `formatMatches` renders find-in-page passages with their offsets inside the
 * same budget: it includes as many passages as fit and says which knob to turn
 * when it had to drop the rest, rather than returning every match the caller
 * allowed.
 */

import { charLength, sliceChars, truncateChars } from "../text.ts";
import type { Passage } from "./find.ts";

interface PageFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	text: string;
	startIndex: number;
	/** Budget for the whole formatted page: header, body slice, and note. */
	maxChars: number;
}

interface FormattedPage {
	/** The requested slice of the page text. */
	body: string;
	/** Header, body, and any truncation note. */
	text: string;
	truncated: boolean;
	/** Offset to pass as `startIndex` for the next chunk. */
	nextIndex: number;
}

function pageHeader(title: string, finalUrl: string, status: number, contentType: string): string {
	const lines: string[] = [];
	if (title) lines.push(`Title: ${title}`);
	lines.push(`URL: ${finalUrl}`);
	lines.push(`Status: ${status}${contentType ? ` (${contentType})` : ""}`);
	return lines.join("\n");
}

/** The note that names the next chunk. Its length is reserved before slicing. */
function truncationNote(nextIndex: number, total: number): string {
	return `\n\n… (truncated at ${nextIndex} of ${total} characters; call web_fetch again with startIndex=${nextIndex})`;
}

export function formatPage(input: PageFormatInput): FormattedPage {
	const total = charLength(input.text);
	const header = pageHeader(input.title, input.finalUrl, input.status, input.contentType);

	if (total === 0) {
		return { body: "", text: `${header}\n\n(no readable text)`, truncated: false, nextIndex: input.startIndex };
	}

	if (input.startIndex >= total) {
		return {
			body: "",
			text: `${header}\n\n(no text at startIndex ${input.startIndex}; total ${total} characters)`,
			truncated: false,
			nextIndex: input.startIndex,
		};
	}

	// When the rest of the page fits, use the whole budget for the body. Only a
	// page that must be paged pays for the note, which is reserved up front (using
	// `total` for both offsets gives the widest digit count) so the hint survives.
	const plainCapacity = Math.max(1, input.maxChars - charLength(header) - 2);
	if (input.startIndex + plainCapacity >= total) {
		const body = sliceChars(input.text, input.startIndex);
		return { body, text: `${header}\n\n${body}`, truncated: false, nextIndex: input.startIndex };
	}

	const reserve = charLength(header) + 2 + charLength(truncationNote(total, total));
	const capacity = Math.max(1, input.maxChars - reserve);
	const body = sliceChars(input.text, input.startIndex, input.startIndex + capacity);
	const nextIndex = input.startIndex + charLength(body);
	const text = `${header}\n\n${body}${truncationNote(nextIndex, total)}`;

	return { body, text, truncated: true, nextIndex };
}

interface MatchFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	matches: Passage[];
	find: string[];
	/** Budget for the whole formatted result: header, passages, and note. */
	maxChars: number;
	/** True when the provider capped the list at `maxMatches`. */
	cappedByMaxMatches: boolean;
}

interface FormattedMatches {
	/** The passages that fit, rendered one per block. */
	body: string;
	/** Header, passages, and any truncation note. */
	text: string;
	/** True when anything was hidden: the match cap, the budget, or an oversized passage. */
	truncated: boolean;
	/** The passages `body` and `text` actually contain. */
	included: Passage[];
}

export function formatMatches(input: MatchFormatInput): FormattedMatches {
	const quoted = input.find.map((term) => `"${term}"`).join(", ");
	const header = `${pageHeader(input.title, input.finalUrl, input.status, input.contentType)}\nMatches for ${quoted}: ${input.matches.length}`;

	if (input.matches.length === 0) {
		return { body: "", text: `${header}\n\nNo matches.`, truncated: false, included: [] };
	}

	const blocks = input.matches.map((match, index) => `${index + 1}. [offset ${match.offset}] ${match.passage}`);

	// Add whole blocks while they fit; the first one is kept even when oversized.
	const shown: string[] = [];
	let size = charLength(header) + 2;
	for (const block of blocks) {
		const length = charLength(block);
		if (shown.length > 0 && size + length + 2 > input.maxChars) break;
		shown.push(block);
		size += length + 2;
	}

	const noteFor = (count: number): string => {
		if (count < blocks.length) {
			return `(showing ${count} of ${blocks.length} matches within ${input.maxChars} characters; narrow find or lower contextChars)`;
		}
		if (input.cappedByMaxMatches) return `(first ${count} matches; raise maxMatches for more)`;
		return "";
	};
	const render = (count: number, note: string): string => {
		const base = `${header}\n\n${shown.slice(0, count).join("\n\n")}`;
		return note ? `${base}\n\n${note}` : base;
	};

	// The note must survive the budget too, so drop trailing passages until it fits.
	let count = shown.length;
	let note = noteFor(count);
	while (count > 1 && charLength(render(count, note)) > input.maxChars) {
		count--;
		note = noteFor(count);
	}
	if (note && charLength(render(count, note)) > input.maxChars) note = "";

	let text = render(count, note);
	const overflow = charLength(text) > input.maxChars;
	if (overflow) text = truncateChars(text, input.maxChars);

	const body = shown.slice(0, count).join("\n\n");
	return {
		body,
		text,
		truncated: count < blocks.length || input.cappedByMaxMatches || overflow,
		included: input.matches.slice(0, count),
	};
}
