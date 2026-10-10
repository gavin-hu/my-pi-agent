/**
 * Code-point text helpers shared by both halves of web-access.
 *
 * Character budgets are counted in code points, not UTF-16 units, so a slice
 * never splits a CJK character or an emoji, and a declared limit is honoured for
 * the text the model sees. `web_search` and `web_fetch` measure and slice here
 * rather than re-deriving `Array.from` at each site.
 */

/** Split text into code points (an array of one-code-point strings). */
export function toChars(text: string): string[] {
	return Array.from(text);
}

/** Length of text in code points. */
export function charLength(text: string): number {
	return Array.from(text).length;
}

/** Truncate to `maxChars` code points, appending `marker` when anything was cut. */
export function truncateChars(text: string, maxChars: number, marker = "…"): string {
	const points = toChars(text);
	if (points.length <= maxChars) return text;
	if (maxChars <= marker.length) return marker;
	return `${points.slice(0, maxChars - marker.length).join("")}${marker}`;
}
