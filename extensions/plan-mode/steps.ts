/**
 * Plan-step extraction (pure).
 *
 * When the user approves a plan, plan-mode seeds the `todo` tool so the model
 * starts execution with the steps already tracked. This module turns the plan
 * markdown into a bounded, de-duplicated list of step texts.
 */

/** Most steps seeded from one plan. */
export const MAX_STEPS = 50;
/** Longest seeded step text; longer lines are elided. */
export const MAX_STEP_LENGTH = 200;

const NUMBERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;

function cleanStep(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[DONE:\d+\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Numbered (or bulleted) steps from a plan, in order. */
export function extractPlanSteps(plan: string): string[] {
	const steps: string[] = [];
	const seen = new Set<string>();

	for (const line of plan.split("\n")) {
		const match = line.match(NUMBERED) ?? line.match(BULLET);
		if (!match) continue;

		let text = cleanStep(match[1]);
		if (!text) continue;
		if (text.length > MAX_STEP_LENGTH) text = `${text.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…`;

		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		steps.push(text);
		if (steps.length >= MAX_STEPS) break;
	}
	return steps;
}
