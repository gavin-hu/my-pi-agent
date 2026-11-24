/**
 * The `/plan` command's double for the mode's runtime.
 *
 * Declared against `Partial<PlanRuntime>` rather than cast past it. A double is the one place a moved
 * interface can hide, and this one had drifted three ways while `as unknown as PlanRuntime` absorbed
 * it: `enable` answered nothing where the gate hands back its refusal sentence, `toggle` answered
 * nothing where it owes the state it left, and `plans` was missing three of `PlanStore`'s methods
 * (#862, found through #859's signature move and #860's revert).
 *
 * `Partial<>` is shallow, so a member whose *type* is an interface — `plans` — is still checked whole:
 * the three methods the command never calls are stubs that say so, rather than a nested cast back into
 * the hole the top-level cast used to be.
 */

import { sectionDigests } from "../../extensions/plan/plan-text.ts";
import type { PlanStore, PlanSummary, StoredPlan } from "../../extensions/plan/plans.ts";
import type { PlanRuntime } from "../../extensions/plan/runtime.ts";

/** What the command's cases configure. */
export interface PlanCommandOptions {
	/** The plan a read answers with. */
	file?: StoredPlan;
	/** The plan the footer chip last wrote. */
	last?: string;
	/** Whether the mode is on before the first call. */
	enabled?: boolean;
	/** The markdown a review baseline was taken from. */
	baseline?: string;
	/** The plans `/plan list` lists. */
	summaries?: PlanSummary[];
}

/** The double, and the calls it recorded for a case to assert on. */
export interface FakePlanRuntime {
	runtime: PlanRuntime;
	readCalls: string[];
	indexCalls: string[];
	enableCalls: string[];
	marks: Array<{ path: string; content: string }>;
}

export function fakePlanRuntime(options: PlanCommandOptions = {}): FakePlanRuntime {
	const readCalls: string[] = [];
	const indexCalls: string[] = [];
	const enableCalls: string[] = [];
	const marks: Array<{ path: string; content: string }> = [];
	const summaries = options.summaries ?? [];
	let enabled = options.enabled ?? false;
	const plans: PlanStore = {
		read: async (_cwd, path) => {
			readCalls.push(path);
			return options.file;
		},
		index: async (cwd) => {
			indexCalls.push(cwd);
			return summaries;
		},
		dirFor: async () => "~/.pi/agent/plans/a1f9c02",
		takeNotice: () => undefined,
		// The command door reads plans and signs them; it never writes one. Saying so is the point —
		// a stub that returned a plan would be a lie a later case could come to rely on.
		write: async () => {
			throw new Error("the /plan command door writes no plan");
		},
		setSteps: async () => {
			throw new Error("the /plan command door sets no steps");
		},
		saveFeedback: async () => {
			throw new Error("the /plan command door saves no feedback");
		},
	};
	const runtime: Partial<PlanRuntime> = {
		isEnabled: () => enabled,
		// `undefined` is "the mode is on", the same answer the real gate gives after enabling it.
		enable: () => {
			enableCalls.push("enable");
			enabled = true;
			return undefined;
		},
		toggle: () => {
			enabled = !enabled;
			return enabled;
		},
		disable: () => {
			enabled = false;
		},
		lastPlanPath: () => options.last ?? options.file?.path,
		reviewed: () => (options.baseline === undefined ? undefined : sectionDigests(options.baseline)),
		markReviewed: (path: string, content: string) => marks.push({ path, content }),
		plans,
	};
	return { runtime: runtime as PlanRuntime, readCalls, indexCalls, enableCalls, marks };
}
