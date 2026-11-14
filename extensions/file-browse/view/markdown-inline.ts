/**
 * The inline half of the browse Markdown renderer: one escape-first span scan.
 *
 * A block renderer hands this module the text of one block and gets safe HTML back: code
 * spans, emphasis, strikethrough, inline and reference links, images, autolinks, raw HTML
 * through the allowlist, and character references. The block walk is
 * `lib/web/markdown-blocks.ts`'s and the document around it is `markdown.ts`'s; what lands
 * here reads a sentence rather than a document, so the two halves do not share a file whose
 * job is neither.
 *
 * A reference resolves against the document's definitions, so the shape of one and the key it
 * is filed under (`LinkDefinition`, `referenceLabel`) live here with the scan that reads them
 * back. `InlineContext` is the part of the document state a span can see: where links resolve,
 * the definitions, and whether raw HTML is emitted or escaped.
 *
 * The direction is one way: `markdown.ts` imports this module and nothing here imports it back,
 * so a block emitter passes its own wider context and there is no cycle to break.
 */

import { decodeCodePoint, escapeHtml } from "../../../lib/escape.ts";
import { emitAnchor, emitImage, emitImageLink } from "./emit.ts";
import { closeInlineTags, sanitizeInlineTag } from "./raw-html.ts";
import { type LinkBase, resolveImage, resolveLink } from "./urls.ts";

/** One definition the document lifted out of its source: where a reference points, and its title. */
export interface LinkDefinition {
	dest: string;
	title?: string;
}

/** The document state one inline span reads: where links resolve, the definitions, and raw HTML. */
export interface InlineContext {
	link: LinkBase;
	defs: ReadonlyMap<string, LinkDefinition>;
	/** Emit sanitized raw HTML; `false` escapes it as text. */
	html: boolean;
}

/** Fold a reference label the way CommonMark does: trim, collapse, case-fold. Not `lib/session-label.ts`, which names a session. */
export function referenceLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

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
function parseReferenceLink(text: string, start: number, ctx: InlineContext): ParsedLink | undefined {
	if (text[start] !== "[") return undefined;
	const close = matchBracket(text, start);
	if (close === -1 || text[close + 1] === "(") return undefined;
	const label = text.slice(start + 1, close);
	if (text[close + 1] === "[") {
		const end = matchBracket(text, close + 1);
		if (end !== -1) {
			const raw = text.slice(close + 2, end);
			const def = ctx.defs.get(referenceLabel(raw === "" ? label : raw));
			if (def) return { label, dest: def.dest, title: def.title, end: end + 1 };
		}
	}
	const def = ctx.defs.get(referenceLabel(label));
	if (def) return { label, dest: def.dest, title: def.title, end: close + 1 };
	return undefined;
}

function renderLink(parsed: ParsedLink, ctx: InlineContext): string {
	const label = renderInline(parsed.label, ctx);
	const target = resolveLink(parsed.dest, ctx.link);
	if (!target) return label;
	// The anchor's shape is `emit.ts`'s, the same one the raw-HTML sanitizer emits: a link
	// written in Markdown and the same link written as HTML are the same link.
	return emitAnchor({ href: target.href, content: label, title: parsed.title, external: target.external });
}

function renderImage(parsed: ParsedLink, ctx: InlineContext): string {
	const alt = escapeHtml(parsed.label);
	const target = resolveImage(parsed.dest, ctx.link);
	if (!target) return alt;
	if (!target.image) return emitImageLink(target.href, parsed.label || parsed.dest);
	return emitImage({ href: target.href, alt, title: parsed.title });
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

/**
 * Match a numeric or named character reference at `start`. Decoding happens in
 * the inline scanner rather than a pre-pass so an entity cannot become Markdown
 * syntax: `&#42;x&#42;` stays the literal text `*x*`.
 */
function matchEntity(text: string, start: number): Entity | undefined {
	const match = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/.exec(text.slice(start));
	if (!match) return undefined;
	let value: string | undefined;
	if (match[1] !== undefined) value = decodeCodePoint(Number(match[1]));
	else if (match[2] !== undefined) value = decodeCodePoint(Number.parseInt(match[2], 16));
	else if (match[3] !== undefined && Object.hasOwn(NAMED_ENTITIES, match[3])) value = NAMED_ENTITIES[match[3]];
	if (value === undefined) return undefined;
	return { value, length: match[0].length };
}

/** Render inline Markdown within a block, escaping every literal character. */
export function renderInline(text: string, ctx: InlineContext): string {
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
				// Resolved rather than pattern-matched: `urls.ts` owns which schemes open in a
				// new tab, and a `<mailto:>` link is external but does not.
				const external = resolveLink(href, ctx.link)?.external ?? false;
				out += emitAnchor({ href, content: escapeHtml(href), external });
				i += match[0].length;
				continue;
			}
			if (ctx.html) {
				const tag = sanitizeInlineTag(text, i, ctx.link, tags);
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
					out += emitAnchor({ href, content: escapeHtml(label), external: true });
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
