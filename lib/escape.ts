/**
 * HTML text escaping, and the inverse for one character reference.
 *
 * The single escape used by every page renderer and by the Markdown renderer:
 * model- and file-authored text becomes safe text nodes and double-quoted
 * attributes. Keeping it here (rather than in `html.ts`) lets `markdown.ts`
 * escape without importing the page renderer, so the module graph stays
 * acyclic. `decodeCodePoint` is the other half of the same boundary and lives
 * beside it for the same reason: the Markdown inline scan and the raw-HTML
 * attribute decoder both resolve `&#N;` and `&#xN;` references, and one copy
 * cannot drift from the other.
 */

/** Escape text for an HTML text node or double-quoted attribute. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

/**
 * One numeric character reference as text: U+FFFD when it is a surrogate, zero,
 * or out of range, so an entity cannot inject an unpaired half of a pair.
 */
export function decodeCodePoint(value: number): string {
	if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
		return "\uFFFD";
	return String.fromCodePoint(value);
}
