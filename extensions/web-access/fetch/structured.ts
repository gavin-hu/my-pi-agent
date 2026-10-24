/**
 * Render a structured body — JSON, CSV, or XML — as readable text.
 *
 * `web_fetch` used to hand these back as the blob it downloaded: a page a reader
 * has to parse in their head. This turns one into the shape a model reads best —
 * a table for records, indented keys for an object, an indented tree for XML — and
 * declines anything it cannot read, so the caller keeps the raw body and nothing
 * usable is lost.
 *
 * A source cap keeps an oversized response out: past it the raw body, which pages,
 * reads better than a rendered one. A rendered-character cap keeps one answer from
 * doubling the cache, and the note says where it stopped. Nothing here throws —
 * every failure is `undefined`, which `page.ts` reads as "return the body
 * unchanged".
 *
 * The declared content type decides first. A body that declares nothing usable is
 * sniffed only when it has a shape — an opening brace, a uniform comma count, a
 * root tag — because a plain-text page is the common case and a mangled table is
 * worse than a blob.
 */

import { asRecord } from "../../../lib/config.ts";
import { decodeEntities } from "../html.ts";
import { charLength, sliceChars } from "../text.ts";

/** Past this, the raw body — which pages — is the better answer. */
const MAX_SOURCE_CHARS = 1_048_576;

/** Rendered characters before the cut; the cached text pays this too. */
const MAX_RENDERED_CHARS = 60_000;

/** One level of nesting, and the gap between two table columns. */
const INDENT = "  ";

/** A table cell is one line, so a nested value is compacted to about this width. */
const CELL_CHARS = 40;

/** A list short enough to sit on one line with its key. */
const INLINE_LIST_CHARS = 80;

/**
 * Render a body as text, or `undefined` when it is not one this module reads.
 */
export function renderStructured(body: string, contentType: string): string | undefined {
	if (body.length > MAX_SOURCE_CHARS) return undefined;
	const declared = contentType.toLowerCase();
	if (isJsonType(declared)) return renderJson(body);
	if (isCsvType(declared)) return renderCsv(body);
	if (isXmlType(declared)) return renderXml(body);

	if (looksLikeJson(body)) return renderJson(body);
	if (looksLikeCsv(body)) return renderCsv(body);
	if (looksLikeXml(body)) return renderXml(body);
	return undefined;
}

function isJsonType(contentType: string): boolean {
	return /json/.test(contentType);
}

function isCsvType(contentType: string): boolean {
	return /csv/.test(contentType);
}

function isXmlType(contentType: string): boolean {
	return /xml/.test(contentType);
}

function looksLikeJson(body: string): boolean {
	return /^\s*[[{]/.test(body);
}

/** Uniformly comma-separated lines, which is the shape a plain-text export has. */
function looksLikeCsv(body: string): boolean {
	const lines = body.split(/\r?\n/).filter((line) => line.trim() !== "");
	if (lines.length < 2) return false;
	const commas = lines[0].split(",").length - 1;
	return commas > 0 && lines.every((line) => line.split(",").length - 1 === commas);
}

function looksLikeXml(body: string): boolean {
	return /^\s*<(\?xml\b|[A-Za-z_])/.test(body) && body.includes("</");
}

/** The rendered lines, what they cost, and whether the cap cut anything. */
interface Output {
	lines: string[];
	used: number;
	cut: boolean;
}

function createOutput(): Output {
	return { lines: [], used: 0, cut: false };
}

/** Append one line within the cap; `false` means the caller should stop. */
function emit(out: Output, line: string): boolean {
	const cost = line.length + 1;
	if (out.used + cost > MAX_RENDERED_CHARS) {
		out.cut = true;
		return false;
	}
	out.lines.push(line);
	out.used += cost;
	return true;
}

function emitAt(out: Output, text: string, depth: number): boolean {
	return emit(out, `${INDENT.repeat(depth)}${text}`);
}

/** The rendered text, with one note when the cap stopped it early. */
function finish(out: Output, body: string): string {
	const text = out.lines.join("\n");
	if (!out.cut) return text;
	return `${text}\n\n… (rendered ${out.used} characters of a ${body.length}-character body; the rest was cut)`;
}

/** One line for a value: a string's own line breaks become spaces. */
function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, " ");
}

/** Collapse a text node or an attribute to one line. */
function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** A value JSON stores as one atom: no nesting to walk. */
function isScalar(value: unknown): boolean {
	return value === null || typeof value !== "object";
}

function isScalarList(value: readonly unknown[]): boolean {
	return value.every(isScalar);
}

