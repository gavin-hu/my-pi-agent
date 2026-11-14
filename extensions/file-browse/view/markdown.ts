/**
 * A small, escape-first Markdown renderer for the browse file view.
 *
 * It is deliberately not CommonMark: it covers the block and inline constructs
 * that show up in repository READMEs — headings, paragraphs, fenced code,
 * blockquotes, nested and task lists, tables, code spans, emphasis, inline and
 * reference links, and images. Named and numeric character references are
 * decoded as literal text. Raw HTML is re-emitted through the allowlist in
 * `raw-html.ts`; `html: false` restores escape-only rendering, where the source
 * is shown as text and never executed.
 *
 * Relative links become `/view/<path>` and relative images become `/raw/<path>`
 * so they resolve from any page URL. The `/view` and `/raw` routes re-vet the
 * path at fetch time, so resolution here only has to avoid obvious escapes.
 * External images are rendered as links (the page CSP is `img-src 'self' data:`)
 * and non-http(s) schemes such as `javascript:` are dropped.
 *
 * Headings get a stable anchor id and are demoted one level so the embedding
 * page keeps the only `h1`.
 *
 * Kept free of the page renderer: it imports only `lib/escape.ts`,
 * `lib/highlight.ts`, `lib/web/markdown-blocks.ts`, and this directory's
 * `raw-html.ts`, `markdown-inline.ts` and `urls.ts`, so `html.ts` can compose it
 * without a module cycle. This module owns the document — its definitions, its
 * heading anchors, the raw-HTML sink and the block emitters — while the block
 * walk is the kit's and the span scan is `markdown-inline.ts`, so each file
 * answers one question about a README.
 */

import { escapeHtml } from "../../../lib/escape.ts";
import {
	FENCE,
	type MarkdownAlign,
	type MarkdownBlock,
	type MarkdownListItem,
	scanBlocks,
} from "../../../lib/web/markdown-blocks.ts";
import { fenceLanguage, highlightLines } from "../../../lib/highlight.ts";
import { type InlineContext, type LinkDefinition, referenceLabel, renderInline } from "./markdown-inline.ts";
import {
	closesSuppressed,
	closeHtmlSink,
	createHtmlSink,
	type HtmlSink,
	htmlBlockStart,
	sanitizeHtmlBlock,
} from "./raw-html.ts";
import type { LinkBase } from "./urls.ts";

/** A link reference definition: `[id]: dest "title"`. */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+["'(]([^"')]*)["')])?\s*$/;

/** Per-document render state: what a span may read, the raw-HTML sink, and the heading slugs. */
interface Context extends InlineContext {
	sink: HtmlSink;
	slug(text: string): string;
}

/** Render options; every field has the behaviour the browse page uses. */
export interface MarkdownOptions {
	/** Emit sanitized raw HTML (the default) or escape it (`false`). */
	html?: boolean;
	/** The prefix local links are written under, e.g. `/files`; `""` for the origin's root. */
	base?: string;
}

/**
 * Render a Markdown source string to a safe HTML fragment. Headings carry an
 * anchor id and are demoted one level, so the embedding page keeps the only
 * `h1`.
 */
export function renderMarkdown(source: string, baseDir = "", options: MarkdownOptions = {}): string {
	const html = options.html ?? true;
	const { defs, body } = collectDefinitions(source.split(/\r\n|\r|\n/), html);
	const context = createContext({ dir: baseDir, base: options.base ?? "" }, defs, html);
	const rendered = renderBlocks(body, context);
	return html ? rendered + closeHtmlSink(context.sink) : rendered;
}

