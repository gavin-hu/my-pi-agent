/**
 * A small, escape-first Markdown renderer for the serve file view.
 *
 * It is deliberately not CommonMark: it covers the block and inline constructs
 * that show up in repository READMEs — headings, paragraphs, fenced code,
 * blockquotes, nested and task lists, tables, code spans, emphasis, links, and
 * images. Everything is escaped and only a known set of tags is emitted; raw
 * HTML in the source is shown as text, never executed.
 *
 * Relative links become `/view/<path>` and relative images become `/raw/<path>`
 * so they resolve from any page URL. The `/view` and `/raw` routes re-vet the
 * path at fetch time, so resolution here only has to avoid obvious escapes.
 * External images are rendered as links (the page CSP is `img-src 'self' data:`)
 * and non-http(s) schemes such as `javascript:` are dropped.
 *
 * Kept free of the page renderer: it imports only `escape.ts` and `paths.ts`, so
 * `html.ts` can compose it without a module cycle.
 */

import { posix } from "node:path";
import { escapeHtml } from "./escape.ts";
import { encodePath } from "./paths.ts";

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_LINK_SCHEME = /^(?:https?|mailto):/i;
const HTTP_SCHEME = /^https?:/i;

/** Render a Markdown source string to a safe HTML fragment. */
export function renderMarkdown(source: string, baseDir = ""): string {
	return renderBlocks(source.split(/\r\n|\r|\n/), baseDir);
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

function renderBlocks(lines: string[], baseDir: string): string {
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
			out.push(`<h${heading.level}>${renderInline(heading.text, baseDir)}</h${heading.level}>`);
			i++;
			continue;
		}

		if (isThematicBreak(line)) {
			out.push("<hr>");
			i++;
			continue;
		}

		if (isBlockquoteLine(line)) {
			const [html, next] = renderBlockquote(lines, i, baseDir);
			out.push(html);
			i = next;
			continue;
		}

		if (i + 1 < lines.length && isTableStart(line, lines[i + 1])) {
			const [html, next] = renderTable(lines, i, baseDir);
			out.push(html);
			i = next;
			continue;
		}

		if (matchListItem(line)) {
			const [html, next] = renderList(lines, i, baseDir);
			out.push(html);
			i = next;
			continue;
		}

		const [html, next] = renderParagraph(lines, i, baseDir);
		out.push(html);
		i = next;
	}
	return out.join("\n");
}

/** True when `lines[i]` opens a block that may interrupt a paragraph. */
function isBlockStart(lines: string[], i: number): boolean {
	const line = lines[i];
	return (
		matchFence(line) !== undefined ||
		matchHeading(line) !== undefined ||
		isThematicBreak(line) ||
		isBlockquoteLine(line) ||
		matchListItem(line) !== undefined ||
		(i + 1 < lines.length && isTableStart(line, lines[i + 1]))
	);
}

