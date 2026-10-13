/**
 * First-party, escape-first syntax highlighting for the serve code view.
 *
 * A deliberately small tokenizer for the file types that dominate a repository
 * (JavaScript/TypeScript, JSON, CSS, HTML/XML, and shell). It has no
 * dependency and no third-party asset: every literal is escaped with
 * `escapeHtml` as it is emitted, so a highlighted line is exactly as safe as
 * the plain one it replaces. Only a token class name ever reaches the markup.
 *
 * `highlightLines` walks a whole file, so the tokenizers can carry state across
 * lines (block comments, template literals, open HTML tags) without the caller
 * tracking anything. Unknown file types return `undefined` from
 * `detectLanguage` and are rendered plain.
 */

import { extname } from "node:path";
import { escapeHtml } from "./escape.ts";

/** The languages the first-party tokenizer understands. */
export type HighlightLanguage = "js" | "ts" | "json" | "css" | "html" | "shell";

/** A token class; the CSS uses it as `tok-<class>`. */
export type TokenClass = "comment" | "string" | "number" | "keyword" | "literal" | "tag" | "attr" | "prop" | "var";

const EXTENSIONS: Record<string, HighlightLanguage> = {
	js: "js",
	mjs: "js",
	cjs: "js",
	jsx: "js",
	ts: "ts",
	mts: "ts",
	cts: "ts",
	tsx: "ts",
	json: "json",
	jsonc: "json",
	json5: "json",
	css: "css",
	scss: "css",
	sass: "css",
	less: "css",
	html: "html",
	htm: "html",
	xml: "html",
	vue: "html",
	svelte: "html",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
};

/** The highlighter language for a filename, or `undefined` for plain text. */
export function detectLanguage(name: string): HighlightLanguage | undefined {
	const base = name.slice(name.lastIndexOf("/") + 1);
	return EXTENSIONS[extname(base).replace(/^\./, "").toLowerCase()];
}

/** Mutable carry state; only the fields a language uses are read or written. */
interface ScanState {
	/** Inside a block comment. */
	comment: boolean;
	/** Inside a backtick-delimited template literal. */
	template: boolean;
	/** Brace depth, so CSS can tell selectors from declarations. */
	depth: number;
	/** Inside an HTML comment. */
	htmlComment: boolean;
	/** Inside an HTML tag (past the tag name). */
	htmlTag: boolean;
}

function createState(): ScanState {
	return { comment: false, template: false, depth: 0, htmlComment: false, htmlTag: false };
}

/** Wrap already-escaped-safe text in a token span. */
function span(tokenClass: TokenClass, text: string): string {
	return text.length > 0 ? `<span class="tok-${tokenClass}">${escapeHtml(text)}</span>` : "";
}

function isDigit(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}

function isHex(ch: string): boolean {
	return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isIdentStart(ch: string): boolean {
	return ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || isDigit(ch);
}

/** Consume a CSS name, which additionally allows `-` (properties, at-rules). */
function readCssName(line: string, from: number): number {
	let i = from;
	while (i < line.length && (isIdentPart(line[i]) || line[i] === "-")) i++;
	return i;
}

/** The next non-space character at or after `from`, or `""` at end of line. */
function nextNonSpace(line: string, from: number): string {
	for (let i = from; i < line.length; i++) {
		const ch = line[i];
		if (ch !== " " && ch !== "\t") return ch;
	}
	return "";
}

/** The index of the closing `quote`, honoring `\` escapes, or `-1`. */
function findQuote(line: string, from: number, quote: string): number {
	for (let i = from; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === quote) return i;
	}
	return -1;
}

/** Consume a numeric literal (hex, decimal, fraction, exponent, BigInt). */
function readNumber(line: string, from: number): number {
	let i = from;
	if (line[i] === "0" && (line[i + 1] === "x" || line[i + 1] === "X")) {
		i += 2;
		while (i < line.length && (isHex(line[i]) || line[i] === "_")) i++;
		if (line[i] === "n") i++;
		return i;
	}
	while (i < line.length && (isDigit(line[i]) || line[i] === "_")) i++;
	if (line[i] === ".") {
		i++;
		while (i < line.length && (isDigit(line[i]) || line[i] === "_")) i++;
	}
	if (line[i] === "e" || line[i] === "E") {
		i++;
		if (line[i] === "+" || line[i] === "-") i++;
		while (i < line.length && isDigit(line[i])) i++;
	}
	if (line[i] === "n") i++;
	return i;
}

