/**
 * Model-facing text formatting for `web_search`.
 *
 * Renders the instant answer (when present) and the numbered results within a
 * character budget. Whole blocks are added while they fit; if the first block
 * alone overflows, the text is truncated by code point so CJK stays well-formed.
 */

import type { SearchResponse } from "./types.ts";

export interface FormattedResults {
	text: string;
	truncated: boolean;
}

function truncateByCodePoint(text: string, maxChars: number): string {
	const points = Array.from(text);
	if (points.length <= maxChars) return text;
	if (maxChars <= 1) return "…";
	return `${points.slice(0, maxChars - 1).join("")}…`;
}

function headerFor(response: SearchResponse): string {
	if (response.provider === "duckduckgo") return `DuckDuckGo instant answer for "${response.query}"`;
	if (response.provider === "wikipedia") return `Wikipedia results for "${response.query}"`;
	return `No instant answer or Wikipedia results for "${response.query}"`;
}

export function formatResults(response: SearchResponse, maxOutputChars: number): FormattedResults {
	const header = headerFor(response);

	if (response.provider === "none") {
		return { text: `${header}. Use web_fetch on a known URL, or rephrase the query.`, truncated: false };
	}

	let text = header;
	if (response.answer) text += `\n\nAnswer: ${response.answer}`;

	if (response.results.length === 0) {
		return { text, truncated: false };
	}

	const blocks = response.results.map((result, index) => {
		const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
		if (result.snippet) lines.push(`   ${result.snippet}`);
		return lines.join("\n");
	});

	const included: string[] = [];
	let size = text.length + 2;
	let dropped = false;
	for (const block of blocks) {
		if (included.length > 0 && size + block.length + 2 > maxOutputChars) {
			dropped = true;
			break;
		}
		included.push(block);
		size += block.length + 2;
	}

	text += `\n\n${included.join("\n\n")}`;
	if (dropped) text += `\n\n(showing ${included.length} of ${blocks.length} results)`;

	if (text.length > maxOutputChars) {
		text = truncateByCodePoint(text, maxOutputChars);
		dropped = true;
	}

	return { text, truncated: dropped };
}
