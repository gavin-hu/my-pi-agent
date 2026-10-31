/**
 * Plan-document sections (pure).
 *
 * One fence-aware scan of a plan's markdown: the review screen navigates by
 * section, the `plan` tool's `steps` action looks up `## Steps`, a carried comment finds the
 * block it belongs to, and the browser outline lists the same headings. A second
 * scanner would disagree about a heading inside a fence, so every reader goes
 * through this module.
 *
 * The scan is deliberately smaller than CommonMark: a heading is up to three
 * leading spaces, a space after the hashes, and an optional closing run; a fence
 * is three backticks or tildes anywhere a fence may start. Inside a fence
 * nothing is a heading, which is what keeps a `# comment` in a shell example out
 * of the outline. Every section keeps its raw source lines, so a caller can edit
 * exactly what it read.
 */

/** A heading-delimited chunk of a plan, for navigation and in-place edits. */
export interface PlanSection {
	/** Plain heading text, or `""` for the content before the first heading. */
	title: string;
	/** The section's markdown, including its heading line. */
	text: string;
	/** 0-based source line of the section's heading (0 for the preamble). */
	line: number;
	/** Heading level, or 0 for the preamble before the first heading. */
	level: number;
}

/**
 * A markdown heading outside a fence, capturing its level and text: up to three
 * leading spaces, a space after the hashes, and a closing hash run only when a
 * space separates it. Shared with the block model, so the section split and the
 * browser outline read a heading line the same way, and `## C#` keeps its title.
 */
export const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/**
 * A markdown code-fence opener or closer (backticks or tildes). Shared with the
 * block model: a tab-indented fence is prose for both parsers, never code for one
 * and prose for the other.
 */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * A heading or step label as the review surfaces compare it: inline emphasis and
 * code removed, whitespace collapsed. Exported so a renderer labels an outline
 * entry the same way {@link extractSections} labels its section, which is what
 * lets the browser mark a changed section.
 */
export function normalizeHeadingText(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/(?<![A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Sections of a plan, split at heading lines outside code fences. The content
 * before the first heading is a section titled `""`. Pi's `Markdown` renderer
 * exposes no source-line map, so the review screen renders these chunks
 * separately to know where each section begins.
 */
export function extractSections(plan: string): PlanSection[] {
	const sections: PlanSection[] = [];
	let current: PlanSection | undefined;
	let fence: string | undefined;

	const flush = (): void => {
		if (current && (current.title !== "" || current.text.trim() !== "")) sections.push(current);
		current = undefined;
	};

	plan.split("\n").forEach((line, index) => {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
		} else if (fence === undefined) {
			const heading = line.match(HEADING);
			if (heading) {
				flush();
				current = { title: normalizeHeadingText(heading[2]), text: line, line: index, level: heading[1].length };
				return;
			}
		}
		if (current === undefined) current = { title: "", text: line, line: 0, level: 0 };
		else current.text += `\n${line}`;
	});

	flush();
	return sections;
}

/**
 * One key per section that tells two identically titled headings apart: the title
 * and which occurrence of it this is, in document order. The review pairs a
 * baseline digest with the section it belongs to by it, and the feedback codec
 * matches a comment's section across a rewrite, so a second `## Notes` never
 * collects the first one's lines.
 */
export function sectionKeys(sections: readonly { title: string }[]): string[] {
	const seen = new Map<string, number>();
	return sections.map((section) => {
		const occurrence = seen.get(section.title) ?? 0;
		seen.set(section.title, occurrence + 1);
		return `${occurrence}\u0000${section.title}`;
	});
}
