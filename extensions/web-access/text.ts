/**
 * Code-point text helpers shared by both halves of web-access.
 *
 * Character budgets are counted in code points, not UTF-16 units, so a slice
 * never splits a CJK character or an emoji, and a declared limit is honoured for
 * the text the model sees. Everything here walks the string in place: a
 * multi-megabyte page is never materialised as an array of one-character
 * strings, which is what `Array.from(text)` would cost on every call.
 */

const SURROGATE = /[\uD800-\uDFFF]/;

/** Length of text in code points. */
export function charLength(text: string): number {
	// A native scan with no allocation covers the common all-BMP page.
	if (!SURROGATE.test(text)) return text.length;

	let count = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) i++;
		}
		count++;
	}
	return count;
}

/**
 * Slice text by code-point offsets, like `Array.from(text).slice(from, to).join("")`
 * without building the array. Out-of-range offsets clamp, and `to` defaults to
 * the end of the string.
 */
export function sliceChars(text: string, from: number, to: number = Number.POSITIVE_INFINITY): string {
	const start = Math.max(0, Math.floor(from));
	const end = Math.max(start, Math.floor(to));
	if (start === 0 && end >= text.length) return text;

	let startIndex = text.length;
	let endIndex = text.length;
	let codePoint = 0;
	for (let i = 0; i < text.length; i++) {
		if (codePoint === start && startIndex === text.length) startIndex = i;
		if (codePoint === end) {
			endIndex = i;
			break;
		}
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) i++;
		}
		codePoint++;
	}
	return text.slice(startIndex, endIndex);
}

/** Truncate to `maxChars` code points, appending `marker` when anything was cut. */
export function truncateChars(text: string, maxChars: number, marker = "…"): string {
	if (charLength(text) <= maxChars) return text;
	const markerLength = charLength(marker);
	if (maxChars <= markerLength) return marker;
	return `${sliceChars(text, 0, maxChars - markerLength)}${marker}`;
}