const JS_KEYWORDS = new Set([
	"abstract",
	"as",
	"asserts",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"declare",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"finally",
	"for",
	"from",
	"function",
	"get",
	"if",
	"implements",
	"import",
	"in",
	"infer",
	"instanceof",
	"interface",
	"is",
	"keyof",
	"let",
	"namespace",
	"new",
	"of",
	"private",
	"protected",
	"public",
	"readonly",
	"return",
	"set",
	"satisfies",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"try",
	"type",
	"typeof",
	"var",
	"void",
	"while",
	"yield",
]);

const JS_LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

/** JavaScript, TypeScript, and (with `props`) JSON. */
function scanJs(line: string, state: ScanState, props: boolean): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (state.comment) {
			const end = line.indexOf("*/", i);
			if (end === -1) return out + span("comment", line.slice(i));
			out += span("comment", line.slice(i, end + 2));
			state.comment = false;
			i = end + 2;
			continue;
		}
		if (state.template) {
			const end = findQuote(line, i, "`");
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			state.template = false;
			i = end + 1;
			continue;
		}
		const ch = line[i];
		const next = line[i + 1];
		if (ch === "/" && next === "/") return out + span("comment", line.slice(i));
		if (ch === "/" && next === "*") {
			const end = line.indexOf("*/", i + 2);
			if (end === -1) {
				state.comment = true;
				return out + span("comment", line.slice(i));
			}
			out += span("comment", line.slice(i, end + 2));
			i = end + 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) {
				if (ch === "`") state.template = true;
				return out + span("string", line.slice(i));
			}
			const text = line.slice(i, end + 1);
			out += props && nextNonSpace(line, end + 1) === ":" ? span("prop", text) : span("string", text);
			i = end + 1;
			continue;
		}
		if (isDigit(ch) || (ch === "." && isDigit(next))) {
			const start = i;
			i = readNumber(line, i);
			out += span("number", line.slice(start, i));
			continue;
		}
		if (isIdentStart(ch)) {
			const start = i;
			i++;
			while (i < line.length && isIdentPart(line[i])) i++;
			const word = line.slice(start, i);
			if (JS_LITERALS.has(word)) out += span("literal", word);
			else if (JS_KEYWORDS.has(word)) out += span("keyword", word);
			else out += escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

const CSS_AT = /^[a-z-]+/i;

/** CSS, SCSS, Sass, and Less. */
function scanCss(line: string, state: ScanState): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (state.comment) {
			const end = line.indexOf("*/", i);
			if (end === -1) return out + span("comment", line.slice(i));
			out += span("comment", line.slice(i, end + 2));
			state.comment = false;
			i = end + 2;
			continue;
		}
		const ch = line[i];
		const next = line[i + 1];
		if (ch === "/" && next === "*") {
			const end = line.indexOf("*/", i + 2);
			if (end === -1) {
				state.comment = true;
				return out + span("comment", line.slice(i));
			}
			out += span("comment", line.slice(i, end + 2));
			i = end + 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			continue;
		}
		if (ch === "!") {
			const word = /^![a-z]+/i.exec(line.slice(i))?.[0] ?? "!";
			out += span("keyword", word);
			i += word.length;
			continue;
		}
		if (ch === "@") {
			const word = CSS_AT.exec(line.slice(i + 1))?.[0] ?? "";
			out += span("keyword", `@${word}`);
			i += 1 + word.length;
			continue;
		}
		if (ch === "#") {
			const j = readCssName(line, i + 1);
			const word = line.slice(i, j);
			const hex = /^#[0-9a-fA-F]{3,8}$/.test(word);
			out += span(hex ? "number" : "tag", word);
			i = j;
			continue;
		}
		if (isDigit(ch) || (ch === "." && isDigit(next))) {
			let j = readNumber(line, i);
			while (j < line.length && isIdentPart(line[j])) j++;
			if (line[j] === "%") j++;
			out += span("number", line.slice(i, j));
			i = j;
			continue;
		}
		if (ch === "{") state.depth++;
		if (ch === "}") state.depth = Math.max(0, state.depth - 1);
		if (isIdentStart(ch) || (ch === "-" && (isIdentStart(next) || next === "-"))) {
			const start = i;
			i = readCssName(line, i + 1);
			const word = line.slice(start, i);
			if (state.depth > 0 && nextNonSpace(line, i) === ":") out += span("prop", word);
			else out += escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

function isTagName(ch: string): boolean {
	return isIdentPart(ch) || ch === ":" || ch === "-";
}

function isAttrName(ch: string): boolean {
	return isIdentPart(ch) || ch === ":" || ch === "-" || ch === "." || ch === "@";
}

/** The attribute tail of an HTML tag, from `from` until `>` or end of line. */
function scanTagTail(line: string, from: number): { html: string; i: number; closed: boolean } {
	let out = "";
	let i = from;
	while (i < line.length) {
		const ch = line[i];
		if (ch === ">") return { html: out + escapeHtml(">"), i: i + 1, closed: true };
		if (ch === "/" && line[i + 1] === ">") return { html: out + escapeHtml("/>"), i: i + 2, closed: true };
		if (ch === '"' || ch === "'") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return { html: out + span("string", line.slice(i)), i: line.length, closed: false };
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			continue;
		}
		if (isAttrName(ch)) {
			const start = i;
			i++;
			while (i < line.length && isAttrName(line[i])) i++;
			out += span("attr", line.slice(start, i));
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return { html: out, i, closed: false };
}

/** HTML, XML, Vue, and Svelte templates. */
function scanHtml(line: string, state: ScanState): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (state.htmlComment) {
			const end = line.indexOf("-->", i);
			if (end === -1) return out + span("comment", line.slice(i));
			out += span("comment", line.slice(i, end + 3));
			state.htmlComment = false;
			i = end + 3;
			continue;
		}
		if (state.htmlTag) {
			const tail = scanTagTail(line, i);
			out += tail.html;
			i = tail.i;
			if (!tail.closed) return out;
			state.htmlTag = false;
			continue;
		}
		if (line[i] !== "<") {
			const lt = line.indexOf("<", i);
			if (lt === -1) return out + escapeHtml(line.slice(i));
			out += escapeHtml(line.slice(i, lt));
			i = lt;
			continue;
		}
		if (line.startsWith("<!--", i)) {
			const end = line.indexOf("-->", i + 4);
			if (end === -1) {
				state.htmlComment = true;
				return out + span("comment", line.slice(i));
			}
			out += span("comment", line.slice(i, end + 3));
			i = end + 3;
			continue;
		}
		out += escapeHtml("<");
		i++;
		if (line[i] === "/") {
			out += escapeHtml("/");
			i++;
		}
		const start = i;
		while (i < line.length && isTagName(line[i])) i++;
		if (i === start && line[i - 1] !== "/") {
			// A stray `<` (e.g. `a < b`), not a tag.
			continue;
		}
		out += span("tag", line.slice(start, i));
		state.htmlTag = true;
	}
	return out;
}

const SHELL_KEYWORDS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"until",
	"do",
	"done",
	"case",
	"esac",
	"in",
	"function",
	"return",
	"local",
	"export",
	"readonly",
	"exit",
	"break",
	"continue",
	"select",
	"time",
]);

