/**
 * Plan-document structure (pure).
 *
 * This module owns the shape of the markdown plan: the outline the model is
 * guided to write, the top-level steps that seed `todo` and drive the review
 * gauge, the heading sections the review screen navigates, and the in-place
 * checkbox edit that keeps the file current after approval. All of it is pure so
 * the tools, the store, and the renderer agree on one parser. The review's
 * section comparison lives in `plan-text.ts`, which owns the text normalization
 * the digest is computed over.
 *
 * Only top-level list items become steps: nested sub-bullets are notes, and the
 * shallowest list level is treated as the plan. When the plan has a `Steps`
 * section (the canonical outline's heading), only that section's list items are
 * steps, so prose bullets elsewhere never seed the todo list or consume the
 * step cap. List items inside fenced code blocks are ignored. A `- [ ]` / `- [x]`
 * checkbox or a `[DONE:n]` marker sets the status.
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
	"What this change achieves, and what it deliberately does not.",
	"",
	"## Context",
	"The relevant code, constraints, and prior art.",
	"",
	"## Approach",
	"The chosen approach and why; alternatives considered.",
	"",
	"## Steps",
	"- [ ] Add `parseConfig` in `src/config.ts`, with a test for a missing key",
	"- [ ] Wire it into `load()` and document the failure in the README",
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
	/** 0-based source line of the section's heading (0 for the preamble). */
	line: number;
	/** Heading level, or 0 for the preamble before the first heading. */
	level: number;
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
/**
 * A markdown heading outside a fence, capturing its level and text: up to three
 * leading spaces, a space after the hashes, and a closing hash run only when a
 * space separates it. Shared with `blocks.ts`, so the section split and the
 * browser outline read a heading line the same way, and `## C#` keeps its title.
 */
export const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
/**
 * A markdown code-fence opener or closer (backticks or tildes). Shared with
 * `blocks.ts`: a tab-indented fence is prose for both parsers, never code for
 * one and prose for the other.
 */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DONE_MARKER = /\[DONE:\d+\]/gi;

/**
 * A heading or step label as the review surfaces compare it: inline emphasis and
 * code removed, whitespace collapsed. Exported so `blocks.ts` labels an outline
 * entry the same way `extractPlanSections` labels its section, which is what
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

/** Strip inline markdown emphasis and code, then collapse to one clean line. */
function plainText(text: string): string {
	return normalizeHeadingText(text.replace(DONE_MARKER, ""));
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
 * Source range of the plan's `Steps` section: the first heading named `Steps`
 * (any level, outside a fence) through the next heading of the same or a higher
 * level. Undefined when the plan has no such heading, which keeps the
 * whole-document fallback for plans written before the outline.
 */
function stepsSection(plan: string): { start: number; end: number } | undefined {
	const lines = plan.split("\n");
	let fence: string | undefined;
	let start = -1;
	let level = 0;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			continue;
		}
		if (fence !== undefined) continue;
		const heading = line.match(HEADING);
		if (!heading) continue;
		const depth = heading[1].length;
		if (start < 0) {
			if (plainText(heading[2]).toLowerCase() !== "steps") continue;
			start = index;
			level = depth;
			continue;
		}
		// A deeper heading is a subsection of Steps; same or higher ends it.
		if (depth <= level) return { start, end: index };
	}
	return start < 0 ? undefined : { start, end: lines.length };
}

/**
 * The plan's top-level steps in order: the shallowest list level of the `Steps`
 * section (or of the whole plan when there is none), de-duplicated, capped.
 * Extraction, the review gauge, and checkbox edits all index into this, so they
 * agree on what counts as a step.
 */
function topLevelItems(plan: string, cap: number = MAX_STEPS): PlanListItem[] {
	const section = stepsSection(plan);
	const items = scanListItems(plan).filter(
		(item) => section === undefined || (item.line > section.start && item.line < section.end),
	);
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
		if (top.length >= cap) break;
	}
	return top;
}

function elide(content: string): string {
	return content.length > MAX_STEP_LENGTH ? `${content.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…` : content;
}

/** A list marker with an optional checkbox, at any indent. */
const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;

/**
 * The plan's `Verification` section as one trailing checklist item, or
 * `undefined` when the plan has none.
 *
 * The section is prose ("commands and checks"), and a todo item is one line, so
 * the lines are stripped of list markers and inline emphasis and joined with
 * `; `, prefixed with `Verify:` and elided like a long step. The item is
 * deliberately *not* a plan step: it is not in the `Steps` section, so it must
 * not count against the step cap or appear in `set_plan_steps` numbering.
 *
 * A plan with no `Steps` heading feeds its shallowest list as steps (the older
 * rule), so that list already covers the verification bullets; appending a
 * summary of them would duplicate them, and there is nothing to carry.
 */
