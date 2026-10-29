/**
 * The deferred review gate: it loads the loop once, on the first review of the
 * session, and never at registration.
 */

import { describe, expect, test } from "bun:test";
import type { ReviewModule } from "./review-lazy.ts";
import { reviewPlan, runBrowserReview } from "./review-lazy.ts";

function loader(calls: string[]): () => Promise<ReviewModule> {
	return async () =>
		({
			reviewPlan: async () => {
				calls.push("reviewPlan");
				return { action: "keep", plan: { path: "/p/a.md" } };
			},
			runBrowserReview: async () => {
				calls.push("runBrowserReview");
				return undefined;
			},
		}) as unknown as ReviewModule;
}

const options = {
	ctx: {} as never,
	web: {} as never,
	plans: {} as never,
	baselines: {} as never,
	plan: { path: "/p/a.md" } as never,
};

describe("the deferred review gate", () => {
	test("loads the review module only when a review runs", async () => {
		const calls: string[] = [];
		let loads = 0;
		const load = async (): Promise<ReviewModule> => {
			loads += 1;
			return loader(calls)();
		};
		expect(loads).toBe(0);
		await reviewPlan(options, load);
		expect(loads).toBe(1);
		expect(calls).toEqual(["reviewPlan"]);
	});

	test("passes the browser review's options through", async () => {
		const calls: string[] = [];
		const result = await runBrowserReview(
			{} as never,
			"/repo",
			{ path: "/p/a.md" } as never,
			{ canApprove: false },
			loader(calls),
		);
		expect(result).toBeUndefined();
		expect(calls).toEqual(["runBrowserReview"]);
	});
});
