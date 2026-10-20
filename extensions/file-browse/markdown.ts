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
 * `lib/highlight.ts`, `urls.ts`, and `raw-html.ts`, so `html.ts` can compose it
 * without a module cycle. The block scanner, the inline scanner, and their
 * per-document state stay in one module because they are a single pass; URL
 * policy and raw HTML do not.
 */

import { escapeHtml } from "../../lib/escape.ts";
import { fenceLanguage, highlightLines } from "../../lib/highlight.ts";
import {
	closesSuppressed,
	closeHtmlSink,
	closeInlineTags,
	createHtmlSink,
	type HtmlBlockStart,
	type HtmlSink,
	htmlBlockStart,
	sanitizeHtmlBlock,
	sanitizeInlineTag,
} from "./raw-html.ts";
import { resolveImage, resolveLink } from "./urls.ts";

const HTTP_SCHEME = /^https?:/i;
/** A GFM extended autolink: `http(s)://` or `www.` followed by a domain. */
const AUTOLINK = /^(?:https?:\/\/|www\.)[^\s<>]*/i;

/** GFM starts an autolink at the line start or after whitespace or one of `*_~(`. */
function autolinkBoundary(text: string, index: number): boolean {
	return index === 0 || /[\s*_~(]/.test(text[index - 1]);
}

/** Drop the trailing punctuation GFM excludes, and an unclosed `)`. */
function trimAutolink(url: string): string {
	let end = url.replace(/[.,;:!?*_~]+$/, "");
	while (end.endsWith(")") && (end.match(/\(/g)?.length ?? 0) < (end.match(/\)/g)?.length ?? 0)) {
		end = end.slice(0, -1).replace(/[.,;:!?*_~]+$/, "");
	}
	return end;
}
/** A link reference definition: `[id]: dest "title"`. */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+["'(]([^"')]*)["')])?\s*$/;

interface LinkDefinition {
	dest: string;
	title?: string;
}

/**
 * Per-document render state: the resolution base, the reference definitions,
 * and the raw-HTML balancing state.
 */
interface Context {
	baseDir: string;
	defs: Map<string, LinkDefinition>;
	/** Emit sanitized raw HTML; `false` escapes it as text. */
	html: boolean;
	sink: HtmlSink;
	slug(text: string): string;
}

/** Render options; every field has the behaviour the browse page uses. */
export interface MarkdownOptions {
	/** Emit sanitized raw HTML (the default) or escape it (`false`). */
	html?: boolean;
}

/**
 * Render a Markdown source string to a safe HTML fragment. Headings carry an
 * anchor id and are demoted one level, so the embedding page keeps the only
 * `h1`.
 */
