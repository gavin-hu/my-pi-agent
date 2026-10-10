/**
 * Model-facing text formatting and slicing for `web_fetch`.
 *
 * `formatPage` renders one page — header, a code-point slice from `startIndex`,
 * and the truncation note — within `maxChars`. The header and the note are
 * counted against the budget up front, so the "call web_fetch again with
 * startIndex=" instruction always survives inside the limit.
 * `formatMatches` renders find-in-page passages with their offsets, and
 * `formatBatch` joins whole sections, dropping whole pages rather than cutting
 * one mid-way, so no section loses its continuation hint.
 */

import { charLength, toChars } from "../text.ts";
import type { Passage } from "./find.ts";

export interface PageFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	text: string;
	startIndex: number;
	/** Budget for the whole formatted page: header, body slice, and note. */
	maxChars: number;
}

export interface FormattedPage {
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
	const points = toChars(input.text);
	const total = points.length;
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
		const body = points.slice(input.startIndex).join("");
		return { body, text: `${header}\n\n${body}`, truncated: false, nextIndex: input.startIndex };
	}

	const reserve = charLength(header) + 2 + charLength(truncationNote(total, total));
	const capacity = Math.max(1, input.maxChars - reserve);
	const slicePoints = points.slice(input.startIndex, input.startIndex + capacity);
	const body = slicePoints.join("");
	const nextIndex = input.startIndex + slicePoints.length;
	const text = `${header}\n\n${body}${truncationNote(nextIndex, total)}`;

	return { body, text, truncated: true, nextIndex };
}

export interface MatchFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	matches: Passage[];
	find: string[];
	/** True when the match list was capped by `maxMatches`. */
	truncated: boolean;
}

export interface FormattedMatches {
	body: string;
	text: string;
	/** True when the match list was capped by `maxMatches`. */
	truncated: boolean;
}

export function formatMatches(input: MatchFormatInput): FormattedMatches {
	const quoted = input.find.map((term) => `"${term}"`).join(", ");
	const header = `${pageHeader(input.title, input.finalUrl, input.status, input.contentType)}\nMatches for ${quoted}: ${input.matches.length}`;

	if (input.matches.length === 0) {
		return { body: "", text: `${header}\n\nNo matches.`, truncated: false };
	}

	const body = input.matches
		.map((match, index) => `${index + 1}. [offset ${match.offset}] ${match.passage}`)
		.join("\n\n");
	let text = `${header}\n\n${body}`;
	if (input.truncated) text += `\n\n(first ${input.matches.length} matches; raise maxMatches for more)`;
	return { body, text, truncated: input.truncated };
}

export interface BatchSection {
	url: string;
	/** Per-page formatted text (header + body, or an ERROR line). */
	text: string;
}

/**
 * Join per-page sections as one `### url` block each, within a code-point
 * budget. Whole sections are included while they fit within `maxChars`; when
 * some do not, the result ends with a count, so a drop is never silent and no
 * section is left half-rendered.
 */
export function formatBatch(sections: BatchSection[], maxChars: number): { text: string } {
	const blocks = sections.map((section) => `### ${section.url}\n${section.text}`);
	const included: string[] = [];
	let size = 0;
	for (const block of blocks) {
		const cost = charLength(block) + (included.length > 0 ? 2 : 0);
		// The first block is always kept, even if it alone exceeds the budget.
		if (included.length > 0 && size + cost > maxChars) break;
		included.push(block);
		size += cost;
	}

	let text = included.join("\n\n");
	if (included.length < blocks.length) {
		text += `\n\n(showing ${included.length} of ${blocks.length} pages)`;
	}
	return { text };
}
