/**
 * The browse pages' unified-diff body: one line per row, with the gutter, the
 * sign, and the hunk sections.
 *
 * Split from `html.ts` when that module reached its named ceiling: the diff body
 * is the one part of the page renderers with its own rule — old and new sides are
 * highlighted as two documents per hunk, so the tokenizer carries state within a
 * hunk and never across the unchanged lines a hunk does not show.
 */

import { escapeHtml } from "../../lib/escape.ts";
import { highlightLines, type HighlightLanguage } from "../../lib/highlight.ts";
import type { DiffLine } from "./diff.ts";

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

/** Render unified-diff lines with a two-column gutter and per-kind styling. */
export function renderDiffLines(lines: DiffLine[], language?: HighlightLanguage): string {
	const html = highlightDiffText(lines, language);
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
		const gutter = `<span class="browse-diff-no" aria-hidden="true">${line.oldNo ?? ""}</span><span class="browse-diff-no" aria-hidden="true">${line.newNo ?? ""}</span>`;
		const marker = `<span class="browse-diff-sign" aria-hidden="true">${sign}</span>`;
		out.push(
			`<span class="bf-code__line bf-diff-line bf-diff-line--${line.kind}">${gutter}${marker}${html[index]}</span>`,
		);
	});
	if (open) out.push("</span>");
	return out.join("");
}
