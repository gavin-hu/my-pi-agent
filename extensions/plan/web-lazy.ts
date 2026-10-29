/**
 * The plan review server, loaded when a review first asks for it.
 *
 * The browser review owns `lib/http`, the web kit, and the plan page; none of it
 * is needed to register `/plan` or the plan tools. `index.ts`, `commands.ts`, and
 * `tools.ts` therefore share this proxy over `lib/lazy`: the first review loads
 * `web.ts` once, and `closeAll` on shutdown only closes a review that was already
 * opened, so a session that never reviewed a plan imports none of the server.
 *
 * The synchronous reads (`current`, `shareState`) answer `undefined` until the
 * module is loaded, which is the truth: no review can be open before a load.
 */

import { lazy } from "../../lib/lazy.ts";
import type { PlanStore } from "./plans.ts";
import type { PlanWebReview, PlanWebReviewDeps } from "./web.ts";

/** The review module, as the proxy loads it. */
export type PlanWebModule = typeof import("./web.ts");

/** How the proxy reaches the review module; production uses the dynamic import. */
export type PlanWebLoader = () => Promise<PlanWebModule>;

/**
 * The deps a caller that injects its own review leaves out.
 *
 * A review needs a place on the session's server, so a caller with no wiring says so
 * rather than binding a socket of its own: the start is refused with a sentence.
 */
export const NO_SERVER_DEPS: PlanWebReviewDeps = {
	mount: async () => ({ kind: "refused", reason: "this review has no server wired" }),
	session: () => "",
};

export function createLazyPlanWebReview(
	store: PlanStore,
	deps: PlanWebReviewDeps,
	load: PlanWebLoader = () => import("./web.ts"),
): PlanWebReview {
	const review = lazy(async () => (await load()).createPlanWebReview(store, deps));
	return {
		start: async (cwd, plan, options) => (await review.get()).start(cwd, plan, options),
		current: () => review.peek()?.current(),
		share: async () => (await review.get()).share(),
		stopSharing: async () => (await review.get()).stopSharing(),
		shareState: () => review.peek()?.shareState(),
		// Shutdown must not start a load: a review that never opened has nothing to close.
		closeAll: async () => {
			const opened = review.peek();
			if (opened !== undefined) await opened.closeAll();
		},
	};
}
