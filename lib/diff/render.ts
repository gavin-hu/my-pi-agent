/**
 * A parsed diff as page markup: one line per row, with the gutter, the sign, and
 * the hunk sections.
 *
 * The one part of a diff page with its own rule — the old and new sides are
 * highlighted as two documents per hunk, so the tokenizer carries state within a
 * hunk and never across the unchanged lines a hunk does not show.
 *
 * The classes it emits (`bf-diff-hunk`, `bf-diff-line`, and the `browse-diff-no` /
 * `browse-diff-sign` pair) are the page's stylesheet's, and a page that serves a
 * diff supplies those rules. Loading this module loads `lib/highlight.ts`, which is
 * why a registration graph imports `modes.ts` or `status.ts` instead of the barrel.
 */

import { escapeHtml } from "../escape.ts";
import { highlightLines, type HighlightLanguage } from "../highlight.ts";
import type { DiffLine } from "./parse.ts";

/**
 * The inner HTML per diff line. Hunk bodies are highlighted by rebuilding the
 * old side (context + deleted) and the new side (context + added), so the
 * tokenizer carries state within a hunk; meta, hunk, and note lines stay plain.
 * State does not cross hunks, since the unchanged lines between them are absent.
 */
function highlightDiffText(lines: DiffLine[], language?: HighlightLanguage): string[] {
	if (!language) return lines.map((line) => escapeHtml(line.text));
	const out: string[] = new Array(lines.length);
	let index = 0;
	while (index < lines.length) {
		const kind = lines[index].kind;
		if (kind !== "ctx" && kind !== "add" && kind !== "del") {
			out[index] = escapeHtml(lines[index].text);
			index++;
			continue;
		}
		const start = index;
		const oldDoc: string[] = [];
		const newDoc: string[] = [];
		while (index < lines.length) {
			const body = lines[index].kind;
			if (body !== "ctx" && body !== "add" && body !== "del") break;
			if (body === "ctx") {
				oldDoc.push(lines[index].text);
				newDoc.push(lines[index].text);
			} else if (body === "add") {
				newDoc.push(lines[index].text);
			} else {
				oldDoc.push(lines[index].text);
			}
			index++;
		}
		const oldHtml = highlightLines(oldDoc, language);
		const newHtml = highlightLines(newDoc, language);
		let oldIndex = 0;
		let newIndex = 0;
		for (let cursor = start; cursor < index; cursor++) {
			const body = lines[cursor].kind;
			if (body === "ctx") {
				out[cursor] = newHtml[newIndex];
				newIndex++;
				oldIndex++;
			} else if (body === "add") {
				out[cursor] = newHtml[newIndex];
				newIndex++;
			} else {
				out[cursor] = oldHtml[oldIndex];
				oldIndex++;
			}
		}
	}
	return out;
}

/**
 * How a row's numbers are drawn: the diff's two sides, or the one column a whole file has.
 *
 * A whole file's old and new number are the same number, and its rows carry no sign, so the
 * second column and the sign would be a gutter of blanks. The choice is the caller's because
 * only it knows whether it is drawing a comparison or a file.
 */
export type DiffGutter = "diff" | "file";

/** Options for {@link renderDiffLines}; absent is the diff's two-column gutter. */
export interface DiffRenderOptions {
	gutter?: DiffGutter;
}

/**
 * Render unified-diff lines with a gutter and per-kind styling.
 *
 * The gutter is two number columns and a sign by default; `gutter: "file"` is the whole-file
 * reading, one number and no sign, for a caller that is not drawing a comparison.
 */
export function renderDiffLines(
	lines: DiffLine[],
	language?: HighlightLanguage,
	options: DiffRenderOptions = {},
): string {
	const html = highlightDiffText(lines, language);
	const file = options.gutter === "file";
	// Every hunk is a section so its sticky header is bounded by its own body;
	// the section also gives the keyboard a stable, non-sticky scroll target.
	const out: string[] = [];
	let hunks = 0;
	let open = false;
	lines.forEach((line, index) => {
		if (line.kind === "hunk") {
			if (open) out.push("</span>");
			hunks += 1;
			out.push(`<span class="bf-diff-hunk" id="hunk-${hunks}" data-hunk="${hunks}">`);
			open = true;
		}
		const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "ctx" ? " " : "";
		const gutter = file
			? `<span class="browse-diff-no" aria-hidden="true">${line.newNo ?? ""}</span>`
			: `<span class="browse-diff-no" aria-hidden="true">${line.oldNo ?? ""}</span><span class="browse-diff-no" aria-hidden="true">${line.newNo ?? ""}</span>`;
		const marker = file ? "" : `<span class="browse-diff-sign" aria-hidden="true">${sign}</span>`;
		out.push(
			`<span class="bf-code__line bf-diff-line bf-diff-line--${line.kind}">${gutter}${marker}${html[index]}</span>`,
		);
	});
	if (open) out.push("</span>");
	return out.join("");
}
