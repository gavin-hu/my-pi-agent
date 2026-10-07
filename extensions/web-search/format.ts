/**
 * Model-facing text formatting for `web_search`.
 *
 * Results are rendered as numbered blocks and kept within a character budget.
 * Whole blocks are added while they fit; if the first block alone overflows, the
 * text is truncated by code point so CJK and emoji stay well-formed.
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

export function formatResults(response: SearchResponse, maxOutputChars: number): FormattedResults {
	const header = `DuckDuckGo results for "${response.query}"`;

	if (response.results.length === 0) {
		return { text: `${header}: no results.`, truncated: false };
	}

	const blocks = response.results.map((result, index) => {
		const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
		if (result.snippet) lines.push(`   ${result.snippet}`);
		return lines.join("\n");
	});

	const included: string[] = [];
	let size = header.length + 1;
	let dropped = false;

	for (const block of blocks) {
		if (included.length > 0 && size + block.length + 2 > maxOutputChars) {
			dropped = true;
			break;
		}
		included.push(block);
		size += block.length + 2;
	}

	let text = `${header}\n\n${included.join("\n\n")}`;
	if (dropped) text += `\n\n(showing ${included.length} of ${blocks.length} results)`;

	if (text.length > maxOutputChars) {
		text = truncateByCodePoint(text, maxOutputChars);
		dropped = true;
	}

	return { text, truncated: dropped };
}
