/**
 * Plan-document sections (pure).
 *
 * One fence-aware scan of a plan's markdown, and one rewrite of a section in
 * place. Two features need it: plan mode, whose review screen navigates by
 * section and whose `set_plan_steps` rewrites `## Steps`, and the split, which
 * writes and replaces `## Team` at approval. A second scanner would disagree
 * about a heading inside a fence, so both go through this module.
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
 * The index one past a section's last line: the next heading at its level or
 * shallower, outside a fence, or the end of the document.
 */
function sectionEnd(lines: readonly string[], start: number): number {
	const level = lines[start].match(HEADING)?.[1].length ?? 2;
	let fence: string | undefined;
	for (let index = start + 1; index < lines.length; index++) {
		const line = lines[index];
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			continue;
		}
		if (fence !== undefined) continue;
		const heading = line.match(HEADING);
		if (heading && heading[1].length <= level) return index;
	}
	return lines.length;
}

/**
 * Replace a level-2 section's body, or remove the section, or append one.
 *
 * `body` is the section's markdown after its heading, without the heading line —
 * the caller keeps the heading text so a refinement cannot rename the section
 * that other code looks for. An empty `body` removes the whole section, which is
 * how a team stops existing; a missing section with a body appends one, so the
 * write is idempotent rather than order-dependent.
 */
export function replaceSection(plan: string, title: string, body: string | undefined): string {
	const lines = plan.split("\n");
	const wanted = normalizeHeadingText(title).toLowerCase();
	const sections = extractSections(plan);
	const found = sections.find(
		(candidate) => candidate.level === 2 && normalizeHeadingText(candidate.title).toLowerCase() === wanted,
	);

	if (!found) {
		if (body === undefined) return plan;
		const prefix = plan.trim() === "" ? "" : `${plan.replace(/\s+$/, "")}\n\n`;
		return `${prefix}## ${title}\n${body.replace(/\s+$/, "")}\n`;
	}

	const end = sectionEnd(lines, found.line);
	const head = lines.slice(0, found.line);
	const tail = lines.slice(end);
	if (body === undefined) {
		// Drop the blank line that separated the section from what follows, so a
		// removed section leaves one gap rather than two.
		const joined = [...head, ...tail];
		return (
			joined
				.join("\n")
				.replace(/\n{3,}/g, "\n\n")
				.replace(/\s+$/, "") + (plan.endsWith("\n") ? "\n" : "")
		);
	}
	const replacement = [`## ${title}`, "", ...body.replace(/\s+$/, "").split("\n")];
	// Keep one blank line between the rewritten section and whatever followed it.
	const gap = tail.length > 0 && tail[0].trim() !== "" ? [""] : [];
	return [...head, ...replacement, ...gap, ...tail].join("\n");
}

/** The `## Team` section's body, without its heading or surrounding blank lines. */
export function teamSectionBody(plan: string): string | undefined {
	const lines = plan.split("\n");
	const section = extractSections(plan).find(
		(candidate) => candidate.level === 2 && normalizeHeadingText(candidate.title).toLowerCase() === "team",
	);
	if (!section) return undefined;
	const body = lines.slice(section.line + 1, sectionEnd(lines, section.line)).join("\n");
	return body.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}
