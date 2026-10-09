/**
 * Dependency-free HTML-to-text extraction for `web_fetch`.
 *
 * This is a heuristic readability pass, not a DOM parser: it removes chrome
 * (scripts, styles, nav/footer/header, forms), prefers the largest
 * `<main>`/`<article>`, converts block structure, headings, lists, and links to
 * Markdown-ish text, decodes entities, and collapses whitespace. CJK passes
 * through unchanged.
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

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

function largestMatch(html: string, tags: string[]): string | undefined {
	let best: string | undefined;
	for (const tag of tags) {
		const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
		for (const match of html.matchAll(re)) {
			if (!best || match[1].length > best.length) best = match[1];
		}
	}
	return best;
}

function resolveHref(href: string, base: string): string | undefined {
	const trimmed = decodeEntities(href).trim();
	if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed) || /^mailto:/i.test(trimmed))
		return undefined;
	try {
		const url = new URL(trimmed, base);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function convertAnchors(html: string, base: string): string {
	return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_whole, attributes: string, inner: string) => {
		const href = attributes.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? attributes.match(/\bhref\s*=\s*'([^']*)'/i)?.[1];
		const text = stripTags(inner).replace(/\s+/g, " ").trim();
		if (!text) return "";
		const url = href ? resolveHref(href, base) : undefined;
		return url ? `[${text}](${url})` : text;
	});
}

function convertImages(html: string): string {
	return html.replace(/<img\b[^>]*>/gi, (tag) => {
		const alt = tag.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\balt\s*=\s*'([^']*)'/i)?.[1] ?? "";
		return alt.trim() ? `[${decodeEntities(alt).trim()}]` : "";
	});
}

function convertStructure(html: string): string {
	let html2 = html;
	html2 = html2.replace(/<(h[1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Number(level[1]))} `);
	html2 = html2.replace(/<li\b[^>]*>/gi, "\n- ");
	html2 = html2.replace(/<br\s*\/?>/gi, "\n");
	html2 = html2.replace(
		/<\/(p|div|section|article|main|ul|ol|table|tr|blockquote|pre|figure|figcaption|dl|dt|dd|h[1-6])>/gi,
		"\n\n",
	);
	html2 = html2.replace(/<\/li>/gi, "\n");
	return html2;
}

function collapse(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Extract a page title from `<title>` or `og:title`. */
export function extractTitle(html: string): string {
	const og = html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i);
	if (og?.[1]?.trim()) return decodeEntities(og[1]).trim();
	const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return title ? decodeEntities(stripTags(title[1])).replace(/\s+/g, " ").trim() : "";
}

export interface ExtractedPage {
	title: string;
	text: string;
}

/** Turn an HTML document into a title and readable text. */
export function extractReadable(html: string, baseUrl: string): ExtractedPage {
	const title = extractTitle(html);

	let content = html.replace(/<!--[\s\S]*?-->/g, "");
	for (const tag of [
		"script",
		"style",
		"noscript",
		"template",
		"svg",
		"iframe",
		"form",
		"nav",
		"footer",
		"header",
		"aside",
	]) {
		content = content.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), " ");
	}

	const body = content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? content;
	// Prefer a substantial <main>/<article>, but fall back to the whole body when
	// the largest one is only a fragment (for example a teaser or card list).
	const candidate = largestMatch(body, ["article", "main"]);
	const main = candidate && candidate.length >= body.length * 0.5 ? candidate : body;

	let text = convertAnchors(main, baseUrl);
	text = convertImages(text);
	text = convertStructure(text);
	text = stripTags(text);
	text = decodeEntities(text);
	text = collapse(text);

	return { title, text };
}
