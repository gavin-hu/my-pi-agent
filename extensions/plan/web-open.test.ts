/**
 * What a browser review reports about the tab it asked for.
 *
 * The review's server, its routes, and its comment flow are their own suites; this one is
 * the single fact its start adds — whether a tab came, and where to paste the URL when it
 * did not, since the page is the step and a review nobody can see waits on nobody.
 */

import { describe, expect, test } from "bun:test";
import { withAgentDir } from "../../test/helpers/env.ts";
import { makePlanPi, planCtx } from "../../test/helpers/fixtures/plan.ts";
import { recordingLaunch } from "../../test/helpers/launcher.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { createPlanStore, type StoredPlan } from "./plans.ts";
import { runBrowserReview } from "./review.ts";
import { PLAN_TOOL } from "./runtime.ts";
import { createPlanWebReview, type PlanReviewResult, type PlanWebReview } from "./web.ts";

const URL = "http://127.0.0.1:1/?token=t";

function plan(): StoredPlan {
	const content = "- one";
	return {
		path: "/plans/demo.md",
		relativePath: "~/.pi/agent/plans/demo.md",
		content,
		bytes: content.length,
	};
}

/** A review that starts and reports the tab as it settles, the way a launcher does. */
function webThatReports(report: boolean): PlanWebReview {
	return {
		start: async (_cwd, _plan, options) => {
			if (report) options?.onOpenFailure?.("no opener here", URL);
			return {
				url: URL,
				port: 1,
				done: Promise.resolve({ status: "cancelled" } as PlanReviewResult),
				close: async () => {},
			};
		},
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
		closeAll: async () => {},
	};
}

describe("a browser review's tab", () => {
	test("hands a launcher failure on with the URL, so the caller can name where to paste", async () => {
		const reports: string[] = [];

		await runBrowserReview(webThatReports(true), "/repo", plan(), {
			canApprove: false,
			onOpenFailure: (reason, url) => reports.push(`${reason} ${url}`),
		});

		expect(reports).toEqual([`no opener here ${URL}`]);
	});

	test("reports nothing when the tab opened", async () => {
		const reports: string[] = [];
		const opened: string[] = [];

		await runBrowserReview(webThatReports(false), "/repo", plan(), {
			canApprove: false,
			onOpened: (session) => opened.push(session.url),
			onOpenFailure: (reason) => reports.push(reason),
		});

		expect(opened).toEqual([URL]);
		expect(reports).toEqual([]);
	});
});

describe("the page's own start", () => {
	test("opens through the shared opener even with serve.autoOpen off, and names a failure", async () => {
		await withAgentDir(async () => {
			const fakePi = makePlanPi({ active: ["read", PLAN_TOOL] });
			const { ctx } = planCtx({ cwd: "/repo", sessionId: "sess-open", mode: "tui" });
			const store = createPlanStore(fakePi.pi);
			const reports: string[] = [];
			const { launch, calls, child } = recordingLaunch();
			const web = createPlanWebReview(store, { mount: testMountSource(), session: () => "sess-open", launch });

			const session = await web.start(ctx.cwd, plan(), {
				onOpenFailure: (reason, url) => reports.push(`${reason} ${url}`),
			});

			// The tab is the step, so the project's switch does not gate it: the launcher is asked once,
			// and a failure is folded back with the address the caller has to name.
			expect(session).toBeDefined();
			expect(calls).toHaveLength(1);
			child.fail("no opener here");
			expect(reports).toEqual([`no opener here ${session?.url}`]);
			await web.closeAll();
		});
	});

	test("opens no tab on a remote turn", async () => {
		await withAgentDir(async () => {
			const fakePi = makePlanPi({ active: ["read", PLAN_TOOL] });
			const { ctx } = planCtx({ cwd: "/repo", sessionId: "sess-open", mode: "tui" });
			const store = createPlanStore(fakePi.pi);
			const { launch, calls } = recordingLaunch();
			const web = createPlanWebReview(store, { mount: testMountSource(), session: () => "sess-open", launch });

			await web.start(ctx.cwd, plan(), { remote: true });

			expect(calls).toEqual([]);
			await web.closeAll();
		});
	});
});