function isRecordList(value: readonly unknown[]): value is readonly Record<string, unknown>[] {
	return value.every((item) => {
		const record = asRecord(item);
		return record !== undefined && Object.keys(record).length > 0;
	});
}

/** One line of text for a scalar; a string's own line breaks become spaces. */
function scalarText(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return oneLine(value);
	return String(value);
}

/** A table cell: a nested value is compacted and clipped. */
function cellText(value: unknown): string {
	if (value === undefined) return "";
	if (isScalar(value)) return scalarText(value);
	const compact = JSON.stringify(value) ?? "";
	return charLength(compact) <= CELL_CHARS ? compact : `${sliceChars(compact, 0, CELL_CHARS)}…`;
}

/**
 * Lines as a table: each column padded to its widest cell, two spaces between
 * columns, no padding after the last one. Ragged rows are padded with empty cells,
 * so a short record still lines up instead of shifting the columns after it.
 */
function renderGrid(rows: readonly (readonly string[])[], depth: number, out: Output): void {
	const columns = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
	const widths = Array.from({ length: columns }, (_unused, column) =>
		rows.reduce((widest, row) => Math.max(widest, charLength(row[column] ?? "")), 0),
	);

	for (const row of rows) {
		const line: string[] = [];
		for (let column = 0; column < columns; column++) {
			const value = oneLine(row[column] ?? "");
			line.push(column === columns - 1 ? value : value + " ".repeat(widths[column] - charLength(value)));
		}
		if (!emitAt(out, line.join(INDENT).trimEnd(), depth)) return;
	}
}

/** Records as a table: the union of their keys, so one record's extra key shows. */
function renderTable(rows: readonly Record<string, unknown>[], depth: number, out: Output): void {
	const header: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row)) if (!header.includes(key)) header.push(key);
	}
	const cells = rows.map((row) => header.map((key) => cellText(row[key])));
	renderGrid([header, ...cells], depth, out);
}

/**
 * The one-line form of a value, when it has one: a scalar, an empty container, or
 * a short list. `undefined` means it needs its own block.
 */
function inlineValue(value: unknown): string | undefined {
	if (isScalar(value)) return scalarText(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		if (!isScalarList(value)) return undefined;
		const text = `[${value.map(scalarText).join(", ")}]`;
		return charLength(text) <= INLINE_LIST_CHARS ? text : undefined;
	}
	// Only an empty object has a one-line form; anything else needs a block.
	const record = asRecord(value);
	return record !== undefined && Object.keys(record).length === 0 ? "{}" : undefined;
}

function renderValue(value: unknown, depth: number, out: Output): void {
	if (isScalar(value)) {
		emitAt(out, scalarText(value), depth);
		return;
	}
	if (Array.isArray(value)) {
		renderArray(value, depth, out);
		return;
	}
	const record = asRecord(value);
	if (record) {
		renderObject(record, depth, out);
	}
}

function renderObject(value: Record<string, unknown>, depth: number, out: Output): void {
	const keys = Object.keys(value);
	if (keys.length === 0) {
		emitAt(out, "{}", depth);
		return;
	}
	for (const key of keys) {
		const child = value[key];
		const inline = inlineValue(child);
		if (inline !== undefined) {
			if (!emitAt(out, `${key}: ${inline}`, depth)) return;
			continue;
		}
		if (!emitAt(out, key, depth)) return;
		renderValue(child, depth + 1, out);
		if (out.cut) return;
	}
}

function renderArray(value: readonly unknown[], depth: number, out: Output): void {
	if (value.length === 0) {
		emitAt(out, "[]", depth);
		return;
	}
	if (isRecordList(value)) {
		renderTable(value, depth, out);
		return;
	}
	if (isScalarList(value)) {
		for (const item of value) if (!emitAt(out, `- ${scalarText(item)}`, depth)) return;
		return;
	}
	// Mixed shapes keep their order and their nesting rather than pretending to be
	// a table they are not.
	for (const item of value) {
		if (!emitAt(out, "-", depth)) return;
		renderValue(item, depth + 1, out);
		if (out.cut) return;
	}
}

function renderJson(body: string): string | undefined {
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return undefined;
	}
	const out = createOutput();
	renderValue(value, 0, out);
	return finish(out, body);
}

/**
 * RFC 4180: commas between fields, a quoted field may hold commas and line breaks,
 * and a doubled quote inside one is a literal quote. An unterminated quote means
 * this is not CSV we can read, so the caller keeps the raw body.
 */
