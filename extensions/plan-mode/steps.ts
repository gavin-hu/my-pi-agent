/**
 * Plan-step extraction (pure).
 *
 * When the user approves a plan, plan-mode seeds the `todo` tool so the model
 * starts execution with the steps already tracked. This module turns the plan
 * markdown into a bounded, de-duplicated list of steps, each with a status.
 *
 * Only top-level list items become steps: nested sub-bullets are notes, not
 * steps. A `- [ ]` / `- [x]` checkbox or a `[DONE:n]` marker sets the status,
 * so a plan written as a checklist seeds a todo list that reflects it.
 */

/** Most steps seeded from one plan. */
export const MAX_STEPS = 50;
/** Longest seeded step text; longer lines are elided. */
export const MAX_STEP_LENGTH = 200;

export interface PlanStep {
	content: string;
	status: "pending" | "completed";
}

/** A top-level numbered or bulleted list item, capturing its indentation. */
const LIST_ITEM = /^([ \t]*)(?:\d+[.)]|[-*+])\s+(.*\S)\s*$/;
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/;

function cleanStep(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/(?<![A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[DONE:\d+\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Strip a leading checkbox (and any done marker) and report completion. */
function parseStep(raw: string): { content: string; status: "pending" | "completed" } {
	let text = raw.trim();
	let done = false;

	const checkbox = text.match(CHECKBOX);
	if (checkbox) {
		done = checkbox[1].toLowerCase() === "x";
		text = checkbox[2];
	}
	if (/\[DONE:\d+\]/i.test(text)) done = true;

	return { content: cleanStep(text), status: done ? "completed" : "pending" };
}

/** Top-level steps from a plan, in order. */
export function extractPlanSteps(plan: string): PlanStep[] {
	const steps: PlanStep[] = [];
	const seen = new Set<string>();
	// The first list item sets the top level; deeper items are nested notes.
	let baseIndent: number | undefined;

	for (const line of plan.split("\n")) {
		const match = line.match(LIST_ITEM);
		if (!match) continue;
		const indent = match[1].length;
		if (baseIndent === undefined) baseIndent = indent;
		if (indent !== baseIndent) continue;

		const step = parseStep(match[2]);
		if (!step.content) continue;

		const key = step.content.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		steps.push({
			content: step.content.length > MAX_STEP_LENGTH ? `${step.content.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…` : step.content,
			status: step.status,
		});
		if (steps.length >= MAX_STEPS) break;
	}
	return steps;
}