export function renderMarkdown(source: string, baseDir = "", options: MarkdownOptions = {}): string {
	const html = options.html ?? true;
	const { defs, body } = collectDefinitions(source.split(/\r\n|\r|\n/), html);
	const context = createContext(baseDir, defs, html);
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
function createContext(baseDir: string, defs: Map<string, LinkDefinition>, html: boolean): Context {
	const seen = new Map<string, number>();
	return {
		baseDir,
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

/** Fold a reference label the way CommonMark does: trim, collapse, case-fold. */
function normalizeLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
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
	let fence: Fence | undefined;
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
		const open = matchFence(line);
		if (open) {
			fence = open;
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
		const key = normalizeLabel(match[1]);
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

function indentOf(line: string): number {
	let width = 0;
	for (const char of line) {
		if (char === " ") width++;
		else if (char === "\t") width += 4;
		else break;
	}
	return width;
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

function renderBlocks(lines: string[], ctx: Context): string {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (isBlank(line)) {
			i++;
			continue;
		}

		const fence = matchFence(line);
		if (fence) {
			const [html, next] = renderFence(lines, i, fence);
			out.push(html);
			i = next;
			continue;
		}

		const heading = matchHeading(line);
		if (heading) {
			const level = Math.min(heading.level + 1, 6);
			const id = ctx.slug(heading.text);
			out.push(`<h${level} id="${id}">${renderInline(heading.text, ctx)}</h${level}>`);
			i++;
			continue;
		}

		if (isThematicBreak(line)) {
			out.push("<hr>");
			i++;
			continue;
		}

		if (isBlockquoteLine(line)) {
			const [html, next] = renderBlockquote(lines, i, ctx);
			out.push(html);
			i = next;
			continue;
		}

		// A list marker wins over a pipe, so `- | a | b |` stays a list item
		// instead of becoming a table whose first cell is `-`.
		if (matchListItem(line)) {
			const [html, next] = renderList(lines, i, ctx);
			out.push(html);
			i = next;
			continue;
		}

		if (i + 1 < lines.length && isTableStart(line, lines[i + 1])) {
			const [html, next] = renderTable(lines, i, ctx);
			out.push(html);
			i = next;
			continue;
		}

		const htmlBlock = ctx.html ? htmlBlockStart(line) : undefined;
		if (htmlBlock) {
			const [html, next] = renderHtmlBlock(lines, i, htmlBlock, ctx);
			if (html !== "") out.push(html);
			i = next;
			continue;
		}

		const [html, next] = renderParagraph(lines, i, ctx);
		out.push(html);
		i = next;
	}
	return out.join("\n");
}

/** True when `lines[i]` opens a block that may interrupt a paragraph. */
function isBlockStart(lines: string[], i: number, html: boolean): boolean {
	const line = lines[i];
	return (
		matchFence(line) !== undefined ||
		matchHeading(line) !== undefined ||
		isThematicBreak(line) ||
		isBlockquoteLine(line) ||
		matchListItem(line) !== undefined ||
		(html && htmlBlockStart(line) !== undefined) ||
		(i + 1 < lines.length && isTableStart(line, lines[i + 1]))
	);
}

function renderParagraph(lines: string[], start: number, ctx: Context): [string, number] {
	const collected: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		if (isBlank(lines[i])) break;
		if (i > start && isBlockStart(lines, i, ctx.html)) break;
		collected.push(lines[i]);
	}
	const html = collected
		.map((line) => {
			let text = line.trimEnd();
			const hard = / {2}$/.test(line) || /\\$/.test(text);
			if (text.endsWith("\\")) text = text.slice(0, -1);
			const rendered = renderInline(text.trim(), ctx);
			return hard ? `${rendered}<br>` : rendered;
		})
		.join("\n");
	return [`<p>${html}</p>`, i];
}

/**
 * Render an HTML block. An allowed block runs to the next blank line, matching
 * what a reader expects from GitHub: everything up to the blank line is markup,
 * and Markdown resumes after it. A suppressed element (`<script>`, `<svg>`, …)
 * swallows its body through the matching close tag, crossing blank lines, and
 * emits nothing.
 */
function renderHtmlBlock(lines: string[], start: number, block: HtmlBlockStart, ctx: Context): [string, number] {
	if (block.kind === "suppressed") {
		let i = start;
		while (i < lines.length && !closesSuppressed(lines[i], block.name)) i++;
		return ["", Math.min(i + 1, lines.length)];
	}
	const collected: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		if (isBlank(lines[i])) break;
		collected.push(lines[i]);
	}
	return [sanitizeHtmlBlock(collected.join("\n"), ctx.baseDir, ctx.sink), i];
}

interface Fence {
	char: string;
	length: number;
	info: string;
}

function matchFence(line: string): Fence | undefined {
	const match = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/.exec(line);
	if (!match) return undefined;
	return { char: match[1][0], length: match[1].length, info: match[2].trim() };
}

function renderFence(lines: string[], start: number, fence: Fence): [string, number] {
	const body: string[] = [];
	let i = start + 1;
	for (; i < lines.length; i++) {
		const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
		if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
			i++;
			break;
		}
		body.push(lines[i]);
	}
	const language = fence.info.split(/\s+/)[0] ?? "";
	const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
	const highlighter = fenceLanguage(fence.info);
	const code = highlighter ? highlightLines(body, highlighter).join("\n") : escapeHtml(body.join("\n"));
	return [`<pre class="md-code"><code${cls}>${code}</code></pre>`, i];
}

function matchHeading(line: string): { level: number; text: string } | undefined {
	const match = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
	if (!match) return undefined;
	return { level: match[1].length, text: match[2] ?? "" };
}

function isThematicBreak(line: string): boolean {
	return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function isBlockquoteLine(line: string): boolean {
	return /^ {0,3}>/.test(line);
}

function renderBlockquote(lines: string[], start: number, ctx: Context): [string, number] {
	const inner: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		const match = /^ {0,3}>\s?(.*)$/.exec(lines[i]);
		if (match) {
			inner.push(match[1]);
			continue;
		}
		if (isBlank(lines[i]) && i + 1 < lines.length && isBlockquoteLine(lines[i + 1])) {
			inner.push("");
			continue;
		}
		break;
	}
	return [`<blockquote>${renderBlocks(inner, ctx)}</blockquote>`, i];
}

function splitTableRow(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i];
		if (char === "\\" && trimmed[i + 1] === "|") {
			current += "|";
			i++;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

function isTableStart(header: string, delimiter: string): boolean {
	if (!header.includes("|")) return false;
	const cells = splitTableRow(delimiter);
	// GFM requires the delimiter row to match the header row's cell count;
	// otherwise the lines are a paragraph, not a table.
	if (cells.length === 0 || cells.length !== splitTableRow(header).length) return false;
	return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function alignmentClass(cell: string): string {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return ' class="md-center"';
	if (right) return ' class="md-right"';
	if (left) return ' class="md-left"';
	return "";
}

function renderTable(lines: string[], start: number, ctx: Context): [string, number] {
	const header = splitTableRow(lines[start]);
	const align = splitTableRow(lines[start + 1]).map(alignmentClass);
	const head = header
		.map((cell, index) => `<th scope="col"${align[index] ?? ""}>${renderInline(cell, ctx)}</th>`)
		.join("");
	const rows: string[] = [];
	let i = start + 2;
	for (; i < lines.length; i++) {
		if (isBlank(lines[i]) || !lines[i].includes("|")) break;
		const cells = splitTableRow(lines[i]);
		const tds: string[] = [];
		for (let column = 0; column < header.length; column++) {
			tds.push(`<td${align[column] ?? ""}>${renderInline(cells[column] ?? "", ctx)}</td>`);
		}
		rows.push(`<tr>${tds.join("")}</tr>`);
	}
	const table = `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
	return [`<div class="md-table-wrap">${table}</div>`, i];
}

interface ListItem {
	indent: number;
	ordered: boolean;
	markerWidth: number;
	content: string;
}

function matchListItem(line: string): ListItem | undefined {
	const match = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
	if (!match) return undefined;
	return {
		indent: match[1].length,
		ordered: /\d/.test(match[2]),
		markerWidth: match[2].length,
		content: match[4],
	};
}

function renderList(lines: string[], start: number, ctx: Context): [string, number] {
	const first = matchListItem(lines[start]);
	if (!first) return renderParagraph(lines, start, ctx);
	const baseIndent = first.indent;
	const ordered = first.ordered;
	const items: string[] = [];
	let i = start;
	while (i < lines.length) {
		const match = matchListItem(lines[i]);
		if (!match || match.indent !== baseIndent || match.ordered !== ordered) break;
		const contentLines: string[] = [match.content];
		const contentIndent = baseIndent + match.markerWidth + 1;
		i++;
		while (i < lines.length) {
			const next = lines[i];
			if (isBlank(next)) {
				let j = i;
				while (j < lines.length && isBlank(lines[j])) j++;
				if (j < lines.length && indentOf(lines[j]) >= contentIndent) {
					for (; i < j; i++) contentLines.push("");
					continue;
				}
				break;
			}
			const nextItem = matchListItem(next);
			if (nextItem && nextItem.indent <= baseIndent) break;
			if (indentOf(next) >= contentIndent) {
				contentLines.push(stripIndent(next, contentIndent));
				i++;
				continue;
			}
			if (!nextItem && indentOf(next) > baseIndent) {
				contentLines.push(next.trim());
				i++;
				continue;
			}
			break;
		}
		items.push(renderListItem(contentLines, ctx));
	}
	const tag = ordered ? "ol" : "ul";
	return [`<${tag}>${items.join("")}</${tag}>`, i];
}

function renderListItem(contentLines: string[], ctx: Context): string {
	const task = /^\[([ xX])\]\s*(.*)$/.exec(contentLines[0] ?? "");
	const done = task ? task[1].toLowerCase() === "x" : false;
	const source = task ? [task[2], ...contentLines.slice(1)] : contentLines;
	const tight = !source.some(isBlank);
	let body = renderBlocks(source, ctx);
	if (tight) body = body.replace(/<\/?p>/g, "");
	const mark = task ? `<input class="md-check" type="checkbox" disabled${done ? " checked" : ""}> ` : "";
	return `<li${task ? (done ? ` class="task done"` : ` class="task"`) : ""}>${mark}${body}</li>`;
}

interface ParsedLink {
	label: string;
	dest: string;
	title?: string;
	end: number;
}

/** The index of the `]` closing the bracket run opened at `start`, or -1. */
function matchBracket(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function parseInlineLink(text: string, start: number): ParsedLink | undefined {
	if (text[start] !== "[") return undefined;
	const i = matchBracket(text, start);
	if (i === -1 || text[i + 1] !== "(") return undefined;
	const label = text.slice(start + 1, i);
	let j = i + 2;
	while (j < text.length && /\s/.test(text[j])) j++;
	let dest = "";
	if (text[j] === "<") {
		const end = text.indexOf(">", j + 1);
		if (end === -1) return undefined;
		dest = text.slice(j + 1, end);
		j = end + 1;
	} else {
		let parens = 0;
		while (j < text.length) {
			const char = text[j];
			if (char === "(") {
				parens++;
				dest += char;
				j++;
				continue;
			}
			if (char === ")") {
				if (parens === 0) break;
				parens--;
				dest += char;
				j++;
				continue;
			}
			if (/\s/.test(char)) break;
			dest += char;
			j++;
		}
	}
	while (j < text.length && /\s/.test(text[j])) j++;
	let title: string | undefined;
	if (text[j] === '"' || text[j] === "'") {
		const end = text.indexOf(text[j], j + 1);
		if (end !== -1) {
			title = text.slice(j + 1, end);
			j = end + 1;
		}
	}
	while (j < text.length && /\s/.test(text[j])) j++;
	if (text[j] !== ")") return undefined;
	return { label, dest, title, end: j + 1 };
}

/**
 * Resolve `[label][id]`, `[label][]`, or `[label]` against the document's
 * reference definitions, preferring the full form and falling back to the
 * shortcut so `[foo][bar]` still resolves `[foo]` when only that is defined.
 */
function parseReferenceLink(text: string, start: number, ctx: Context): ParsedLink | undefined {
	if (text[start] !== "[") return undefined;
	const close = matchBracket(text, start);
	if (close === -1 || text[close + 1] === "(") return undefined;
	const label = text.slice(start + 1, close);
	if (text[close + 1] === "[") {
		const end = matchBracket(text, close + 1);
		if (end !== -1) {
			const raw = text.slice(close + 2, end);
			const def = ctx.defs.get(normalizeLabel(raw === "" ? label : raw));
			if (def) return { label, dest: def.dest, title: def.title, end: end + 1 };
		}
	}
	const def = ctx.defs.get(normalizeLabel(label));
	if (def) return { label, dest: def.dest, title: def.title, end: close + 1 };
	return undefined;
}

function renderLink(parsed: ParsedLink, ctx: Context): string {
	const label = renderInline(parsed.label, ctx);
	const target = resolveLink(parsed.dest, ctx.baseDir);
	if (!target) return label;
	const title = parsed.title ? ` title="${escapeHtml(parsed.title)}"` : "";
	const external = target.external ? ` target="_blank" rel="noopener noreferrer"` : "";
	return `<a href="${escapeHtml(target.href)}"${title}${external}>${label}</a>`;
}

function renderImage(parsed: ParsedLink, ctx: Context): string {
	const alt = escapeHtml(parsed.label);
	const target = resolveImage(parsed.dest, ctx.baseDir);
	if (!target) return alt;
	if (!target.image) {
		return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer">${alt || escapeHtml(parsed.dest)}</a>`;
	}
	const title = parsed.title ? ` title="${escapeHtml(parsed.title)}"` : "";
	return `<img class="md-img" src="${escapeHtml(target.href)}" alt="${alt}" loading="lazy" decoding="async"${title}>`;
}

function matchRun(text: string, start: number, char: string): number {
	let length = 0;
	while (text[start + length] === char) length++;
	return length;
}

/** The closing delimiter for `*`/`_`, honouring intraword rules for `_`. */
function findEmphasisClose(text: string, start: number, char: string): number {
	const next = text[start + 1];
	if (next === undefined || /\s/.test(next)) return -1;
	if (char === "_") {
		const before = start > 0 ? text[start - 1] : "";
		if (before && /[\w]/.test(before)) return -1;
	}
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] !== char) continue;
		const before = text[i - 1];
		if (before === undefined || /\s/.test(before)) continue;
		const after = text[i + 1];
		if (char === "_" && after !== undefined && /[\w]/.test(after)) continue;
		return i;
	}
	return -1;
}

