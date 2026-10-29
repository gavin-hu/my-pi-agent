/**
 * The lazy plan review: the command and tool paths load `web.ts` once, the
 * synchronous reads answer before a load, and shutdown closes only an opened review.
 */

import { describe, expect, test } from "bun:test";
import type { PlanStore, StoredPlan } from "./plans.ts";
import type { PlanWebReview } from "./web.ts";
import { createLazyPlanWebReview, type PlanWebModule } from "./web-lazy.ts";

function fakeReview(calls: string[]): PlanWebReview {
	return {
		start: async () => {
			calls.push("start");
			return undefined;
		},
		current: () => undefined,
		share: async () => {
			calls.push("share");
			return undefined;
		},
		stopSharing: async () => {
			calls.push("stopSharing");
			return undefined;
		},
		shareState: () => undefined,
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
}

function moduleOf(review: PlanWebReview): PlanWebModule {
	return { createPlanWebReview: () => review } as unknown as PlanWebModule;
}

const store = {} as PlanStore;
const plan = {} as StoredPlan;
const deps = { mount: async () => ({ kind: "refused" as const, reason: "no server" }), session: () => "" };

describe("the lazy plan review", () => {
	test("loads nothing until a review asks", async () => {
		const calls: string[] = [];
		let loads = 0;
		const review = createLazyPlanWebReview(store, deps, async () => {
			loads += 1;
			return moduleOf(fakeReview(calls));
		});
		expect(review.current()).toBeUndefined();
		expect(review.shareState()).toBeUndefined();
		await review.closeAll();
		expect(loads).toBe(0);
		await review.start("/repo", plan);
		expect(loads).toBe(1);
		await review.closeAll();
		expect(loads).toBe(1);
		expect(calls).toEqual(["start", "closeAll"]);
	});

	test("delegates the share path to the one loaded review", async () => {
		const calls: string[] = [];
		let loads = 0;
		const review = createLazyPlanWebReview(store, deps, async () => {
			loads += 1;
			return moduleOf(fakeReview(calls));
		});
		await review.share();
		await review.stopSharing();
		await review.share();
		expect(loads).toBe(1);
		expect(calls).toEqual(["share", "stopSharing", "share"]);
	});
});
