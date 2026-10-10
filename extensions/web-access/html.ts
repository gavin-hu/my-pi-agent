/**
 * HTML entity decoding shared by both halves of web-access.
 *
 * `web_fetch` decodes entities while turning HTML into readable text, and
 * `web_search` decodes them in provider snippets. The table lives here because
 * the two halves do not import each other.
 */

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
};

/** Decode named and numeric HTML entities. Unknown entities are left as-is. */
export function decodeEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body.startsWith("#")) {
			const hex = body[1] === "x" || body[1] === "X";
			const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}
