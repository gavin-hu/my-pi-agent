/**
 * First-party, escape-first syntax highlighting for the serve code view.
 *
 * A deliberately small tokenizer for the file types that dominate a repository
 * (JavaScript/TypeScript, JSON, CSS, HTML/XML, shell, Python, Java, YAML, and
 * SQL). It has no
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
export type HighlightLanguage = "js" | "ts" | "json" | "css" | "html" | "shell" | "python" | "java" | "yaml" | "sql";

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
	py: "python",
	pyw: "python",
	pyi: "python",
	java: "java",
	yaml: "yaml",
	yml: "yaml",
	sql: "sql",
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
	/** The active Python triple-quote delimiter (`"""` or `'''`), or `""`. */
	tripleQuote: string;
}

function createState(): ScanState {
	return { comment: false, template: false, depth: 0, htmlComment: false, htmlTag: false, tripleQuote: "" };
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
const NO_KEYWORDS = new Set<string>();

/** Options for the shared C-like scanner. */
interface CLikeOptions {
	keywords: Set<string>;
	literals: Set<string>;
	/** Show a string immediately followed by `:` as a property key (JSON). */
	props?: boolean;
	/** Highlight `@Name` annotations (Java). */
	annotations?: boolean;
}

/** JavaScript, TypeScript, JSON, and Java. */
function scanCLike(line: string, state: ScanState, options: CLikeOptions): string {
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
			out += options.props && nextNonSpace(line, end + 1) === ":" ? span("prop", text) : span("string", text);
			i = end + 1;
			continue;
		}
		if (options.annotations && ch === "@") {
			const start = i + 1;
			let j = start;
			while (j < line.length && isIdentPart(line[j])) j++;
			if (j > start) {
				out += span("keyword", line.slice(i, j));
				i = j;
				continue;
			}
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
			if (options.literals.has(word)) out += span("literal", word);
			else if (options.keywords.has(word)) out += span("keyword", word);
			else out += escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

const JAVA_KEYWORDS = new Set([
	"abstract",
	"assert",
	"boolean",
	"break",
	"byte",
	"case",
	"catch",
	"char",
	"class",
	"continue",
	"default",
	"do",
	"double",
	"else",
	"enum",
	"extends",
	"final",
	"finally",
	"float",
	"for",
	"if",
	"implements",
	"import",
	"instanceof",
	"int",
	"interface",
	"long",
	"native",
	"new",
	"package",
	"private",
	"protected",
	"public",
	"record",
	"return",
	"sealed",
	"short",
	"static",
	"strictfp",
	"super",
	"switch",
	"synchronized",
	"this",
	"throw",
	"throws",
	"transient",
	"try",
	"var",
	"void",
	"volatile",
	"while",
	"yield",
]);

const JAVA_LITERALS = new Set(["true", "false", "null"]);

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

const PYTHON_KEYWORDS = new Set([
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"match",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
]);

const PYTHON_LITERALS = new Set(["True", "False", "None"]);

/** Python. Triple-quoted strings carry across lines. */
function scanPython(line: string, state: ScanState): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (state.tripleQuote.length > 0) {
			const end = line.indexOf(state.tripleQuote, i);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 3));
			state.tripleQuote = "";
			i = end + 3;
			continue;
		}
		const ch = line[i];
		const next = line[i + 1];
		if (ch === "#") return out + span("comment", line.slice(i));
		if (ch === '"' || ch === "'") {
			const triple = ch.repeat(3);
			if (line.startsWith(triple, i)) {
				const end = line.indexOf(triple, i + 3);
				if (end === -1) {
					state.tripleQuote = triple;
					return out + span("string", line.slice(i));
				}
				out += span("string", line.slice(i, end + 3));
				i = end + 3;
				continue;
			}
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			continue;
		}
		if (ch === "@") {
			const start = i + 1;
			let j = start;
			while (j < line.length && isIdentPart(line[j])) j++;
			if (j > start) {
				out += span("keyword", line.slice(i, j));
				i = j;
				continue;
			}
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
			if (PYTHON_LITERALS.has(word)) out += span("literal", word);
			else if (PYTHON_KEYWORDS.has(word)) out += span("keyword", word);
			else out += escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

const YAML_LITERALS = new Set(["true", "false", "null", "yes", "no", "on", "off"]);

/** YAML. A key before `:` is a property; block scalars are not carried. */
function scanYaml(line: string): string {
	let out = "";
	let i = 0;
	let head = true;
	while (i < line.length) {
		const ch = line[i];
		if (ch === " " || ch === "\t") {
			out += ch;
			i++;
			continue;
		}
		if (ch === "#") return out + span("comment", line.slice(i));
		if (line.startsWith("---", i) || line.startsWith("...", i)) {
			out += span("keyword", line.slice(i, i + 3));
			i += 3;
			head = false;
			continue;
		}
		if (head && ch === "-" && (line[i + 1] === " " || line[i + 1] === undefined)) {
			out += "-";
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
			i = end + 1;
			head = false;
			continue;
		}
		if (ch === "|" || ch === ">") {
			let j = i + 1;
			while (j < line.length && (line[j] === "+" || line[j] === "-" || isDigit(line[j]))) j++;
			out += span("keyword", line.slice(i, j));
			i = j;
			head = false;
			continue;
		}
		if (ch === "~") {
			out += span("literal", ch);
			i++;
			head = false;
			continue;
		}
		if (isDigit(ch) || ((ch === "-" || ch === "+") && isDigit(line[i + 1]))) {
			const start = i;
			i = readNumber(line, i);
			out += span("number", line.slice(start, i));
			head = false;
			continue;
		}
		if (isIdentStart(ch)) {
			const start = i;
			i++;
			while (i < line.length && (isIdentPart(line[i]) || line[i] === "." || line[i] === "-")) i++;
			const word = line.slice(start, i);
			if (head && nextNonSpace(line, i) === ":") out += span("prop", word);
			else if (YAML_LITERALS.has(word)) out += span("literal", word);
			else out += escapeHtml(word);
			head = false;
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

const SQL_KEYWORDS = new Set([
	"ALL",
	"ALTER",
	"AND",
	"AS",
	"ASC",
	"BEGIN",
	"BETWEEN",
	"BY",
	"CASE",
	"CAST",
	"COMMIT",
	"CONSTRAINT",
	"CREATE",
	"CROSS",
	"DEFAULT",
	"DELETE",
	"DESC",
	"DISTINCT",
	"DROP",
	"ELSE",
	"END",
	"EXISTS",
	"FOREIGN",
	"FROM",
	"FULL",
	"GROUP",
	"HAVING",
	"IN",
	"INDEX",
	"INNER",
	"INSERT",
	"INTO",
	"IS",
	"JOIN",
	"KEY",
	"LEFT",
	"LIKE",
	"LIMIT",
	"NOT",
	"OFFSET",
	"ON",
	"OR",
	"ORDER",
	"OUTER",
	"PRIMARY",
	"REFERENCES",
	"RETURNING",
	"RIGHT",
	"ROLLBACK",
	"SELECT",
	"SET",
	"TABLE",
	"THEN",
	"TRANSACTION",
	"UNION",
	"UNIQUE",
	"UPDATE",
	"USING",
	"VALUES",
	"VIEW",
	"WHEN",
	"WHERE",
	"WITH",
]);

const SQL_LITERALS = new Set(["TRUE", "FALSE", "NULL"]);

/** SQL. Keywords are case-insensitive; `--` and block comments are supported. */
function scanSql(line: string, state: ScanState): string {
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
		if (ch === "-" && next === "-") return out + span("comment", line.slice(i));
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
		if (ch === "'") {
			// SQL escapes a quote by doubling it.
			let j = i + 1;
			while (j < line.length) {
				if (line[j] !== "'") {
					j++;
					continue;
				}
				if (line[j + 1] === "'") {
					j += 2;
					continue;
				}
				break;
			}
			const end = j < line.length ? j + 1 : line.length;
			out += span("string", line.slice(i, end));
			i = end;
			continue;
		}
		if (ch === '"' || ch === "`") {
			const end = findQuote(line, i + 1, ch);
			if (end === -1) return out + span("string", line.slice(i));
			out += span("string", line.slice(i, end + 1));
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
			const upper = word.toUpperCase();
			if (SQL_LITERALS.has(upper)) out += span("literal", word);
			else if (SQL_KEYWORDS.has(upper)) out += span("keyword", word);
			else out += escapeHtml(word);
			continue;
		}
		out += escapeHtml(ch);
		i++;
	}
	return out;
}

/**
 * Highlight a file's lines, carrying state (block comments, template literals,
 * open HTML tags, CSS brace depth, Python triple-quoted strings) across them.
 * Returns one HTML string per input line, without a wrapper; empty lines stay
 * empty.
 */
export function highlightLines(lines: string[], language: HighlightLanguage): string[] {
	const state = createState();
	return lines.map((line) => {
		switch (language) {
			case "js":
			case "ts":
				return scanCLike(line, state, { keywords: JS_KEYWORDS, literals: JS_LITERALS });
			case "json":
				return scanCLike(line, state, { keywords: NO_KEYWORDS, literals: JS_LITERALS, props: true });
			case "java":
				return scanCLike(line, state, {
					keywords: JAVA_KEYWORDS,
					literals: JAVA_LITERALS,
					annotations: true,
				});
			case "css":
				return scanCss(line, state);
			case "html":
				return scanHtml(line, state);
			case "python":
				return scanPython(line, state);
			case "yaml":
				return scanYaml(line);
			case "sql":
				return scanSql(line, state);
			default:
				return scanShell(line);
		}
	});
}
