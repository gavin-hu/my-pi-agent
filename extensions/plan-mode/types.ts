/**
 * Shared types for the plan-mode extension.
 */

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

/** Structured result carried in `exit_plan_mode`'s `details`. */
export interface ExitPlanModeDetails {
	/** Whether the user approved the plan. */
	approved: boolean;
	/** The plan the model submitted. */
	plan: string;
	/** How many plan steps were seeded into the todo list. */
	seeded?: number;
	/** True when the user asked to refine the plan instead of approving. */
	refined?: boolean;
	/** The refinement the user typed, when `refined` is true. */
	refinement?: string;
	/** True when no interactive UI was available to ask for approval. */
	unavailable?: boolean;
}
