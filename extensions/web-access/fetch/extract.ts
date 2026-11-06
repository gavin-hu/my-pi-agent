/**
 * Dependency-free HTML-to-text extraction for `web_fetch`.
 *
 * This is a heuristic readability pass, not a DOM parser: it removes chrome
 * (scripts, styles, nav/footer/header, forms), prefers the largest
 * `<main>`/`<article>`, converts block structure, headings, lists, table rows,
 * links, and images to Markdown-ish text, decodes entities, and collapses
 * whitespace. A tag's attribute span skips a quoted `>`, so `title="a > b"` does
 * not end its tag early. CJK passes through unchanged. Entity decoding is shared
 * with `web_search` (`../html.ts`).
 */

import { decodeEntities, stripTagsAndDecode, TAG_ATTRIBUTES } from "../html.ts";

/** A `name` opener whose attribute span skips a quoted `>`. */
function tag(name: string): RegExp {
	return new RegExp(`<${name}\\b${TAG_ATTRIBUTES}>`, "gi");
}

function largestMatch(html: string, names: string[]): string | undefined {
	let best: string | undefined;
	for (const name of names) {
		const re = new RegExp(`<${name}\\b${TAG_ATTRIBUTES}>([\\s\\S]*?)</${name}>`, "gi");
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

/** One `<img>` tag's `alt`, decoded and whitespace-collapsed. */
function altOf(imageTag: string): string {
	const quoted = imageTag.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? imageTag.match(/\balt\s*=\s*'([^']*)'/i)?.[1];
	return quoted ? decodeEntities(quoted).replace(/\s+/g, " ").trim() : "";
}

/** The first `alt` inside `html`, so a link wrapping only an image keeps its caption. */
function firstAlt(html: string): string {
	for (const image of html.matchAll(tag("img"))) {
		const alt = altOf(image[0]);
		if (alt) return alt;
	}
	return "";
}

function convertAnchors(html: string, base: string): string {
	const anchor = new RegExp(`<a\\b(${TAG_ATTRIBUTES})>([\\s\\S]*?)</a>`, "gi");
	return html.replace(anchor, (_whole, attributes: string, inner: string) => {
		const href = attributes.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? attributes.match(/\bhref\s*=\s*'([^']*)'/i)?.[1];
		const text = stripTagsAndDecode(inner).replace(/\s+/g, " ").trim() || firstAlt(inner);
		if (!text) return "";
		const url = href ? resolveHref(href, base) : undefined;
		return url ? `[${text}](${url})` : text;
	});
}

function convertImages(html: string): string {
	return html.replace(tag("img"), (image: string) => {
		const alt = altOf(image);
		return alt ? `[${alt}]` : "";
	});
}

/**
 * One line per table row, its cells joined by ` | `. A row is read whole so the
 * separator sits between cells and never at a line's edge; a row this cannot
 * read falls through to the remaining passes.
 */
function convertTables(html: string): string {
	const row = new RegExp(`<tr\\b${TAG_ATTRIBUTES}>([\\s\\S]*?)</tr\\s*>`, "gi");
	const cell = new RegExp(`<t[dh]\\b${TAG_ATTRIBUTES}>([\\s\\S]*?)</t[dh]\\s*>`, "gi");
	return html.replace(row, (whole, inner: string) => {
		const cells = [...inner.matchAll(cell)].map((match) => match[1].replace(/\s+/g, " ").trim());
		return cells.length > 0 ? `\n${cells.join(" | ")}` : whole;
	});
}

function convertStructure(html: string): string {
	let html2 = convertTables(html);
	html2 = html2.replace(
		new RegExp(`<(h[1-6])\\b${TAG_ATTRIBUTES}>`, "gi"),
		(_m, level: string) => `\n\n${"#".repeat(Number(level[1]))} `,
	);
	html2 = html2.replace(tag("li"), "\n- ");
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
	const og = html.match(
		new RegExp(
			`<meta\\b${TAG_ATTRIBUTES}property\\s*=\\s*["']og:title["']${TAG_ATTRIBUTES}content\\s*=\\s*["']([^"']*)["']`,
			"i",
		),
	);
	if (og?.[1]?.trim()) return decodeEntities(og[1]).trim();
	const title = html.match(new RegExp(`<title${TAG_ATTRIBUTES}>([\\s\\S]*?)</title>`, "i"));
	return title ? stripTagsAndDecode(title[1]).replace(/\s+/g, " ").trim() : "";
}

interface ExtractedPage {
	title: string;
	text: string;
}

/** Turn an HTML document into a title and readable text. */
export function extractReadable(html: string, baseUrl: string): ExtractedPage {
	const title = extractTitle(html);

	let content = html.replace(/<!--[\s\S]*?-->/g, "");
	for (const name of [
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
		content = content.replace(new RegExp(`<${name}\\b${TAG_ATTRIBUTES}>[\\s\\S]*?</${name}>`, "gi"), " ");
	}

	const body = content.match(new RegExp(`<body\\b${TAG_ATTRIBUTES}>([\\s\\S]*?)</body>`, "i"))?.[1] ?? content;
	// Prefer a substantial <main>/<article>, but fall back to the whole body when
	// the largest one is only a fragment (for example a teaser or card list).
	const candidate = largestMatch(body, ["article", "main"]);
	const main = candidate && candidate.length >= body.length * 0.5 ? candidate : body;

	let text = convertAnchors(main, baseUrl);
	text = convertImages(text);
	text = convertStructure(text);
	text = stripTagsAndDecode(text);
	text = collapse(text);

	return { title, text };
}
