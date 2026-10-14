/**
 * Plan-document structure (pure).
 *
 * This module owns the shape of the markdown plan: the outline the model is
 * guided to write, the top-level steps that seed `todo` and drive the review
 * gauge, the heading sections the review screen navigates, and the in-place
 * checkbox edit that keeps the file current after approval. All of it is pure so
 * the tools, the store, and the renderer agree on one parser.
 *
 * Only top-level list items become steps: nested sub-bullets are notes, and the
 * shallowest list level is treated as the plan. List items inside fenced code
 * blocks are ignored. A `- [ ]` / `- [x]` checkbox or a `[DONE:n]` marker sets
 * the status.
 */

/** Most steps seeded from one plan. */
export const MAX_STEPS = 50;
/** Longest seeded step text; longer lines are elided. */
export const MAX_STEP_LENGTH = 200;

/**
 * The outline a plan is guided to follow. Guidance only: `write_plan` never
 * rejects or rewrites a plan that omits a section.
 */
export const PLAN_OUTLINE = [
	"# <Title>",
	"",
	"## Goal",
	"What this change achieves, in one or two sentences.",
	"",
	"## Context",
	"The relevant code, constraints, and prior art.",
	"",
	"## Approach",
	"The chosen approach and why; alternatives considered.",
	"",
	"## Steps",
	"- [ ] First concrete step",
	"- [ ] Next step",
	"",
	"## Risks",
	"What could go wrong and how it is mitigated.",
	"",
	"## Verification",
	"How to prove it works: commands and checks.",
].join("\n");

/** The outline's section titles, in order, for documentation and tests. */
export const PLAN_SECTIONS = ["Goal", "Context", "Approach", "Steps", "Risks", "Verification"] as const;

export interface PlanStep {
	content: string;
	status: "pending" | "completed";
}

/** A heading-delimited chunk of the plan, for the review screen's navigation. */
export interface PlanSection {
	/** Plain heading text, or `""` for the content before the first heading. */
	title: string;
	/** The section's markdown, including its heading line. */
	text: string;
}

/** A top-level list item located in the source. */
interface PlanListItem {
	/** Zero-based source line index. */
	line: number;
	indent: number;
	/** The list marker with its trailing whitespace, e.g. `1. ` or `- `. */
	lead: string;
	/** Item text after the marker, right-trimmed (an optional checkbox included). */
	raw: string;
	step: PlanStep;
}

/** A top-level numbered or bulleted list item, capturing its parts. */
const LIST_ITEM = /^([ \t]*)((?:\d+[.)]|[-*+])\s+)(.*\S)\s*$/;
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/;
/** A markdown heading outside a fence, capturing its level and text. */
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** A markdown code-fence opener or closer (backticks or tildes). */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const DONE_MARKER = /\[DONE:\d+\]/gi;

/** Strip inline markdown emphasis and code, then collapse to one clean line. */
function plainText(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/(?<![A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(DONE_MARKER, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Strip a leading checkbox (and any done marker) and report completion. */
function parseStep(raw: string): PlanStep {
	let text = raw.trim();
	let done = false;

	const checkbox = text.match(CHECKBOX);
	if (checkbox) {
		done = checkbox[1].toLowerCase() === "x";
		text = checkbox[2];
	}
	if (/\[DONE:\d+\]/i.test(text)) done = true;

	return { content: plainText(text), status: done ? "completed" : "pending" };
}

/** Every top-level list item, in order, before de-duplication and capping. */
function scanListItems(plan: string): PlanListItem[] {
	const items: PlanListItem[] = [];
	// Fences hide example lists (`- name: foo` in a YAML block) from extraction.
	let fence: string | undefined;

	plan.split("\n").forEach((line, index) => {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			return;
		}
		if (fence !== undefined) return;

		const match = line.match(LIST_ITEM);
		if (!match) return;
		const step = parseStep(match[3]);
		if (!step.content) return;
		items.push({ line: index, indent: match[1].length, lead: match[2], raw: match[3], step });
	});
	return items;
}

/**
 * The plan's top-level steps in order: the shallowest list level, de-duplicated,
 * capped. Extraction, the review gauge, and checkbox edits all index into this,
 * so they agree on what counts as a step.
 */
function topLevelItems(plan: string): PlanListItem[] {
	const items = scanListItems(plan);
	// The shallowest list is the plan; deeper items are nested notes.
	let baseIndent = Number.POSITIVE_INFINITY;
	for (const item of items) baseIndent = Math.min(baseIndent, item.indent);

	const seen = new Set<string>();
	const top: PlanListItem[] = [];
	for (const item of items) {
		if (item.indent !== baseIndent) continue;
		const key = item.step.content.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		top.push(item);
		if (top.length >= MAX_STEPS) break;
	}
	return top;
}

function elide(content: string): string {
	return content.length > MAX_STEP_LENGTH ? `${content.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…` : content;
}

/** Top-level steps from a plan, in order. */
export function extractPlanSteps(plan: string): PlanStep[] {
	return topLevelItems(plan).map((item) => ({ content: elide(item.step.content), status: item.step.status }));
}

/**
 * Set the checkbox of the `step`th top-level step (1-based, matching
 * {@link extractPlanSteps}) and return the rewritten plan with the updated step,
 * or undefined when the step number is out of range. Only the marker changes: a
 * plain `1.`/`-` item gains a checkbox, an existing one is set, and the step
 * text is left exactly as written.
 */
export function setStepStatus(
	plan: string,
	step: number,
	status: "pending" | "completed",
): { plan: string; step: PlanStep } | undefined {
	if (!Number.isInteger(step) || step < 1) return undefined;
	const target = topLevelItems(plan)[step - 1];
	if (!target) return undefined;

	const existing = target.raw.match(CHECKBOX);
	const text = existing ? existing[2] : target.raw;
	const checkbox = status === "completed" ? "[x]" : "[ ]";
	const lines = plan.split("\n");
	lines[target.line] = `${" ".repeat(target.indent)}${target.lead}${checkbox} ${text}`;
	return { plan: lines.join("\n"), step: parseStep(`${checkbox} ${text}`) };
}

/**
 * Sections of a plan, split at heading lines outside code fences. The content
 * before the first heading is a section titled `""`. Pi's `Markdown` renderer
 * exposes no source-line map, so the review screen renders these chunks
 * separately to know where each section begins.
 */
export function extractPlanSections(plan: string): PlanSection[] {
	const sections: PlanSection[] = [];
	let current: PlanSection | undefined;
	let fence: string | undefined;

	const flush = (): void => {
		if (current && (current.title !== "" || current.text.trim() !== "")) sections.push(current);
		current = undefined;
	};

	for (const line of plan.split("\n")) {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
		} else if (fence === undefined) {
			const heading = line.match(HEADING);
			if (heading) {
				flush();
				current = { title: plainText(heading[2]), text: line };
				continue;
			}
		}
		if (current === undefined) current = { title: "", text: line };
		else current.text += `\n${line}`;
	}

	flush();
	return sections;
}