function parseCsv(body: string): string[][] | undefined {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (quoted) {
			if (char !== '"') field += char;
			else if (body[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && body[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += char;
	}
	if (quoted) return undefined;
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const filled = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
	const columns = filled.reduce((widest, cells) => Math.max(widest, cells.length), 0);
	return filled.length >= 2 && columns >= 2 ? filled : undefined;
}

function renderCsv(body: string): string | undefined {
	const rows = parseCsv(body);
	if (!rows) return undefined;
	const out = createOutput();
	renderGrid(rows, 0, out);
	return finish(out, body);
}

/** One element: its attributes, its children, and the text directly inside it. */
interface XmlNode {
	name: string;
	attributes: Array<readonly [string, string]>;
	children: XmlNode[];
	text: string;
}

/** Attributes of one tag; a bare attribute carries no value to show, so it is left out. */
function parseAttributes(source: string): Array<readonly [string, string]> {
	const attributes: Array<readonly [string, string]> = [];
	for (const match of source.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
		attributes.push([match[1], decodeEntities(match[3] ?? match[4] ?? "")]);
	}
	return attributes;
}

/** Index just past `end` where it closes a construct opened at `from`, or -1. */
function after(body: string, from: number, end: string): number {
	const at = body.indexOf(end, from + 1);
	return at < 0 ? -1 : at + end.length;
}

/**
 * The smallest XML reader that answers "what is the tree": tags, attributes, text,
 * comments, CDATA, and the declaration. It returns `undefined` on anything it
 * cannot balance — two roots, a stray close, an unterminated quote or comment — so
 * a body that is not really XML keeps its raw form.
 */
function parseXml(body: string): XmlNode | undefined {
	const stack: XmlNode[] = [];
	let root: XmlNode | undefined;
	let index = 0;

	const appendText = (text: string): void => {
		const node = stack[stack.length - 1];
		if (node) node.text += text;
	};

	while (index < body.length) {
		const open = body.indexOf("<", index);
		if (open < 0) {
			appendText(decodeEntities(body.slice(index)));
			break;
		}
		if (open > index) appendText(decodeEntities(body.slice(index, open)));

		if (body.startsWith("<!--", open)) {
			const next = after(body, open, "-->");
			if (next < 0) return undefined;
			index = next;
			continue;
		}
		if (body.startsWith("<![CDATA[", open)) {
			const at = body.indexOf("]]>", open);
			if (at < 0) return undefined;
			appendText(body.slice(open + "<![CDATA[".length, at));
			index = at + "]]>".length;
			continue;
		}
		if (body.startsWith("<?", open) || body.startsWith("<!")) {
			const next = after(body, open, body.startsWith("<?", open) ? "?>" : ">");
			if (next < 0) return undefined;
			index = next;
			continue;
		}

		const close = body.indexOf(">", open + 1);
		if (close < 0) return undefined;
		const tag = body.slice(open + 1, close).trim();
		if (tag.startsWith("/")) {
			const node = stack.pop();
			if (!node || node.name !== tag.slice(1).trim()) return undefined;
			index = close + 1;
			continue;
		}

		const selfClosing = tag.endsWith("/");
		const inner = selfClosing ? tag.slice(0, -1).trim() : tag;
		const name = /^[^\s/>]+/.exec(inner)?.[0];
		if (!name) return undefined;
		const node: XmlNode = { name, attributes: parseAttributes(inner.slice(name.length)), children: [], text: "" };
		const parent = stack[stack.length - 1];
		if (parent) parent.children.push(node);
		else if (root) return undefined;
		else root = node;
		if (!selfClosing) stack.push(node);
		index = close + 1;
	}

	if (stack.length > 0 || !root) return undefined;
	return root;
}

/**
 * One element as an indented block: a leaf with only text reads `name: text`,
 * anything with attributes or children gets a line of its own and indented detail.
 */
function renderXmlNode(node: XmlNode, depth: number, out: Output): void {
	const text = collapse(node.text);
	if (node.children.length === 0 && node.attributes.length === 0) {
		emitAt(out, text ? `${node.name}: ${text}` : node.name, depth);
		return;
	}
	if (!emitAt(out, node.name, depth)) return;
	for (const [name, value] of node.attributes) if (!emitAt(out, `@${name}: ${value}`, depth + 1)) return;
	for (const child of node.children) {
		renderXmlNode(child, depth + 1, out);
		if (out.cut) return;
	}
	if (text) emitAt(out, text, depth + 1);
}

function renderXml(body: string): string | undefined {
	const root = parseXml(body);
	if (!root) return undefined;
	const out = createOutput();
	renderXmlNode(root, 0, out);
	return finish(out, body);
}
