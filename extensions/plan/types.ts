/**
 * Shared types for the plan-mode extension.
 */

import type { PlanAnnotation } from "./feedback.ts";
import type { SectionDigest } from "./plan-text.ts";
import type { StepUpdate } from "./steps.ts";

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

/** Structured result carried in `enter_plan_mode`'s `details`. */
export interface EnterPlanModeDetails {
	/** Whether the user agreed to enter plan mode. */
	entered: boolean;
	/** True when plan mode was already enabled before this call. */
	already?: boolean;
	/** True when no interactive UI was available to confirm. */
	unavailable?: boolean;
}

/** Structured result carried in `write_plan`'s `details`. */
export interface WritePlanDetails {
	/** Absolute path of the written plan file. */
	path: string;
	/** Path relative to the working directory, when inside it. */
	relativePath: string;
	/** Size of the written plan in bytes. */
	bytes: number;
}

/** Structured result carried in `set_plan_steps`'s `details`. */
export interface SetPlanStepsDetails {
	/** Absolute path of the plan file that was updated. */
	path: string;
	/** Path relative to the working directory, for transcript display. */
	relativePath: string;
	/** The checkbox changes that were applied, in call order. */
	updates: StepUpdate[];
	/** Completed steps after the update. */
	done: number;
	/** Total top-level steps in the plan. */
	total: number;
}

/** Structured result carried in `exit_plan_mode`'s `details`. */
export interface ExitPlanModeDetails {
	/** Whether the user approved the plan. */
	approved: boolean;
	/** The plan the model submitted, read from its file. */
	plan: string;
	/** Absolute path of the reviewed plan file. */
	planPath?: string;
	/** Path relative to the working directory, for transcript display. */
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

/** Structured result carried in `cancel_plan_mode`'s `details`. */
export interface CancelPlanModeDetails {
	/** True when plan mode was on and has now been turned off. */
	cancelled: boolean;
}