/**
 * The named character references common enough to matter in a README. Anything
 * outside this set stays literal; numeric references are always decoded.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	times: "×",
	divide: "÷",
	middot: "·",
	bull: "•",
	deg: "°",
	plusmn: "±",
	dagger: "†",
	sect: "§",
	para: "¶",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	larr: "←",
	rarr: "→",
	harr: "↔",
	le: "≤",
	ge: "≥",
	ne: "≠",
	asymp: "≈",
	sup2: "²",
	sup3: "³",
	frac12: "½",
	frac14: "¼",
	frac34: "¾",
};

interface Entity {
	value: string;
	length: number;
}

/** A code point, or U+FFFD when the reference is a surrogate or out of range. */
function codePoint(value: number): string {
	if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
		return "\uFFFD";
	return String.fromCodePoint(value);
}

/**
 * Match a numeric or named character reference at `start`. Decoding happens in
 * the inline scanner rather than a pre-pass so an entity cannot become Markdown
 * syntax: `&#42;x&#42;` stays the literal text `*x*`.
 */
function matchEntity(text: string, start: number): Entity | undefined {
	const match = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/.exec(text.slice(start));
	if (!match) return undefined;
	let value: string | undefined;
	if (match[1] !== undefined) value = codePoint(Number(match[1]));
	else if (match[2] !== undefined) value = codePoint(Number.parseInt(match[2], 16));
	else if (match[3] !== undefined && Object.hasOwn(NAMED_ENTITIES, match[3])) value = NAMED_ENTITIES[match[3]];
	if (value === undefined) return undefined;
	return { value, length: match[0].length };
}

