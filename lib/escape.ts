/**
 * HTML text escaping for the browse pages.
 *
 * The single escape used by every page renderer and by the Markdown renderer:
 * model- and file-authored text becomes safe text nodes and double-quoted
 * attributes. Keeping it here (rather than in `html.ts`) lets `markdown.ts`
 * escape without importing the page renderer, so the module graph stays
 * acyclic.
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
