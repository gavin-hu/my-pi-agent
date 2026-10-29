/**
 * The plan review gate, loaded when a review actually asks a human.
 *
 * `review.ts` owns the loop, the TUI screen (`tui.ts`), the compact remote prompt,
 * and the baseline rule — about 1,000 lines that registration never needs:
 * `/plan review` and `exit_plan_mode` are the only two doors in. Both import this
 * module instead, so the loop loads once, on the first review of the session.
 *
 * The types stay here rather than in `review.ts` because a type import is erased:
 * `exit_plan_mode` declares its details from them at registration time.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { SectionDigest } from "./plan-text.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import type { PlanAnnotation } from "./feedback.ts";
import type { PlanReviewResult, PlanReviewSession, PlanWebReview } from "./web.ts";

/** A choice from the review screen, with the refinement the screen carried, if any. */
export interface PlanReviewChoice {
	action: "approve" | "refine" | "keep" | "cancel";
	refinement?: string;
}

/** What a review decided, and the plan state it decided on. */
export type ReviewDecision =
	| { action: "approve"; plan: StoredPlan; comments: PlanAnnotation[] }
	| {
			action: "refine";
			plan: StoredPlan;
			/** The refinement request: the saved comments, or what the user typed. */
			refinement: string;
			comments: PlanAnnotation[];
			/** True when the request came from the browser, which is reported differently. */
			fromBrowser: boolean;
	  }
	| { action: "keep"; plan: StoredPlan }
	/** Leave plan mode without approving; the plan file stays for a later review. */
	| { action: "cancel"; plan: StoredPlan };

/** What the previous review showed, so this one can mark what changed. */
export interface ReviewBaselines {
	/** The sections the last review of `path` showed, when this branch has one. */
	reviewed(path: string): SectionDigest[] | undefined;
	/** Remember what a review just showed, as a session entry on this branch. */
	markReviewed(path: string, content: string): void;
}

/** Everything one review needs: whom to ask, where to ask, and what to compare against. */
export interface ReviewPlanOptions {
	ctx: ExtensionToolContext;
	web: PlanWebReview;
	/** Re-read the plan after a browser review that may have changed it. */
	plans: PlanStore;
	baselines: ReviewBaselines;
	plan: StoredPlan;
	/** Aborting the turn closes the browser server. */
	signal?: AbortSignal;
}

/** The review module, as the loader returns it. */
export type ReviewModule = typeof import("./review.ts");

/** How a review reaches its implementation; production uses the dynamic import. */
export type ReviewLoader = () => Promise<ReviewModule>;

/** Ask the human about `plan` and return one decision, loading the gate on first use. */
export async function reviewPlan(options: ReviewPlanOptions, load?: ReviewLoader): Promise<ReviewDecision> {
	const review = await (load ?? (() => import("./review.ts")))();
	return review.reviewPlan(options);
}

/** The browser-only review `/plan review` opens, loaded on first use. */
export async function runBrowserReview(
	web: PlanWebReview,
	cwd: string,
	plan: StoredPlan,
	options: Parameters<ReviewModule["runBrowserReview"]>[3],
	load?: ReviewLoader,
): Promise<PlanReviewResult | undefined> {
	const review = await (load ?? (() => import("./review.ts")))();
	return review.runBrowserReview(web, cwd, plan, options);
}

export type { PlanReviewSession };
