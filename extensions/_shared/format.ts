/**
 * Pure text/number formatting shared across extensions.
 *
 * No terminal access and no theme: these turn numbers and text into the short
 * strings a renderer shows.
 */

/** Compact token count: `999`, `1.0k`, `12k`, `1.5M`, `12M`. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Collapse newlines, tabs, and runs of spaces so text stays on one line. */
export function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
