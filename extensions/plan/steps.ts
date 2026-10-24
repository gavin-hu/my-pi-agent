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
 * shallowest list level is treated as the plan. An indented, marker-less line
 * continues the item above it, so a wrapped step keeps its full text. When the
 * plan has a `Steps` section (the canonical outline's heading), only that
 * section's list items are steps, so prose bullets elsewhere never seed the todo
 * list or consume the step cap. List items inside fenced code blocks are ignored. A `- [ ]` / `- [x]`
 * checkbox or a `[DONE:n]` marker sets the status.
 */

import {
	extractSections as extractPlanSections,
	FENCE,
	HEADING,
	normalizeHeadingText,
} from "../../lib/plans/sections.ts";

/**
 * The section machinery is `lib/plans/sections.ts`, because the split writes
 * `## Team` with the same fence-aware scan this module navigates with. These
 * re-exports keep the plan extension's public surface one import.
 */
export {
	extractSections as extractPlanSections,
	FENCE,
	HEADING,
	normalizeHeadingText,
	replaceSection,
	sectionKeys,
} from "../../lib/plans/sections.ts";
export type { PlanSection } from "../../lib/plans/sections.ts";

/** Most steps seeded from one plan. */
export const MAX_STEPS = 50;
/** Longest seeded step text; longer lines are elided. */
export const MAX_STEP_LENGTH = 200;

/**
 * The outline a plan is guided to follow: one job per section, and every example
 * is the shape wanted rather than a description of it. `Visual` is the one
 * section that carries the end state — the same surface before and after when the
 * change alters one that already exists, one frame when it is new — in a fence
 * that stays untagged unless every line is code, so the reviewer sees the result
 * before the steps that build it. Guidance only: `write_plan` never rejects or
 * rewrites a plan that omits a section, and a change with no visible surface drops
 * `Visual`.
 */
export const PLAN_OUTLINE = [
	"# <Title>",
	"",
	"## Goal",
	"One sentence: the outcome this change delivers, and what it deliberately does not do.",
	"",
	"## Context",
	"- `src/load.ts:42` reads the config once at startup; that is the only caller.",
	"- The file is user-editable, so a bad key must name the file and line.",
	"",
	"## Approach",
	"- Parse into a typed record in `parseConfig`; `load()` keeps the file read.",
	"- Rejected: validating inside `load()`, because the test would need a filesystem.",
	"",
	"## Visual",
	"A bad key at startup, before and after:",
	"```",
	"$ bun start",
	'config.json:12: ignoring unknown key "timeout_ms"',
	"```",
	"",
	"```",
	"$ bun start",
	'config.json:12: unknown key "timeout_ms" — did you mean "timeoutMs"?',
	"```",
	"",
	"## Steps",
	"- [ ] Add `parseConfig` in `src/config.ts`, with a test for a missing key",
	"  - `load()` is the only caller today; it keeps the file read.",
	"- [ ] Report a bad key with its file and line, and note the rule in the README",
	"",
	"## Risks",
	"- A missing key now fails at startup rather than on first use: name that in the README.",
	"- Mitigated by the test in the first step.",
	"",
	"## Verification",
	"```bash",
	"bun test src/config.test.ts",
	"bun run check",
	"```",
].join("\n");

/** The outline's section titles, in order, for documentation and tests. */
export const PLAN_SECTIONS = ["Goal", "Context", "Approach", "Visual", "Steps", "Risks", "Verification"] as const;

export interface PlanStep {
	content: string;
	status: "pending" | "completed";
}

/** A top-level list item located in the source. */
interface PlanListItem {
	/** Zero-based source line index of the item's first line. */
	line: number;
	indent: number;
	/** The list marker with its trailing whitespace, e.g. `1. ` or `- `. */
	lead: string;
	/**
	 * Item text after the marker on its first line; indented continuation lines
	 * are folded into {@link step}, so a checkbox edit rewrites only this line.
	 */
	raw: string;
	step: PlanStep;
}

/** A top-level numbered or bulleted list item, capturing its parts. */
const LIST_ITEM = /^([ \t]*)((?:\d+[.)]|[-*+])\s+)(.*\S)\s*$/;
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/;
const DONE_MARKER = /\[DONE:\d+\]/gi;

/** A label with its inline markers and any done marker removed. */
function cleanLabel(text: string): string {
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

	return { content: cleanLabel(text), status: done ? "completed" : "pending" };
}

/** Leading whitespace width of a line, for continuation indent checks. */
function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/** Every top-level list item, in order, before de-duplication and capping. */
function scanListItems(plan: string): PlanListItem[] {
	const items: PlanListItem[] = [];
	// Fences hide example lists (`- name: foo` in a YAML block) from extraction.
	let fence: string | undefined;
	// The item still collecting indented continuation lines, and those lines.
	let current: { item: PlanListItem; continuation: string[] } | undefined;

	/** Fold the collected continuation into the item, then close it. */
	const finish = (): void => {
		if (current === undefined) return;
		if (current.continuation.length > 0) {
			current.item.step = parseStep(`${current.item.raw} ${current.continuation.join(" ")}`);
		}
		current = undefined;
	};

	plan.split("\n").forEach((line, index) => {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			finish();
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			return;
		}
		if (fence !== undefined) return;

		if (line.trim() === "") {
			finish();
			return;
		}

		const match = line.match(LIST_ITEM);
		if (match) {
			finish();
			const step = parseStep(match[3]);
			if (!step.content) return;
			const item: PlanListItem = { line: index, indent: match[1].length, lead: match[2], raw: match[3], step };
			items.push(item);
			current = { item, continuation: [] };
			return;
		}

		// A deeper, marker-less line continues the step's paragraph; a heading,
		// a shallow line, or a blank line ends it. `raw` stays the first line so
		// `setStepStatuses` edits the checkbox without touching these lines.
		if (current !== undefined && indentOf(line) > current.item.indent && !HEADING.test(line)) {
			const text = line.trim();
			if (text) current.continuation.push(text);
			return;
		}

		finish();
	});

	finish();
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
			if (normalizeHeadingText(heading[2]).toLowerCase() !== "steps") continue;
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
 * The section is prose ("commands and checks") or a fenced block of them, and a
 * todo item is one line, so the fence lines are dropped, the rest is stripped of
 * list markers and inline emphasis, and the lines are joined with `; `, prefixed
 * with `Verify:` and elided like a long step. The item is deliberately *not* a
 * plan step: it is not in the `Steps` section, so it must not count against the
 * step cap or appear in `set_plan_steps` numbering.
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
		// A fenced block is how the outline asks for commands; its fence lines are
		// punctuation, not a check, so only the commands inside it are carried.
		.filter((line) => !FENCE.test(line))
		.map((line) => cleanLabel(line.replace(LIST_PREFIX, "")))
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