/** Render inline Markdown within a block, escaping every literal character. */
function renderInline(text: string, ctx: Context): string {
	let out = "";
	let i = 0;
	const tags: string[] = [];
	while (i < text.length) {
		const char = text[i];

		if (char === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(text[i + 1])) {
			out += escapeHtml(text[i + 1]);
			i += 2;
			continue;
		}

		if (char === "&") {
			const entity = matchEntity(text, i);
			if (entity) {
				out += escapeHtml(entity.value);
				i += entity.length;
				continue;
			}
		}

		if (char === "`") {
			const run = matchRun(text, i, "`");
			const close = text.indexOf("`".repeat(run), i + run);
			if (close !== -1) {
				let code = text.slice(i + run, close);
				if (code.startsWith(" ") && code.endsWith(" ") && code.trim().length > 0) code = code.slice(1, -1);
				out += `<code>${escapeHtml(code)}</code>`;
				i = close + run;
				continue;
			}
		}

		if (char === "!" && text[i + 1] === "[") {
			const parsed = parseInlineLink(text, i + 1) ?? parseReferenceLink(text, i + 1, ctx);
			if (parsed) {
				out += renderImage(parsed, ctx);
				i = parsed.end;
				continue;
			}
		}

		if (char === "[") {
			const parsed = parseInlineLink(text, i) ?? parseReferenceLink(text, i, ctx);
			if (parsed) {
				out += renderLink(parsed, ctx);
				i = parsed.end;
				continue;
			}
		}

		if (char === "<") {
			const match = /^<((?:https?|mailto):[^>\s]+)>/i.exec(text.slice(i));
			if (match) {
				const href = match[1];
				const external = HTTP_SCHEME.test(href) ? ` target="_blank" rel="noopener noreferrer"` : "";
				out += `<a href="${escapeHtml(href)}"${external}>${escapeHtml(href)}</a>`;
				i += match[0].length;
				continue;
			}
			if (ctx.html) {
				const tag = sanitizeInlineTag(text, i, ctx.baseDir, tags);
				if (tag) {
					out += tag.html;
					i = tag.end;
					continue;
				}
			}
		}

		// GFM extended autolink: a bare `https://` or `www.` URL in running text.
		if ((char === "h" || char === "H" || char === "w" || char === "W") && autolinkBoundary(text, i)) {
			const match = AUTOLINK.exec(text.slice(i));
			if (match) {
				const label = trimAutolink(match[0]);
				const dots = label.indexOf(".");
				// Require a domain, so a bare scheme is not a link.
				if (dots > 0 && /\.[^./]/.test(label.slice(dots))) {
					const href = /^www\./i.test(label) ? `http://${label}` : label;
					const external = HTTP_SCHEME.test(href) ? ` target="_blank" rel="noopener noreferrer"` : "";
					out += `<a href="${escapeHtml(href)}"${external}>${escapeHtml(label)}</a>`;
					i += label.length;
					continue;
				}
			}
		}

		if ((char === "*" || char === "_") && text[i + 1] === char) {
			const close = text.indexOf(char + char, i + 2);
			if (close > i + 2) {
				out += `<strong>${renderInline(text.slice(i + 2, close), ctx)}</strong>`;
				i = close + 2;
				continue;
			}
		}

		if (char === "~" && text[i + 1] === "~") {
			const close = text.indexOf("~~", i + 2);
			if (close > i + 2) {
				out += `<del>${renderInline(text.slice(i + 2, close), ctx)}</del>`;
				i = close + 2;
				continue;
			}
		}

		if (char === "*" || char === "_") {
			const close = findEmphasisClose(text, i, char);
			if (close > i + 1) {
				out += `<em>${renderInline(text.slice(i + 1, close), ctx)}</em>`;
				i = close + 1;
				continue;
			}
		}

		out += escapeHtml(char);
		i++;
	}
	return out + closeInlineTags(tags);
}