/** Turn heading text into a stable anchor id, dropping Markdown punctuation. */
function headingSlug(text: string): string {
	const plain = text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_~]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.replace(/[\s-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return plain || "section";
}

/** Build the per-document render state, suffixing repeated heading slugs. */
function createContext(link: LinkBase, defs: Map<string, LinkDefinition>, html: boolean): Context {
	const seen = new Map<string, number>();
	return {
		link,
		defs,
		html,
		sink: createHtmlSink(),
		slug(text: string): string {
			const base = headingSlug(text);
			const count = seen.get(base) ?? 0;
			seen.set(base, count + 1);
			return count === 0 ? base : `${base}-${count}`;
		},
	};
}

/**
 * Lift link reference definitions out of the source before block rendering, so
 * a `[id]: dest` line becomes a definition rather than a paragraph and can be
 * referenced from anywhere in the document. Fences are skipped so a
 * definition-shaped line inside code stays literal. Definitions are
 * single-line; one inside a blockquote or list item is left in place as text.
 */
function collectDefinitions(lines: string[], html: boolean): { defs: Map<string, LinkDefinition>; body: string[] } {
	const defs = new Map<string, LinkDefinition>();
	const body: string[] = [];
	let fence: { char: string; length: number } | undefined;
	let inHtml: "block" | { suppressed: string } | undefined;
	for (const line of lines) {
		if (fence) {
			const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
			if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = undefined;
			body.push(line);
			continue;
		}
		if (inHtml) {
			if (inHtml === "block") {
				if (isBlank(line)) inHtml = undefined;
			} else if (closesSuppressed(line, inHtml.suppressed)) {
				inHtml = undefined;
			}
			body.push(line);
			continue;
		}
		const open = FENCE.exec(line);
		if (open) {
			fence = { char: open[1][0], length: open[1].length };
			body.push(line);
			continue;
		}
		const start = html ? htmlBlockStart(line) : undefined;
		if (start) {
			if (start.kind === "suppressed") {
				inHtml = closesSuppressed(line, start.name) ? undefined : { suppressed: start.name };
			} else {
				inHtml = "block";
			}
			body.push(line);
			continue;
		}
		const match = DEFINITION.exec(line);
		if (!match) {
			body.push(line);
			continue;
		}
		const key = referenceLabel(match[1]);
		if (!defs.has(key)) {
			const dest = match[2].startsWith("<") && match[2].endsWith(">") ? match[2].slice(1, -1) : match[2];
			defs.set(key, { dest, title: match[3] });
		}
		body.push("");
	}
	return { defs, body };
}

function isBlank(line: string): boolean {
	return line.trim() === "";
}

function stripIndent(line: string, columns: number): string {
	let index = 0;
	let width = 0;
	while (index < line.length && width < columns && line[index] === " ") {
		index++;
		width++;
	}
	return line.slice(index);
}

/**
 * Walk the kit's scan and emit HTML.
 *
 * The classification is `lib/web/markdown-blocks.ts`'s now: this half answers only what a
 * README's page decides — which tags are allowed (the `htmlEnd` hook), the anchor id a
 * heading gets, the `<pre class="md-code">` a fence is highlighted into, and the two rules
 * that are the page's rather than Markdown's: a delimiter row that does not match its header
 * is a paragraph, and a quote run crosses one blank line.
 */
function renderBlocks(lines: string[], ctx: Context): string {
	// A raw-HTML block runs as far as the allowlist says, and a suppressed element swallows
	// its body across blank lines. The scan asks; `raw-html.ts` answers.
	const blocks = scanBlocks(lines, ctx.html ? { htmlEnd: htmlBlockExtent } : {});
	const out: string[] = [];
	let i = 0;
	while (i < blocks.length) {
		const block = blocks[i] as MarkdownBlock;
		switch (block.kind) {
			case "blank":
				i += 1;
				break;
			case "fence":
				out.push(renderFence(block));
				i += 1;
				break;
			case "heading":
				out.push(renderHeadingBlock(block, ctx));
				i += 1;
				break;
			case "hr":
				out.push("<hr>");
				i += 1;
				break;
			case "html":
				out.push(renderHtmlBlock(block, ctx));
				i += 1;
				break;
			case "quote": {
				// A README's quote continues across one blank line; the scan keeps two blocks
				// because the review's anchors need every line accounted for.
				const inner = [...(block.quote ?? [])];
				while (i + 2 < blocks.length && blocks[i + 1]?.kind === "blank" && blocks[i + 2]?.kind === "quote") {
					inner.push("", ...((blocks[i + 2] as MarkdownBlock).quote ?? []));
					i += 2;
				}
				out.push(`<blockquote>${renderBlocks(inner, ctx)}</blockquote>`);
				i += 1;
				break;
			}
			case "list": {
				const [html, next] = renderList(blocks, i, ctx);
				out.push(html);
				i = next;
				break;
			}
			case "table":
				out.push(renderTable(block, ctx));
				i += 1;
				break;
			default:
				out.push(renderParagraph(block, ctx));
				i += 1;
		}
	}
	return out.join("\n");
}

/**
 * How far a raw-HTML block runs from `index`: to the next blank line for an allowed block, and
 * to its matching close tag for a suppressed one, blank lines included.
 */
function htmlBlockExtent(lines: readonly string[], index: number): number | undefined {
	const start = htmlBlockStart(lines[index] ?? "");
	if (start === undefined) return undefined;
	if (start.kind === "suppressed") {
		let i = index;
		while (i < lines.length && !closesSuppressed(lines[i] ?? "", start.name)) i += 1;
		return Math.min(i, lines.length - 1);
	}
	let i = index;
	while (i + 1 < lines.length && (lines[i + 1] ?? "").trim() !== "") i += 1;
	return i;
}

/** A paragraph's lines, escaped and joined: inline Markdown in, one `<p>` out. */
function renderParagraphOf(lines: string[], ctx: Context): string {
	const html = lines
		.map((line) => {
			let text = line.trimEnd();
			const hard = / {2}$/.test(line) || /\\$/.test(text);
			if (text.endsWith("\\")) text = text.slice(0, -1);
			const rendered = renderInline(text.trim(), ctx);
			return hard ? `${rendered}<br>` : rendered;
		})
		.join("\n");
	return `<p>${html}</p>`;
}

function renderParagraph(block: MarkdownBlock, ctx: Context): string {
	return renderParagraphOf(block.lines, ctx);
}

/** An allowed HTML block is sanitized and its tags tracked; a suppressed one emitted nothing. */
function renderHtmlBlock(block: MarkdownBlock, ctx: Context): string {
	const start = htmlBlockStart(block.lines[0] ?? "");
	if (start?.kind === "suppressed") return "";
	return sanitizeHtmlBlock(block.lines.join("\n"), ctx.link, ctx.sink);
}

/** A fence, highlighted through the same tokenizer the file view uses. */
function renderFence(block: MarkdownBlock): string {
	const info = block.fence?.info ?? "";
	const body = block.body ?? [];
	const language = info.split(/\s+/)[0] ?? "";
	const cls = language === "" ? "" : ` class="language-${escapeHtml(language)}"`;
	const highlighter = fenceLanguage(info);
	const code = highlighter === undefined ? escapeHtml(body.join("\n")) : highlightLines(body, highlighter).join("\n");
	return `<pre class="md-code"><code${cls}>${code}</code></pre>`;
}

/** A heading is demoted one level so the page keeps the only `h1`, and gets a stable anchor. */
function renderHeadingBlock(block: MarkdownBlock, ctx: Context): string {
	const level = Math.min((block.level ?? 1) + 1, 6);
	const text = block.text ?? "";
	const id = ctx.slug(text);
	return `<h${level} id="${id}">${renderInline(text, ctx)}</h${level}>`;
}

function alignmentClass(align: MarkdownAlign): string {
	if (align === "center") return ' class="md-center"';
	if (align === "right") return ' class="md-right"';
	if (align === "left") return ' class="md-left"';
	return "";
}

/**
 * A GFM table, or the paragraph the page makes of it when the delimiter row's cell count does
 * not match the header's — the one table rule that is the page's and not the scan's.
 */
function renderTable(block: MarkdownBlock, ctx: Context): string {
	const rows = block.cells ?? [];
	const header = rows[0] ?? [];
	const align = (block.align ?? []).map(alignmentClass);
	if (align.length !== header.length) return renderParagraphOf(block.lines, ctx);
	const head = header
		.map((cell, index) => `<th scope="col"${align[index] ?? ""}>${renderInline(cell, ctx)}</th>`)
		.join("");
	const body = rows.slice(1).map((cells) => {
		const tds: string[] = [];
		for (let column = 0; column < header.length; column++) {
			tds.push(`<td${align[column] ?? ""}>${renderInline(cells[column] ?? "", ctx)}</td>`);
		}
		return `<tr>${tds.join("")}</tr>`;
	});
	const table = `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table>`;
	// The frame is the positioning context for the right-edge fade the client adds when the
	// table scrolls; the scroller clips its own content, so the fade cannot live inside it.
	return `<div class="md-table-frame"><div class="md-table-wrap">${table}</div></div>`;
}

/**
 * Draw one list: a run of item blocks at the same indent and marker kind. A deeper item is its
 * own block from the scan, so it joins the item above it as content and is drawn by the same
 * scan one level down.
 */
function renderList(blocks: readonly MarkdownBlock[], start: number, ctx: Context): [string, number] {
	const first = blocks[start]?.item;
	const baseIndent = first?.indent ?? 0;
	const ordered = first?.ordered === true;
	const items: string[] = [];
	let i = start;
	while (i < blocks.length) {
		const block = blocks[i] as MarkdownBlock;
		const item = block.item;
		if (block.kind !== "list" || item === undefined) break;
		if (item.indent !== baseIndent || item.ordered !== ordered) break;
		const contentIndent = baseIndent + item.marker.length + 1;
		const content: string[] = [item.content];
		for (const line of block.lines.slice(1)) content.push(stripIndent(line, contentIndent));
		i += 1;
		while (i < blocks.length) {
			const nested = blocks[i] as MarkdownBlock;
			if (nested.kind !== "list" || (nested.item?.indent ?? 0) <= baseIndent) break;
			// Keep the item's own indentation so the scan one level down sees the same nesting.
			const indent = Math.max(0, (nested.item?.indent ?? 0) - contentIndent);
			content.push(" ".repeat(indent) + (nested.lines[0] ?? ""));
			content.push(...nested.lines.slice(1));
			i += 1;
		}
		items.push(renderListItem(item, content, ctx));
	}
	const tag = ordered ? "ol" : "ul";
	return [`<${tag}>${items.join("")}</${tag}>`, i];
}

/** One list item: its task box from the scan, and its body drawn as blocks of its own. */
function renderListItem(item: MarkdownListItem, content: string[], ctx: Context): string {
	const tight = !content.some(isBlank);
	let body = renderBlocks(content, ctx);
	if (tight) body = body.replace(/<\/?p>/g, "");
	const mark =
		item.task === null
			? ""
			: `<input class="md-check" type="checkbox" disabled${item.task === "done" ? " checked" : ""}> `;
	const cls = item.task === null ? "" : item.task === "done" ? ' class="task done"' : ' class="task"';
	return `<li${cls}>${mark}${body}</li>`;
}
