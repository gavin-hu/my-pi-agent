/**
 * Parameter schema and validation for the `goal` tool.
 *
 * Pure: no host APIs, no terminal. Invalid input throws a model-readable
 * `Error` before any state changes, so the model can retry with a corrected
 * objective instead of silently corrupting the goal.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../lib/format.ts";
import { MAX_GOAL_OBJECTIVE } from "../../lib/goal-state.ts";
import { GOAL_ACTIONS, GOAL_STATUSES, type Goal, type GoalStatus } from "./types.ts";

/**
 * Maximum length of the objective. Owned by `lib/goal-state.ts`, so a reader of
 * the published state applies the same limit as this validator.
 */
export const MAX_OBJECTIVE = MAX_GOAL_OBJECTIVE;

const GoalStatusEnum = StringEnum(GOAL_STATUSES, {
	description: 'Whether the goal is still being pursued. Defaults to "active".',
});

export const GoalParams = Type.Object({
	objective: Type.String({
		description: "The complete session goal, as a single line. Pass an empty string to clear the goal.",
	}),
	status: Type.Optional(GoalStatusEnum),
});

/**
 * Structured result returned as `structuredContent`, mirroring the `details`
 * payload so codemode/scripts can read the goal as data. `goal` is `null` when
 * the goal was cleared.
 */
export const GoalResult = Type.Object({
	goal: Type.Union([
		Type.Object({
			objective: Type.String({ maxLength: MAX_OBJECTIVE }),
			status: StringEnum(GOAL_STATUSES),
		}),
		Type.Null(),
	]),
	action: StringEnum(GOAL_ACTIONS),
	error: Type.Optional(Type.String()),
});

export type GoalArgs = Static<typeof GoalParams>;

function normalizeStatus(raw: unknown): GoalStatus {
	if (raw === undefined) return "active";
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : undefined;
	if (value && (GOAL_STATUSES as readonly string[]).includes(value)) return value as GoalStatus;
	throw new Error(`status must be one of ${GOAL_STATUSES.join(", ")}.`);
}

/**
 * Validate and normalize the model's goal.
 *
 * Returns `null` when the objective is empty or only whitespace on an
 * active/default goal, which is the clear signal. A blank objective with
 * `status: "achieved"` is rejected instead, so completing a goal can never be
 * mistaken for clearing it. Otherwise returns the sanitized objective and a
 * validated status (defaulting to `active`). Rejects an over-long objective and
 * an unknown status.
 */
export function normalizeGoal(raw: unknown): Goal | null {
	const args = (raw ?? {}) as Partial<GoalArgs>;
	// Validate the status first so an unknown value is rejected even when the
	// objective is empty (a clear), matching the documented contract.
	const status = normalizeStatus(args.status);
	// `sanitizeLine` is the shared boundary for model text: control characters
	// become spaces and the result collapses to one line.
	const objective = typeof args.objective === "string" ? sanitizeLine(args.objective) : "";
	if (!objective) {
		// An empty objective is the clear signal — but only for an active/default
		// goal. "Achieved" is a transition that must carry the objective it
		// completes, so a blank objective here is a model error, not a clear.
		if (status === "achieved") {
			throw new Error(
				'an empty objective clears the goal; to mark the goal achieved, resend the full objective with status "achieved".',
			);
		}
		return null;
	}
	if (objective.length > MAX_OBJECTIVE) {
		throw new Error(`objective is longer than ${MAX_OBJECTIVE} characters.`);
	}
	return { objective, status };
}
