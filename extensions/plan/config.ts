/**
 * Behaviour config for the plan extension.
 *
 * The `plan` section of the shared `bytefly.json` (global then project, project
 * wins). It configures the plan store's bound and nothing else: how a plan is
 * named, written and revised is `plans.ts`'s, and plan mode has its own switch.
 */

import { clampInteger } from "../../lib/json.ts";
import { loadConfigSection } from "../../lib/config.ts";

export interface PlanConfig {
	/**
	 * Sweep the plan store automatically.
	 *
	 * Off makes every automatic pass a no-op — after a write, and at session
	 * start — and leaves `/plan prune` the only door. It does not turn the
	 * `plan` tool or plan mode off: this is retention, not the feature.
	 */
	enabled: boolean;
	/** Newest plans kept per repository: the count bound, which removes past its end whatever the age. */
	keep: number;
	/**
	 * Age past which a plan is removed even inside the count bound.
	 *
	 * A second deletion trigger, not a protection: a small store whose oldest plan
	 * is past this loses that plan, which is what keeps a stale store from living
	 * forever under `keep`. `0` makes every plan older than today old enough; a
	 * large value is how the age trigger is made inert.
	 */
	maxAgeDays: number;
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = { enabled: true, keep: 100, maxAgeDays: 180 };

const MIN_KEEP = 1;
const MAX_KEEP = 5_000;
const MIN_AGE_DAYS = 0;
const MAX_AGE_DAYS = 3_650;

/** Validate a raw config object over `base`. */
export function normalizePlanConfig(raw: Record<string, unknown> | undefined, base: PlanConfig): PlanConfig {
	if (!raw) return base;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
		keep: clampInteger(raw.keep, base.keep, MIN_KEEP, MAX_KEEP),
		maxAgeDays: clampInteger(raw.maxAgeDays, base.maxAgeDays, MIN_AGE_DAYS, MAX_AGE_DAYS),
	};
}

/** Effective plan config from the shared `plan` section (defaults, global, project). */
export function loadPlanConfig(cwd: string): PlanConfig {
	return loadConfigSection(cwd, "plan", DEFAULT_PLAN_CONFIG, normalizePlanConfig);
}
