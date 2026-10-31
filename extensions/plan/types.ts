/**
 * Shared types for the plan-mode extension.
 */

import type { PlanAnnotation } from "./feedback.ts";
import type { SectionDigest } from "./plan-text.ts";
import type { PlanAction } from "./runtime.ts";

export type { PlanAction };
import type { StepUpdate } from "./steps.ts";

/**
 * Who is looking at a running review: the session that opened it (`owner`, the
 * only role that can approve), or someone the link was shared with (`reviewer`,
 * who may comment).
 */
export type ReviewRole = "owner" | "reviewer";

/**
 * What a review token names: its role, and — for a reviewer — the name it posts
 * under, bound the first time that link writes.
 */
export interface ReviewCaller {
	role: ReviewRole;
	/** The reviewer's name, once this link has written; absent for the owner and
	 * for a reviewer that has not commented yet. */
	name?: string;
}

/**
 * One frame on the review's event stream. `comment`, `plan`, and `share` say a
 * page should re-read the island; `closed` ends the review for everyone, and
 * `revoked` tells a reviewer the owner stopped sharing. The frame carries no
 * state of its own, so the island stays the one contract.
 */
export type ReviewFrame = "comment" | "plan" | "share" | "closed" | "revoked";

/** Persisted (custom entry) plan-mode state. */
export interface PlanModeEntry {
	enabled: boolean;
	/**
	 * Tools plan mode hid when it turned on, so a later disable can restore them.
	 * Persisted with the branch so a `/tree` restore adopts the right list.
	 */
	removed?: string[];
}

/** Persisted (custom entry) review baseline for one plan. */
export interface ReviewBaselineEntry {
	/** Resolved path of the plan file the review showed. */
	path: string;
	/** One digest per heading section, in document order. */
	sections: SectionDigest[];
}

/**
 * What one approval put into the todo list, so the next approval can replace it.
 *
 * A plan refined after it was approved is approved again, and the list still holds the
 * items seeded the first time. Their texts are the only record of which items came from
 * this plan, so a re-approval keeps them to recognise — and replace — its own leftovers
 * without touching an item the user was already tracking.
 */
export interface SeededStepsEntry {
	/** Resolved path of the approved plan file. */
	path: string;
	/** The step texts the approval appended, in order. */
	steps: string[];
}

/** Structured result carried in the `plan` tool's `details` for `action: "enter"`. */
export interface EnterPlanModeDetails {
	/** The verb this result answers, so a renderer reads the result instead of the call. */
	action: "enter";
	/** Whether the user agreed to enter plan mode. */
	entered: boolean;
	/** True when plan mode was already enabled before this call. */
	already?: boolean;
	/** True when no interactive UI was available to confirm. */
	unavailable?: boolean;
}

/** Structured result carried in the `plan` tool's `details` for `action: "write"`. */
export interface WritePlanDetails {
	/** The verb this result answers. */
	action: "write";
	/** Absolute path of the written plan file. */
	path: string;
	/** How the path is shown: `~`-shortened, since plans live outside the project. */
	relativePath: string;
	/** Size of the written plan in bytes. */
	bytes: number;
}

/** Structured result carried in the `plan` tool's `details` for `action: "steps"`. */
export interface SetPlanStepsDetails {
	/** The verb this result answers. */
	action: "steps";
	/** Absolute path of the plan file that was updated. */
	path: string;
	/** How the path is shown: `~`-shortened. */
	relativePath: string;
	/** The checkbox changes that were applied, in call order. */
	updates: StepUpdate[];
	/** Completed steps after the update. */
	done: number;
	/** Total top-level steps in the plan. */
	total: number;
}

/** Structured result carried in the `plan` tool's `details` for `action: "exit"`. */
export interface ExitPlanModeDetails {
	/** The verb this result answers. */
	action: "exit";
	/** Whether the user approved the plan. */
	approved: boolean;
	/** The plan the model submitted, read from its file. */
	plan: string;
	/** Absolute path of the reviewed plan file. */
	planPath?: string;
	/** How the path is shown: `~`-shortened. */
	relativePath?: string;
	/** True when the user asked to refine the plan instead of approving. */
	refined?: boolean;
	/** The refinement the user typed, when `refined` is true. */
	refinement?: string;
	/** Comments the review carried when it approved or requested a refinement. */
	annotations?: PlanAnnotation[];
	/** True when the user left plan mode without approving the plan. */
	cancelled?: boolean;
	/** True when no interactive UI was available to ask for approval. */
	unavailable?: boolean;
}

/** Structured result carried in the `plan` tool's `details` for `action: "cancel"`. */
export interface CancelPlanModeDetails {
	/** The verb this result answers. */
	action: "cancel";
	/** True when plan mode was on and has now been turned off. */
	cancelled: boolean;
}

/**
 * A refused call: the reason, and the verb it named. It carries no `action`
 * field on purpose — a refusal has none of that verb's state to report, and the
 * absent discriminant is what tells a renderer it is looking at a rejection.
 */
export interface RefusedPlanDetails {
	/** The verb the call named. */
	refused: PlanAction;
	/** Why the call was refused, as the model reads it. */
	error: string;
}

/**
 * What the `plan` tool's result carries: one of the five verbs, told apart by
 * `action`, or a refusal that carried no state at all.
 *
 * The details name their own verb so a renderer draws the result it was given
 * rather than re-reading the call's arguments, which a resumed transcript may
 * no longer spell the same way. A details block recorded before the fold has no
 * `action` at all, and a refusal never reaches the per-verb renderers; both take
 * the same fallback.
 */
export type PlanDetails =
	| EnterPlanModeDetails
	| WritePlanDetails
	| ExitPlanModeDetails
	| SetPlanStepsDetails
	| CancelPlanModeDetails
	| RefusedPlanDetails;
