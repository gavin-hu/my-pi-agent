/**
 * Plan-step extraction (pure).
 *
 * When the user approves a plan, plan-mode seeds the `todo` tool so the model
 * starts execution with the steps already tracked. This module turns the plan
 * markdown into a bounded, de-duplicated list of steps, each with a status.
 *
 * Only top-level list items become steps: nested sub-bullets are notes, not
 * steps, and the shallowest list level is treated as the plan. List items
 * inside fenced code blocks are ignored. A `- [ ]` / `- [x]` checkbox or a
 * `[DONE:n]` marker sets the status, so a plan written as a checklist seeds a
 * todo list that reflects it.
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
/** A markdown code-fence opener or closer (backticks or tildes). */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

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
	const items: Array<{ indent: number; step: PlanStep }> = [];
	// Fences hide example lists (`- name: foo` in a YAML block) from extraction.
	let fence: string | undefined;

	for (const line of plan.split("\n")) {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === undefined) fence = fenceMatch[1][0];
			else if (fence === fenceMatch[1][0]) fence = undefined;
			continue;
		}
		if (fence !== undefined) continue;

		const match = line.match(LIST_ITEM);
		if (!match) continue;
		const step = parseStep(match[2]);
		if (!step.content) continue;
		items.push({ indent: match[1].length, step });
	}

	// The shallowest list is the plan; deeper items are nested notes.
	let baseIndent = Number.POSITIVE_INFINITY;
	for (const item of items) baseIndent = Math.min(baseIndent, item.indent);

	const steps: PlanStep[] = [];
	const seen = new Set<string>();
	for (const { indent, step } of items) {
		if (indent !== baseIndent) continue;
		const key = step.content.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		steps.push({
			content:
				step.content.length > MAX_STEP_LENGTH
					? `${step.content.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…`
					: step.content,
			status: step.status,
		});
		if (steps.length >= MAX_STEPS) break;
	}
	return steps;
}
