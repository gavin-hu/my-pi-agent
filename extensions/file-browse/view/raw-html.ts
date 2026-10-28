/**
 * Sanitized raw HTML for the rendered Markdown view.
 *
 * GitHub READMEs lean on a small HTML vocabulary — `<details>` to fold a long
 * section, `<summary>`, `<img>` badges, `<kbd>`, a hand-written `<table>` — and
 * an escape-only renderer shows all of it as source. This module re-emits an
 * allowlist of elements instead, and it never copies source markup into the page:
 * every tag is rebuilt from its parsed name plus an attribute allowlist, and
 * every value is escaped again with `escapeHtml`.
 *
 * Three lists, deliberately explicit:
 * - `BLOCK_ELEMENTS` and `PHRASING` are re-emitted with sanitized attributes.
 * - `SUPPRESSED` elements are dropped with their content, so an inline SVG or a
 *   `<style>` block cannot dump its body into the document as text.
 * - anything else is escaped and therefore visible: content is never lost
 *   silently, and a construct the renderer does not understand looks like text.
 *
 * `style` and `class` are never emitted. The page allows inline styles, so a
 * `style` attribute could position over the chrome, and `class` could target the
 * page's own `bf-*` selectors. Text nodes keep their `&`: an HTML block's
 * references are decoded by the browser, so `&copy;` in the source still renders
 * as ©, while `<` and `>` are escaped and cannot become markup. Elements are
 * balanced through a shared `HtmlSink` so an unclosed `<div>` cannot swallow the
 * page footer; an entry opened in one block and closed in a later one is exactly
 * how `<details>` wraps Markdown.
 */

import { decodeCodePoint, escapeHtml } from "../../../lib/escape.ts";
import { emitImage, emitImageLink, EXTERNAL_ATTRS } from "./emit.ts";
import { type LinkBase, resolveImage, resolveLink } from "./urls.ts";

/** Elements re-emitted with sanitized attributes. */
const BLOCK_ELEMENTS = new Set([
	"details",
	"summary",
	"div",
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"dl",
	"dt",
	"dd",
	"blockquote",
	"pre",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"figure",
	"figcaption",
	"section",
	"article",
	"aside",
	"header",
	"footer",
	"nav",
	"hr",
]);

/** Elements accepted inside a line of Markdown, never as a block start. */
const PHRASING = new Set([
	"a",
	"abbr",
	"b",
	"br",
	"cite",
	"code",
	"del",
	"em",
	"i",
	"img",
	"ins",
	"kbd",
	"mark",
	"q",
	"s",
	"samp",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"time",
	"u",
	"var",
	"wbr",
]);

const ALLOWED = new Set([...BLOCK_ELEMENTS, ...PHRASING]);

/** Elements whose whole body is dropped: they are never meaningful as text. */
const SUPPRESSED = new Set([
	"applet",
	"audio",
	"base",
	"button",
	"canvas",
	"embed",
	"form",
	"frame",
	"frameset",
	"iframe",
	"link",
	"marquee",
	"math",
	"meta",
	"noscript",
	"object",
	"param",
	"picture",
	"portal",
	"script",
	"select",
	"source",
	"style",
	"svg",
	"template",
	"textarea",
	"title",
	"track",
	"video",
]);

