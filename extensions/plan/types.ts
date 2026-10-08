/**
 * Shared types for the plan-mode extension.
 */

import type { PlanStep } from "./steps.ts";

/** Persisted (custom entry) plan-mode state. */
export interface PlanModeEntry {
	enabled: boolean;
}

/** Structured result carried in `enter_plan_mode`'s `details`. */
export interface EnterPlanModeDetails {
	/** Whether the user agreed to enter plan mode. */
	entered: boolean;
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
	/** How many plan steps were seeded into the todo list. */
	seeded?: number;
	/** The steps extracted from the plan, whether or not `todo` accepted them. */
	steps?: PlanStep[];
	/** True when the user asked to refine the plan instead of approving. */
	refined?: boolean;
	/** The refinement the user typed, when `refined` is true. */
	refinement?: string;
	/** True when no interactive UI was available to ask for approval. */
	unavailable?: boolean;
}