/** Shell (`sh`, `bash`, `zsh`). Quotes are per-line; heredocs are not parsed. */
function scanShell(line: string): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === "#") return out + span("comment", line.slice(i));
		if (ch === "'") {
			const end = line.indexOf("'", i + 1);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			continue;
		}
		if (ch === '"' || ch === "`") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			continue;
		}
		if (ch === "$") {
			if (line[i + 1] === "{") {
				const close = line.indexOf("}", i + 2);
				const end = close === -1 ? line.length : close + 1;
				out += span("var", line.slice(i, end));
				i = end;
				continue;
			}
			let j = i + 1;
			while (j < line.length && isIdentPart(line[j])) j++;
			if (j > i + 1) {
				out += span("var", line.slice(i, j));
				i = j;
				continue;
			}
		}
		if (isDigit(ch)) {
			const start = i;
			i = readNumber(line, i);
			out += span("number", line.slice(start, i));
			continue;
		}
		if (isIdentStart(ch)) {
			const start = i;
			i++;
			while (i < line.length && isIdentPart(line[i])) i++;
			const word = line.slice(start, i);
			out += SHELL_KEYWORDS.has(word) ? span("keyword", word) : escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

/**
 * Highlight a file's lines, carrying state (block comments, template literals,
 * open HTML tags, CSS brace depth) across them. Returns one HTML string per
 * input line, without a wrapper; empty lines stay empty.
 */
export function highlightLines(lines: string[], language: HighlightLanguage): string[] {
	const state = createState();
	return lines.map((line) => {
		switch (language) {
			case "js":
			case "ts":
				return scanJs(line, state, false);
			case "json":
				return scanJs(line, state, true);
			case "css":
				return scanCss(line, state);
			case "html":
				return scanHtml(line, state);
			default:
				return scanShell(line);
		}
	});
}
