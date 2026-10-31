/**
 * The plan review gate, loaded when a review actually asks a human.
 *
 * `review.ts` owns the loop, the TUI screen (`tui.ts`), the compact remote prompt,
 * and the baseline rule — about 1,000 lines that registration never needs:
 * `/plan review` and the `plan` tool's `exit` action are the only two doors in. Both import this
 * module instead, so the loop loads once, on the first review of the session.
 *
 * The types are `review.ts`'s, imported here as types: an import of that kind is erased, so
 * the facade defers the loop without paying for it, and the two modules cannot disagree
 * about what a review hands back.
 */

import type { ReviewDecision, ReviewPlanOptions } from "./review.ts";
import type { StoredPlan } from "./plans.ts";
import type { PlanReviewResult, PlanReviewSession, PlanWebReview } from "./web.ts";

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
