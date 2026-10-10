/**
 * Model-facing text formatting for `web_search`.
 *
 * Renders the direct answer (when present) and the numbered results within a
 * character budget. Whole blocks are added while they fit; if the first block
 * alone overflows, the text is truncated by code point so CJK stays well-formed.
 */

import { charLength, truncateChars } from "../text.ts";
import { providerLabel } from "./registry.ts";
import type { SearchResponse } from "./schema.ts";

export interface FormattedResults {
	text: string;
	truncated: boolean;
}

function headerFor(response: SearchResponse): string {
	if (response.provider === "none") return `No web results for "${response.query}"`;
	return `${providerLabel(response.provider)} results for "${response.query}"`;
}

export function formatResults(response: SearchResponse, maxOutputChars: number): FormattedResults {
	const header = headerFor(response);

	if (response.provider === "none") {
		return { text: `${header}. Rephrase the query, or use web_fetch on a known URL.`, truncated: false };
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
	let size = charLength(text) + 2;
	let dropped = false;
	for (const block of blocks) {
		const blockLength = charLength(block);
		if (included.length > 0 && size + blockLength + 2 > maxOutputChars) {
			dropped = true;
			break;
		}
		included.push(block);
		size += blockLength + 2;
	}

	text += `\n\n${included.join("\n\n")}`;
	if (dropped) text += `\n\n(showing ${included.length} of ${blocks.length} results)`;

	if (charLength(text) > maxOutputChars) {
		text = truncateChars(text, maxOutputChars);
		dropped = true;
	}

	return { text, truncated: dropped };
}
