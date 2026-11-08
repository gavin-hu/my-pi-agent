/**
 * Markdown readers for the extension pages, and the pages that have moved to
 * the end-user template.
 *
 * The docs tree carries two page contracts while the rewrite is in flight: the
 * contributor template every page was written to, and the short end-user page a
 * rewritten one follows. `test/extension-docs.test.ts` holds both, and both read
 * a page the same way — so the rules about fences, escaped pipes, and heading
 * ranges are written here once rather than in two guards.
 */

const HEADING = /^##\s+(.+?)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

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

/**
 * The extension pages written for a reader who uses the pack rather than changes
 * it. A page moves here when it is rewritten, and the contributor template's
 * cases stop applying to it; the set only grows, and the legacy set only falls.
 */
export const CONVERTED_EXTENSION_PAGES: ReadonlySet<string> = new Set([
	"board",
	"file-browse",
	"plan",
	"serve",
	"todo",
	"web-access",
	"worktree",
]);
