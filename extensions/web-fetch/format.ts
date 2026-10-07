/**
 * Model-facing text formatting and slicing for `web_fetch`.
 *
 * The extracted text is sliced by code point from `startIndex`, so CJK and
 * emoji stay well-formed. A header describes the page, and a trailing note tells
 * the model how to read the next chunk when the page is longer than the budget.
 */

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

export function formatPage(input: PageFormatInput): FormattedPage {
	const points = Array.from(input.text);
	const total = points.length;

	const headerLines: string[] = [];
	if (input.title) headerLines.push(`Title: ${input.title}`);
	headerLines.push(`URL: ${input.finalUrl}`);
	headerLines.push(`Status: ${input.status}${input.contentType ? ` (${input.contentType})` : ""}`);
	const header = headerLines.join("\n");

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