function renderParagraph(lines: string[], start: number, baseDir: string): [string, number] {
	const collected: string[] = [];
	let i = start;
	for (; i < lines.length; i++) {
		if (isBlank(lines[i])) break;
		if (i > start && isBlockStart(lines, i)) break;
		collected.push(lines[i]);
	}
	const html = collected
		.map((line) => {
			let text = line.trimEnd();
			const hard = / {2}$/.test(line) || /\\$/.test(text);
			if (text.endsWith("\\")) text = text.slice(0, -1);
			const rendered = renderInline(text.trim(), baseDir);
			return hard ? `${rendered}<br>` : rendered;
		})
		.join("\n");
	return [`<p>${html}</p>`, i];
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
	return [`<pre class="md-code"><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`, i];
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

function renderBlockquote(lines: string[], start: number, baseDir: string): [string, number] {
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
	return [`<blockquote>${renderBlocks(inner, baseDir)}</blockquote>`, i];
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
	return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function alignmentClass(cell: string): string {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return ' class="md-center"';
	if (right) return ' class="md-right"';
	if (left) return ' class="md-left"';
	return "";
}

function renderTable(lines: string[], start: number, baseDir: string): [string, number] {
	const header = splitTableRow(lines[start]);
	const align = splitTableRow(lines[start + 1]).map(alignmentClass);
	const head = header.map((cell, index) => `<th${align[index] ?? ""}>${renderInline(cell, baseDir)}</th>`).join("");
	const rows: string[] = [];
	let i = start + 2;
	for (; i < lines.length; i++) {
		if (isBlank(lines[i]) || !lines[i].includes("|")) break;
		const cells = splitTableRow(lines[i]);
		const tds: string[] = [];
		for (let column = 0; column < header.length; column++) {
			tds.push(`<td${align[column] ?? ""}>${renderInline(cells[column] ?? "", baseDir)}</td>`);
		}
		rows.push(`<tr>${tds.join("")}</tr>`);
	}
	return [`<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`, i];
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

function renderList(lines: string[], start: number, baseDir: string): [string, number] {
	const first = matchListItem(lines[start]);
	if (!first) return renderParagraph(lines, start, baseDir);
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
		items.push(renderListItem(contentLines, baseDir));
	}
	const tag = ordered ? "ol" : "ul";
	return [`<${tag}>${items.join("")}</${tag}>`, i];
}

function renderListItem(contentLines: string[], baseDir: string): string {
	const task = /^\[([ xX])\]\s*(.*)$/.exec(contentLines[0] ?? "");
	const done = task ? task[1].toLowerCase() === "x" : false;
	const source = task ? [task[2], ...contentLines.slice(1)] : contentLines;
	const tight = !source.some(isBlank);
	let body = renderBlocks(source, baseDir);
	if (tight) body = body.replace(/<\/?p>/g, "");
	const mark = task ? `<span class="md-check" aria-hidden="true">${done ? "☑" : "☐"}</span> ` : "";
	return `<li${task ? (done ? ` class="task done"` : ` class="task"`) : ""}>${mark}${body}</li>`;
}

interface ParsedLink {
	label: string;
	dest: string;
	title?: string;
	end: number;
}

function parseInlineLink(text: string, start: number): ParsedLink | undefined {
	if (text[start] !== "[") return undefined;
	let depth = 0;
	let i = start;
	for (; i < text.length; i++) {
		const char = text[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) break;
		}
	}
	if (i >= text.length || text[i] !== "]" || text[i + 1] !== "(") return undefined;
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

interface ResolvedLink {
	href: string;
	external: boolean;
}

interface ResolvedImage {
	href: string;
	image: boolean;
}

function resolveLocalPath(href: string, baseDir: string): { rel: string; suffix: string } | undefined {
	const match = /^([^?#]*)([?#].*)?$/.exec(href);
	if (!match) return undefined;
	const rawPath = match[1];
	const suffix = match[2] ?? "";
	let path: string;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		path = rawPath;
	}
	let rel: string;
	if (path.startsWith("/")) rel = posix.normalize(path).replace(/^\/+/, "");
	else rel = posix.normalize(posix.join(baseDir, path));
	if (rel === ".") rel = "";
	if (rel === ".." || rel.startsWith("../") || rel.startsWith("/")) return undefined;
	return { rel, suffix };
}

function resolveLink(dest: string, baseDir: string): ResolvedLink | undefined {
	const value = dest.trim();
	if (value === "") return undefined;
	if (value.startsWith("#")) return { href: value, external: false };
	if (SAFE_LINK_SCHEME.test(value)) return { href: value, external: HTTP_SCHEME.test(value) };
	if (HAS_SCHEME.test(value)) return undefined;
	const local = resolveLocalPath(value, baseDir);
	if (!local) return undefined;
	return { href: `/view/${encodePath(local.rel)}${local.suffix}`, external: false };
}

function resolveImage(dest: string, baseDir: string): ResolvedImage | undefined {
	const value = dest.trim();
	if (value === "") return undefined;
	if (HTTP_SCHEME.test(value)) return { href: value, image: false };
	if (HAS_SCHEME.test(value)) return undefined;
	const local = resolveLocalPath(value, baseDir);
	if (!local) return undefined;
	return { href: `/raw/${encodePath(local.rel)}${local.suffix}`, image: true };
}

function renderLink(parsed: ParsedLink, baseDir: string): string {
	const label = renderInline(parsed.label, baseDir);
	const target = resolveLink(parsed.dest, baseDir);
	if (!target) return label;
	const title = parsed.title ? ` title="${escapeHtml(parsed.title)}"` : "";
	const external = target.external ? ` target="_blank" rel="noopener noreferrer"` : "";
	return `<a href="${escapeHtml(target.href)}"${title}${external}>${label}</a>`;
}

function renderImage(parsed: ParsedLink, baseDir: string): string {
	const alt = escapeHtml(parsed.label);
	const target = resolveImage(parsed.dest, baseDir);
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

/** Render inline Markdown within a block, escaping every literal character. */
function renderInline(text: string, baseDir: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const char = text[i];

		if (char === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(text[i + 1])) {
			out += escapeHtml(text[i + 1]);
			i += 2;
			continue;
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
			const parsed = parseInlineLink(text, i + 1);
			if (parsed) {
				out += renderImage(parsed, baseDir);
				i = parsed.end;
				continue;
			}
		}

		if (char === "[") {
			const parsed = parseInlineLink(text, i);
			if (parsed) {
				out += renderLink(parsed, baseDir);
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
		}

		if ((char === "*" || char === "_") && text[i + 1] === char) {
			const close = text.indexOf(char + char, i + 2);
			if (close > i + 2) {
				out += `<strong>${renderInline(text.slice(i + 2, close), baseDir)}</strong>`;
				i = close + 2;
				continue;
			}
		}

		if (char === "~" && text[i + 1] === "~") {
			const close = text.indexOf("~~", i + 2);
			if (close > i + 2) {
				out += `<del>${renderInline(text.slice(i + 2, close), baseDir)}</del>`;
				i = close + 2;
				continue;
			}
		}

		if (char === "*" || char === "_") {
			const close = findEmphasisClose(text, i, char);
			if (close > i + 1) {
				out += `<em>${renderInline(text.slice(i + 1, close), baseDir)}</em>`;
				i = close + 1;
				continue;
			}
		}

		out += escapeHtml(char);
		i++;
	}
	return out;
}