export function verificationItem(plan: string): PlanStep | undefined {
	if (stepsSection(plan) === undefined) return undefined;
	const section = extractPlanSections(plan).find(
		(candidate) => candidate.level > 0 && candidate.title.toLowerCase() === "verification",
	);
	if (!section) return undefined;
	const items = section.text
		.split("\n")
		.slice(1)
		.map((line) => plainText(line.replace(LIST_PREFIX, "")))
		.filter(Boolean);
	if (items.length === 0) return undefined;
	return { content: elide(`Verify: ${items.join("; ")}`), status: "pending" };
}

/** Top-level steps from a plan, in order. */
export function extractPlanSteps(plan: string): PlanStep[] {
	return topLevelItems(plan).map((item) => ({ content: elide(item.step.content), status: item.step.status }));
}

/** The full cost of a plan's step list, for the warning `write_plan` reports. */
export interface PlanStepSummary {
	/** Top-level items in the step list, before the {@link MAX_STEPS} cap. */
	total: number;
	/** Items longer than {@link MAX_STEP_LENGTH}, whose text is elided in the todo list. */
	elided: number;
}

/** Uncapped step count and elision count; `extractPlanSteps` is the capped view. */
export function planStepSummary(plan: string): PlanStepSummary {
	const items = topLevelItems(plan, Number.POSITIVE_INFINITY);
	return {
		total: items.length,
		elided: items.filter((item) => item.step.content.length > MAX_STEP_LENGTH).length,
	};
}

/** One checkbox change: a 1-based step number and the state to set. */
export interface StepEdit {
	step: number;
	status: PlanStep["status"];
}

/**
 * A guarded checkbox change: the edit plus the step's text as it was listed at
 * approval. The store refuses the batch when the step at that number no longer
 * carries the text, so a reordered or rewritten plan is caught instead of
 * ticking the wrong step.
 */
export interface StepUpdate extends StepEdit {
	expected: string;
}

/** Whether the step text now at a number still matches what the caller expected. */
export function matchesStepText(actual: string, expected: string): boolean {
	const normalize = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
	return normalize(actual) === normalize(expected);
}

/**
 * Apply a batch of checkbox changes to the given top-level steps (1-based,
 * matching {@link extractPlanSteps}) and return the rewritten plan, or
 * undefined when any step number is out of range. All-or-nothing: every step is
 * validated before any edit, so one bad entry changes nothing. Only the marker
 * changes: a plain `1.`/`-` item gains a checkbox, an existing one is set, a
 * `[DONE:n]` marker is dropped when the step is reopened, and the step text is
 * otherwise left exactly as written. When a step appears twice, the last entry
 * wins.
 */
export function setStepStatuses(plan: string, updates: readonly StepEdit[]): string | undefined {
	const items = topLevelItems(plan);
	for (const update of updates) {
		if (!Number.isInteger(update.step) || update.step < 1 || !items[update.step - 1]) return undefined;
	}

	const lines = plan.split("\n");
	for (const update of updates) {
		const target = items[update.step - 1];
		const existing = target.raw.match(CHECKBOX);
		let text = existing ? existing[2] : target.raw;
		// A reopened step must lose its marker too: the marker alone reads as
		// completed, so keeping it would contradict the checkbox.
		if (update.status === "pending") text = text.replace(DONE_MARKER, "").trimEnd();
		const checkbox = update.status === "completed" ? "[x]" : "[ ]";
		lines[target.line] = `${" ".repeat(target.indent)}${target.lead}${checkbox} ${text}`;
	}
	return lines.join("\n");
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

	plan.split("\n").forEach((line, index) => {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
		} else if (fence === undefined) {
			const heading = line.match(HEADING);
			if (heading) {
				flush();
				current = { title: plainText(heading[2]), text: line, line: index, level: heading[1].length };
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
 * The plan's own objective: the first paragraph of its `## Goal` section, with
 * inline markdown and a leading list marker removed.
 *
 * Approval records this as the session goal, so the goal is what the plan says it
 * achieves rather than the file-name slug. `undefined` when the plan has no
 * `## Goal` section, so the caller can fall back to the title.
 */
export function goalSection(plan: string): string | undefined {
	const section = extractPlanSections(plan).find(
		(candidate) => candidate.level === 2 && normalizeHeadingText(candidate.title).toLowerCase() === "goal",
	);
	if (section === undefined) return undefined;
	const paragraph: string[] = [];
	for (const line of section.text.split("\n").slice(1)) {
		if (!line.trim()) {
			if (paragraph.length > 0) break;
			continue;
		}
		paragraph.push(line);
	}
	const text = normalizeHeadingText(paragraph.join(" ").replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""));
	return text || undefined;
}
