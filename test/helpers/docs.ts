/**
 * Markdown readers for the doc pages.
 *
 * `test/extension-docs.test.ts` and `test/skill-docs.test.ts` hold the page
 * contracts; these are the readers they need, so the rules about fences, escaped
 * pipes, heading ranges, and reading a page by its name are written once and any
 * later guard shares them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const HEADING = /^##\s+(.+?)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

/** A page's text, from the directory it lives in and its name without the suffix. */
export function pageTextIn(dir: string, name: string): string {
	return readFileSync(join(dir, `${name}.md`), "utf-8");
}

/** The `##` headings of a page, in order, ignoring fenced code. */
export function headingsOf(text: string): string[] {
	const headings: string[] = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		const heading = fenced ? null : HEADING.exec(line)?.[1];
		if (heading !== undefined && heading !== null) headings.push(heading);
	}
	return headings;
}

/** One page's `## <heading>` section, from its heading to the next `##`. */
export function sectionOf(text: string, heading: string): string {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === heading);
	if (start === -1) return "";
	const end = lines.findIndex((line, at) => at > start && /^##\s/.test(line));
	return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** One table inside a section, as its rows of cells. */
export function tablesOf(section: string): string[][][] {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const line of section.split("\n")) {
		if (line.startsWith("|")) current.push(line);
		else if (current.length > 0) {
			blocks.push(current);
			current = [];
		}
	}
	if (current.length > 0) blocks.push(current);
	// A cell may hold an escaped pipe (`[off\\|wake]`), which the renderer does not
	// treat as a column break, so neither does this.
	return blocks.map((block) =>
		block
			.filter((line) => !/^\|[\s|:-]+\|$/.test(line))
			.map((line) =>
				line
					.replaceAll("\\|", "\u0000")
					.split("|")
					.slice(1, -1)
					.map((cell) => cell.replaceAll("\u0000", "|").trim()),
			),
	);
}
