/**
 * Model-facing text formatting and slicing for `web_fetch`.
 *
 * `formatPage` slices extracted text by code point from `startIndex`, so CJK and
 * emoji stay well-formed, and names the offset of the next chunk.
 * `formatMatches` renders find-in-page passages with their offsets.
 */

import type { Passage } from "./find.ts";

export interface PageFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	text: string;
	startIndex: number;
	maxChars: number;
}

export interface FormattedPage {
	/** Header lines describing the page. */
	header: string;
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

export function formatPage(input: PageFormatInput): FormattedPage {
	const points = Array.from(input.text);
	const total = points.length;
	const header = pageHeader(input.title, input.finalUrl, input.status, input.contentType);

	if (total === 0) {
		const text = `${header}\n\n(no readable text)`;
		return { header, body: "", text, truncated: false, nextIndex: input.startIndex };
	}

	if (input.startIndex >= total) {
		const text = `${header}\n\n(no text at startIndex ${input.startIndex}; total ${total} characters)`;
		return { header, body: "", text, truncated: false, nextIndex: total };
	}

	const slicePoints = points.slice(input.startIndex, input.startIndex + input.maxChars);
	const body = slicePoints.join("");
	const nextIndex = input.startIndex + slicePoints.length;
	const truncated = nextIndex < total;

	let text = `${header}\n\n${body}`;
	if (truncated) {
		text += `\n\n… (truncated at ${nextIndex} of ${total} characters; call web_fetch again with startIndex=${nextIndex})`;
	}

	return { header, body, text, truncated, nextIndex };
}

export interface MatchFormatInput {
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	matches: Passage[];
	find: string[];
}

export interface FormattedMatches {
	header: string;
	body: string;
	text: string;
	truncated: boolean;
}

export function formatMatches(input: MatchFormatInput): FormattedMatches {
	const quoted = input.find.map((term) => `"${term}"`).join(", ");
	const header = `${pageHeader(input.title, input.finalUrl, input.status, input.contentType)}\nMatches for ${quoted}: ${input.matches.length}`;

	if (input.matches.length === 0) {
		return { header, body: "", text: `${header}\n\nNo matches.`, truncated: false };
	}

	const body = input.matches.map((match, index) => `${index + 1}. [offset ${match.offset}] ${match.passage}`).join("\n\n");
	return { header, body, text: `${header}\n\n${body}`, truncated: false };
}
