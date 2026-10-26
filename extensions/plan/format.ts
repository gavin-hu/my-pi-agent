/**
 * Pure text for the plan tools' results and approval message.
 *
 * No host calls and no theme: the registrations in `tools/` use these to keep
 * the cap diagnosis, the preview, and the merge summary in one place.
 */

import { SET_PLAN_STEPS_TOOL } from "./runtime.ts";
import { MAX_STEP_LENGTH, MAX_STEPS, type PlanStep, type StepUpdate } from "./steps.ts";
import type { TodoMerge } from "./todos.ts";

/** Lines of plan shown in an unexpanded result. */
const PREVIEW_LINES = 8;

/** The collapsed view of a plan body and how many lines it hid. */
export function preview(plan: string): { body: string; more: number } {
	const lines = plan.split("\n");
	if (lines.length <= PREVIEW_LINES) return { body: plan, more: 0 };
	return { body: lines.slice(0, PREVIEW_LINES).join("\n"), more: lines.length - PREVIEW_LINES };
}

/**
 * One sentence when a step is longer than the display cap. The text stays in the
 * plan file either way; only the todo list and the approval listing shorten it.
 */
export function stepElisionNote(elided: number): string {
	if (elided === 0) return "";
	const plural = elided === 1 ? " is" : "s are";
	return ` Note: ${elided} step${plural} longer than ${MAX_STEP_LENGTH} characters and will be shortened in the todo list.`;
}

/**
 * The diagnosis both cap refusals share: a step list longer than approval can
 * track. Each caller appends the fix that is available from where it stands.
 */
export function overCap(total: number): string {
	return `The plan has ${total} top-level steps but approval tracks at most ${MAX_STEPS}.`;
}

/** "Step 2" or "Steps 1, 2" for a set of step numbers. */
export function stepLabel(steps: number[]): string {
	return `${steps.length === 1 ? "Step" : "Steps"} ${steps.join(", ")}`;
}

/** "Steps 1, 2 completed; step 3 reopened" for the tool's text result. */
export function describeUpdates(updates: StepUpdate[]): string {
	const completed = updates.filter((update) => update.status === "completed").map((update) => update.step);
	const pending = updates.filter((update) => update.status === "pending").map((update) => update.step);
	const parts: string[] = [];
	if (completed.length > 0) parts.push(`${stepLabel(completed)} completed`);
	if (pending.length > 0) parts.push(`${stepLabel(pending)} reopened`);
	return parts.join("; ");
}

/**
 * One sentence about the plan's verification item, or "" when the plan has none
 * (or it was already in the list). The item is a todo, not a plan step, so it is
 * ticked in the list rather than in the file.
 */
export function verificationNote(merged: TodoMerge | undefined): string {
	if (merged?.trailing === "added") {
		return "\nThe plan's verification section is the last todo item; tick it in the todo list, not in the file.";
	}
	if (merged?.trailing === "deferred") {
		return "\nThe plan's verification section did not fit in the full todo list; keep it in mind.";
	}
	return "";
}

/** What the merge did, for the approval message; `steps` is the plan's step count. */
export function mergeSummary(merged: TodoMerge, steps: PlanStep[]): string {
	const total = steps.length;
	const counted = `${merged.added + merged.skipped} of ${total} plan step${total === 1 ? "" : "s"}`;
	const notes = [
		merged.replaced > 0
			? `${merged.replaced} stale item${merged.replaced === 1 ? "" : "s"} from the earlier approval replaced`
			: "",
		merged.skipped > 0 ? `${merged.skipped} already present` : "",
		merged.kept > 0 ? `${merged.kept} existing kept` : "",
		merged.deferred > 0 ? `${merged.deferred} deferred, list full` : "",
	].filter(Boolean);
	const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
	const tick = `Tick each one off in the file with ${SET_PLAN_STEPS_TOOL} as you finish it, passing the step's text as \`expected\`.`;
	const touched =
		merged.stale > 0
			? ` ${merged.stale} older item${merged.stale === 1 ? "" : "s"} no longer match${merged.stale === 1 ? "es" : ""} this plan but ${merged.stale === 1 ? "was" : "were"} left alone: ${merged.stale === 1 ? "it was" : "they were"} started or finished, so check ${merged.stale === 1 ? "it" : "them"} yourself.`
			: "";
	if (merged.added === 0 && merged.skipped === 0) {
		return ` The todo list is full, so no plan steps were added${suffix}.${touched} Keep these steps in mind. ${tick}`;
	}
	if (merged.added === 0)
		return ` ${total === 1 ? "The plan's step is" : "Every plan step is"} already in the todo list${suffix}.${touched} ${tick}`;
	return ` Merged ${counted} into the todo list${suffix}.${touched} ${tick}`;
}
