/**
 * Parameter schema and validation for the `goal` tool.
 *
 * Pure: no host APIs, no terminal. Invalid input throws a model-readable
 * `Error` before any state changes, so the model can retry with a corrected
 * objective instead of silently corrupting the goal.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { GOAL_STATUSES, type Goal, type GoalStatus } from "./types.ts";

/** Maximum length of the objective. */
export const MAX_OBJECTIVE = 2000;

const GoalStatusEnum = StringEnum(GOAL_STATUSES, {
	description: 'Whether the goal is still being pursued. Defaults to "active".',
});

export const GoalParams = Type.Object({
	objective: Type.String({
		description: "The complete session goal, as a single line. Pass an empty string to clear the goal.",
	}),
	status: Type.Optional(GoalStatusEnum),
});

export type GoalArgs = Static<typeof GoalParams>;

/**
 * Make model text safe to render on one terminal line.
 *
 * Control characters (including ESC) become spaces so they cannot move the
 * cursor or inject styling, and any whitespace run (newlines, tabs, repeated
 * spaces) collapses to a single space. The widget assumes a single logical
 * line and wraps it itself.
 */
function sanitizeObjective(raw: string): string {
	return raw
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeStatus(raw: unknown): GoalStatus {
	if (raw === undefined) return "active";
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : undefined;
	if (value && (GOAL_STATUSES as readonly string[]).includes(value)) return value as GoalStatus;
	throw new Error(`status must be one of ${GOAL_STATUSES.join(", ")}.`);
}

/**
 * Validate and normalize the model's goal.
 *
 * Returns `null` when the objective is empty or only whitespace, which is the
 * clear signal. Otherwise returns the sanitized objective and a validated
 * status (defaulting to `active`). Rejects an over-long objective and an
 * unknown status.
 */
export function normalizeGoal(raw: unknown): Goal | null {
	const args = (raw ?? {}) as Partial<GoalArgs>;
	// Validate the status first so an unknown value is rejected even when the
	// objective is empty (a clear), matching the documented contract.
	const status = normalizeStatus(args.status);
	const objective = typeof args.objective === "string" ? sanitizeObjective(args.objective) : "";
	if (!objective) return null;
	if (objective.length > MAX_OBJECTIVE) {
		throw new Error(`objective is longer than ${MAX_OBJECTIVE} characters.`);
	}
	return { objective, status };
}

/**
 * Validate a goal read back from a session branch.
 *
 * Unlike `normalizeGoal`, this never throws and returns `null` for anything it
 * cannot render safely. The stored objective is re-sanitized and re-checked
 * against `MAX_OBJECTIVE`, so tampered or migrated session data cannot feed raw
 * escape sequences or unbounded text into the widget or transcript.
 */
export function normalizeStoredGoal(value: unknown): Goal | null {
	if (!value || typeof value !== "object") return null;
	const goal = value as Partial<Goal>;
	if (typeof goal.objective !== "string") return null;
	if (goal.status !== "active" && goal.status !== "achieved") return null;
	const objective = sanitizeObjective(goal.objective);
	if (!objective || objective.length > MAX_OBJECTIVE) return null;
	return { objective, status: goal.status };
}
