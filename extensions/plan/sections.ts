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

import { FENCE, HEADING } from "../../lib/web/markdown-blocks.ts";

/**
 * The kit owns how a heading line and a fence line are read (`lib/web/markdown-blocks.ts`),
 * because the block scan reads the same two lines: a heading split one way by the outline
 * and another way by the block model is a `# comment` in a shell example appearing in one
 * and not the other.
 */
export { FENCE, HEADING };

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