const VOID = new Set(["area", "br", "col", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*/;
const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*/;
const BLOCK_OPEN = /^ {0,3}<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;
const COMMENT_OPEN = /^ {0,3}<!--/;
const DECLARATION_OPEN = /^ {0,3}<[!?]/;
/** The five XML references, plus numeric ones, are the only refs decoded in a value. */
/**
 * The five references an attribute value may carry, decoded.
 *
 * Not the Markdown renderer's table: a tag's attribute is not running text, and decoding
 * `&nbsp;` or `&mdash;` inside one would invent characters the author did not write.
 */
const ATTRIBUTE_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ATTRIBUTE_ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;

/** Open elements, in document order, shared by every HTML block in a document. */
export interface HtmlSink {
	stack: string[];
}

/** Where a line starts an HTML block, and whether that block's body is suppressed. */
export type HtmlBlockStart = { kind: "html" } | { kind: "suppressed"; name: string };

interface RawAttribute {
	name: string;
	value: string;
}

interface RawTag {
	kind: "tag" | "comment" | "declaration";
	name: string;
	end: boolean;
	selfClosing: boolean;
	attrs: RawAttribute[];
	/** Index just past the construct. */
	next: number;
}

/** The per-document balancing state for HTML blocks. */
export function createHtmlSink(): HtmlSink {
	return { stack: [] };
}

/** Close whatever a document's HTML blocks left open, in reverse order. */
export function closeHtmlSink(sink: HtmlSink): string {
	return closeTo(sink.stack, 0);
}

/** Close a local inline stack, in reverse order. */
export function closeInlineTags(stack: string[]): string {
	return closeTo(stack, 0);
}

/** Where `line` opens an HTML block, if it does. */
export function htmlBlockStart(line: string): HtmlBlockStart | undefined {
	if (COMMENT_OPEN.test(line) || DECLARATION_OPEN.test(line)) return { kind: "html" };
	const match = BLOCK_OPEN.exec(line);
	if (match === null) return undefined;
	const name = match[2].toLowerCase();
	if (SUPPRESSED.has(name)) return { kind: "suppressed", name };
	if (BLOCK_ELEMENTS.has(name)) return { kind: "html" };
	return undefined;
}

/** True when `line` closes the suppressed element `name`. */
export function closesSuppressed(line: string, name: string): boolean {
	// `name` came from TAG_NAME, so it cannot carry regex metacharacters.
	return new RegExp(`</${name}\\s*>`, "i").test(line);
}

/** Sanitize one HTML block, emitting text and allowlisted tags into `sink`. */
export function sanitizeHtmlBlock(source: string, linkBase: LinkBase, sink: HtmlSink): string {
	let out = "";
	let i = 0;
	while (i < source.length) {
		const open = source.indexOf("<", i);
		if (open === -1) {
			out += escapeText(source.slice(i));
			break;
		}
		out += escapeText(source.slice(i, open));
		const tag = parseRawTag(source, open);
		if (tag === undefined) {
			out += "&lt;";
			i = open + 1;
			continue;
		}
		i = tag.next;
		if (tag.kind !== "tag") continue;
		if (SUPPRESSED.has(tag.name)) {
			i = skipSuppressed(source, i, tag);
			continue;
		}
		if (!ALLOWED.has(tag.name)) {
			out += escapeHtml(source.slice(open, tag.next));
			continue;
		}
		if (tag.end) {
			out += closeTo(sink.stack, sink.stack.lastIndexOf(tag.name));
			continue;
		}
		out += tag.name === "img" ? sanitizeImage(tag, linkBase) : sanitizeOpenTag(tag, linkBase);
		if (tag.name !== "img" && !VOID.has(tag.name) && !tag.selfClosing) sink.stack.push(tag.name);
	}
	return out;
}

/**
 * Sanitize one tag inside a line of Markdown. Returns `undefined` when the tag is
 * not HTML this renderer accepts, so the caller falls back to escaping the `<`.
 * `stack` is local to a single inline run, so an unclosed phrasing tag is closed
 * at the end of the line rather than leaking into the next block.
 */
export function sanitizeInlineTag(
	source: string,
	start: number,
	linkBase: LinkBase,
	stack: string[],
): { html: string; end: number } | undefined {
	const tag = parseRawTag(source, start);
	if (tag === undefined) return undefined;
	if (tag.kind === "comment") return { html: "", end: tag.next };
	if (tag.kind === "declaration") return undefined;
	if (SUPPRESSED.has(tag.name)) return { html: "", end: skipSuppressed(source, tag.next, tag) };
	if (!ALLOWED.has(tag.name) || !PHRASING.has(tag.name)) return undefined;
	if (tag.end) return { html: closeTo(stack, stack.lastIndexOf(tag.name)), end: tag.next };
	const html = tag.name === "img" ? sanitizeImage(tag, linkBase) : sanitizeOpenTag(tag, linkBase);
	if (tag.name !== "img" && !VOID.has(tag.name) && !tag.selfClosing) stack.push(tag.name);
	return { html, end: tag.next };
}

function isSpace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/** Escape a text node, keeping `&` so the browser still decodes a source reference. */
function escapeText(value: string): string {
	return value.replace(/[<>]/g, (char) => (char === "<" ? "&lt;" : "&gt;"));
}

/** Match `pattern` at `index`, returning the matched text or `undefined`. */
function matchAt(pattern: RegExp, source: string, index: number): string | undefined {
	const match = pattern.exec(source.slice(index));
	return match === null ? undefined : match[0];
}

/**
 * Parse a tag, comment, or declaration starting at `start`. Anything outside the
 * strict grammar returns `undefined`, which the caller turns back into text, so a
 * malformed tag is never half-interpreted.
 */
function parseRawTag(source: string, start: number): RawTag | undefined {
	if (source[start] !== "<") return undefined;
	if (source.startsWith("<!--", start)) {
		const close = source.indexOf("-->", start + 4);
		return {
			kind: "comment",
			name: "",
			end: false,
			selfClosing: false,
			attrs: [],
			next: close === -1 ? source.length : close + 3,
		};
	}
	if (source[start + 1] === "!" || source[start + 1] === "?") {
		const close = source.indexOf(">", start + 2);
		return {
			kind: "declaration",
			name: "",
			end: false,
			selfClosing: false,
			attrs: [],
			next: close === -1 ? source.length : close + 1,
		};
	}
	let i = start + 1;
	const end = source[i] === "/";
	if (end) i++;
	const name = matchAt(TAG_NAME, source, i);
	if (name === undefined) return undefined;
	i += name.length;
	const attrs: RawAttribute[] = [];
	let selfClosing = false;
	for (;;) {
		while (i < source.length && isSpace(source[i])) i++;
		if (i >= source.length) return undefined;
		if (source[i] === ">") {
			i++;
			break;
		}
		if (source[i] === "/" && source[i + 1] === ">") {
			selfClosing = true;
			i += 2;
			break;
		}
		if (end) return undefined;
		const attribute = matchAt(ATTR_NAME, source, i);
		if (attribute === undefined) return undefined;
		i += attribute.length;
		while (i < source.length && isSpace(source[i])) i++;
		let value = "";
		if (source[i] === "=") {
			i++;
			while (i < source.length && isSpace(source[i])) i++;
			const quote = source[i];
			if (quote === '"' || quote === "'") {
				const close = source.indexOf(quote, i + 1);
				if (close === -1) return undefined;
				value = source.slice(i + 1, close);
				i = close + 1;
			} else {
				const from = i;
				while (i < source.length && !isSpace(source[i]) && source[i] !== ">") i++;
				value = source.slice(from, i);
			}
		}
		attrs.push({ name: attribute.toLowerCase(), value });
	}
	return { kind: "tag", name: name.toLowerCase(), end, selfClosing, attrs, next: i };
}

/** Decode the five XML references and numeric ones inside an attribute value. */
function decodeAttribute(value: string): string {
	return value.replace(
		ATTRIBUTE_ENTITY,
		(match, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
			if (decimal !== undefined) return decodeCodePoint(Number(decimal));
			if (hex !== undefined) return decodeCodePoint(Number.parseInt(hex, 16));
			if (named !== undefined && Object.hasOwn(ATTRIBUTE_ENTITIES, named)) return ATTRIBUTE_ENTITIES[named];
			return match;
		},
	);
}

/** The first value for `name`, decoded, so a duplicate attribute cannot override it. */
function attribute(tag: RawTag, name: string): string | undefined {
	const found = tag.attrs.find((candidate) => candidate.name === name);
	return found === undefined ? undefined : decodeAttribute(found.value);
}

function numeric(value: string | undefined): string | undefined {
	return value !== undefined && /^\d{1,5}$/.test(value) ? value : undefined;
}

/** Close `stack` down to `depth`, in reverse order; a negative depth drops a stray end tag. */
function closeTo(stack: string[], depth: number): string {
	if (depth < 0) return "";
	let out = "";
	while (stack.length > depth) {
		const open = stack.pop();
		if (open !== undefined) out += `</${open}>`;
	}
	return out;
}

/**
 * Skip a suppressed element's body. The scan is deliberately simple: the first
 * matching close tag wins, which is enough for `<script>`/`<style>`/`<svg>` bodies
 * and, if the close is missing, drops the rest of the block rather than guessing.
 */
function skipSuppressed(source: string, from: number, tag: RawTag): number {
	if (tag.selfClosing) return from;
	const match = new RegExp(`</${tag.name}\\s*>`, "i").exec(source.slice(from));
	if (match === null) return source.length;
	return from + match.index + match[0].length;
}

/** Rebuild an allowlisted start tag from its parsed name and allowed attributes. */
function sanitizeOpenTag(tag: RawTag, linkBase: LinkBase): string {
	const out: string[] = [];
	const id = attribute(tag, "id");
	if (id !== undefined && id !== "") out.push(` id="${escapeHtml(id)}"`);
	const title = attribute(tag, "title");
	if (title !== undefined) out.push(` title="${escapeHtml(title)}"`);
	switch (tag.name) {
		case "a": {
			const href = attribute(tag, "href");
			const target = href === undefined ? undefined : resolveLink(href, linkBase);
			if (target !== undefined) {
				out.push(` href="${escapeHtml(target.href)}"`);
				if (target.external) out.push(EXTERNAL_ATTRS);
			}
			break;
		}
		case "details": {
			if (tag.attrs.some((candidate) => candidate.name === "open")) out.push(" open");
			break;
		}
		case "ol": {
			const start = numeric(attribute(tag, "start"));
			if (start !== undefined) out.push(` start="${start}"`);
			break;
		}
		case "li": {
			const value = numeric(attribute(tag, "value"));
			if (value !== undefined) out.push(` value="${value}"`);
			break;
		}
		case "th":
		case "td": {
			const colspan = numeric(attribute(tag, "colspan"));
			if (colspan !== undefined) out.push(` colspan="${colspan}"`);
			const rowspan = numeric(attribute(tag, "rowspan"));
			if (rowspan !== undefined) out.push(` rowspan="${rowspan}"`);
			if (tag.name === "th") {
				const scope = attribute(tag, "scope");
				if (scope !== undefined && /^(?:row|col|rowgroup|colgroup)$/.test(scope)) out.push(` scope="${scope}"`);
			}
			break;
		}
		case "time": {
			const datetime = attribute(tag, "datetime");
			if (datetime !== undefined) out.push(` datetime="${escapeHtml(datetime)}"`);
			break;
		}
	}
	return `<${tag.name}${out.join("")}>`;
}

/**
 * Emit an `<img>` from its allowed attributes. An external `src` becomes a link
 * (the page CSP forbids remote images), and an unresolvable one leaves the alt
 * text, so a broken badge is still readable.
 */
function sanitizeImage(tag: RawTag, linkBase: LinkBase): string {
	const alt = attribute(tag, "alt") ?? "";
	const src = attribute(tag, "src");
	const target = src === undefined ? undefined : resolveImage(src, linkBase);
	if (target === undefined) return alt === "" ? "" : escapeHtml(alt);
	if (!target.image) return emitImageLink(target.href, alt === "" ? target.href : alt);
	// The element is `emit.ts`'s, so an `<img>` written as HTML and the same one written as
	// Markdown are the same element, down to the lazy decoding.
	return emitImage({
		href: target.href,
		alt,
		title: attribute(tag, "title"),
		width: numeric(attribute(tag, "width")),
		height: numeric(attribute(tag, "height")),
	});
}
