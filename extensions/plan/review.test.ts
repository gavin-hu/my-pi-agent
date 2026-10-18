import { describe, expect, test } from "bun:test";
import type { PlanAnnotation } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import type { StoredPlan } from "./plans.ts";
import { type ReviewBaselines, reviewPlan, runBrowserReview } from "./review.ts";
import type { PlanReviewOptions, PlanReviewResult, PlanWebReview } from "./web.ts";
import { fakeCtx } from "../../test/helpers/fixtures/plan.ts";

const PLAN_PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";

function plan(content = "# Plan\n\n## Steps\n- [ ] one"): StoredPlan {
	return { path: PLAN_PATH, relativePath: ".pi/plans/2026-10-14-1600-demo.md", content, bytes: content.length };
}

/** A baselines seam that records what was marked and reports the last one. */
function baselines(initial?: string): ReviewBaselines & { marked: Array<{ path: string; content: string }> } {
	const marked: Array<{ path: string; content: string }> = [];
	let shown = initial === undefined ? undefined : sectionDigests(initial);
	return {
		marked,
		reviewed: () => shown,
		markReviewed: (path, content) => {
			marked.push({ path, content });
			shown = sectionDigests(content);
		},
	};
}

/** A browser review that stays open until its page acts or its turn is aborted. */
function webThatWaits() {
	const starts: PlanReviewOptions[] = [];
	const closes: number[] = [];
	const web: PlanWebReview = {
		start: async (_cwd, _plan, options) => {
			starts.push(options ?? {});
			let settle: (result: PlanReviewResult) => void = () => {};
			const done = new Promise<PlanReviewResult>((resolve) => {
				settle = resolve;
			});
			let closed = false;
			const close = async () => {
				if (closed) return;
				closed = true;
				closes.push(1);
				settle({ status: "cancelled" });
			};
			options?.signal?.addEventListener("abort", () => void close());
			return { url: "http://127.0.0.1:1/?token=t", port: 1, done, close };
		},
		closeAll: async () => {},
	};
	return { web, starts, closes };
}

/** A browser review whose page answers immediately. */
function webThatResolves(result: PlanReviewResult) {
	const starts: PlanReviewOptions[] = [];
	const closes: number[] = [];
	const web: PlanWebReview = {
		start: async (_cwd, _plan, options) => {
			starts.push(options ?? {});
			return {
				url: "http://127.0.0.1:1/?token=t",
				port: 1,
				done: Promise.resolve(result),
				close: async () => {
					closes.push(1);
				},
			};
		},
		closeAll: async () => {},
	};
	return { web, starts, closes };
}

/** A browser review whose server never binds. */
function webThatFails(): PlanWebReview {
	return {
		start: async () => {
			throw new Error("bind failed");
		},
		closeAll: async () => {},
	};
}

/** A TUI context whose review screen answers with `choices`, in order. */
function tuiCtx(choices: unknown[], editorAnswers: Array<string | undefined> = []) {
	const { ctx, notifications } = fakeCtx({ mode: "tui" });
	const queue = [...choices];
	const answers = [...editorAnswers];
	let editorCalls = 0;
	ctx.ui.custom = async () => queue.shift();
	ctx.ui.editor = async () => {
		editorCalls++;
		return answers.shift();
	};
	return { ctx, notifications, editorCalls: () => editorCalls };
}

/** Let the loop reach its first await. */
async function started(starts: unknown[]): Promise<void> {
	for (let tick = 0; tick < 20 && starts.length === 0; tick++) await Promise.resolve();
}

const readingPlans = (content = plan()) => ({ read: async () => content });

describe("reviewPlan — the review gate", () => {
	test("an aborted turn closes the browser review and keeps planning", async () => {
		const controller = new AbortController();
		const { web, starts, closes } = webThatWaits();
		const { ctx } = tuiCtx([{ action: "browser" }]);
		const current = plan();

		const pending = reviewPlan({
			ctx,
			web,
			plans: readingPlans(),
			baselines: baselines(),
			plan: current,
			signal: controller.signal,
		});
		await started(starts);
		controller.abort();
		const decision = await pending;

		expect(decision.action).toBe("keep");
		expect(closes).toEqual([1]);
		expect(starts[0]?.canApprove).toBe(true);
		expect(starts[0]?.signal).toBe(controller.signal);
	});

	test("an already-aborted turn never opens a screen or a server", async () => {
		const controller = new AbortController();
		controller.abort();
		const { web, starts } = webThatWaits();
		const { ctx } = tuiCtx([{ action: "browser" }]);

		const decision = await reviewPlan({
			ctx,
			web,
			plans: readingPlans(),
			baselines: baselines(),
			plan: plan(),
			signal: controller.signal,
		});

		expect(decision.action).toBe("keep");
		expect(starts).toEqual([]);
	});

	test("an approval carries the comments the page collected", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "ship it" }];
		const { web, closes } = webThatResolves({ status: "approved", plan: plan(), annotations });
		const { ctx } = tuiCtx([{ action: "browser" }]);

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: baselines(), plan: plan() });

		expect(decision).toMatchObject({ action: "approve", comments: annotations });
		expect(closes).toEqual([1]);
	});

	test("a save comes back as a browser refinement, not an approval", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "make it concrete" }];
		const saved = { ...plan(), content: "# Plan\n> [!REVIEW] make it concrete" };
		const { web } = webThatResolves({ status: "saved", plan: saved, annotations });
		const { ctx } = tuiCtx([{ action: "browser" }]);

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: baselines(), plan: plan() });

		expect(decision).toMatchObject({ action: "refine", fromBrowser: true, comments: annotations });
		if (decision.action !== "refine") throw new Error("expected a refinement");
		expect(decision.refinement).toContain("make it concrete");
		expect(decision.plan.content).toContain("[!REVIEW]");
	});

	test("a server that cannot start re-offers the review screen", async () => {
		const { web } = { web: webThatFails() };
		const { ctx, notifications } = tuiCtx([{ action: "browser" }, { action: "approve" }]);
		const seam = baselines();

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: seam, plan: plan() });

		expect(decision.action).toBe("approve");
		expect(notifications).toContain("Plan review: could not start the browser review server.");
		// The screen was shown twice, so the baseline advanced twice.
		expect(seam.marked).toHaveLength(2);
	});

	test("an empty refine editor returns to the review screen", async () => {
		const { ctx, editorCalls } = tuiCtx([{ action: "refine" }, { action: "approve" }], [""]);

		const decision = await reviewPlan({
			ctx,
			web: webThatFails(),
			plans: readingPlans(),
			baselines: baselines(),
			plan: plan(),
		});

		expect(decision.action).toBe("approve");
		expect(editorCalls()).toBe(1);
	});

	test("a typed refinement is reported as the user's request", async () => {
		const { ctx } = tuiCtx([{ action: "refine" }], ["add tests"]);

		const decision = await reviewPlan({
			ctx,
			web: webThatFails(),
			plans: readingPlans(),
			baselines: baselines(),
			plan: plan(),
		});

		expect(decision).toMatchObject({ action: "refine", refinement: "add tests", fromBrowser: false });
		if (decision.action !== "refine") throw new Error("expected a refinement");
		expect(decision.comments).toEqual([]);
	});

	test("the baseline is what the screen showed, not what the page opened", async () => {
		const { web, starts } = webThatResolves({ status: "approved", plan: plan("# New plan"), annotations: [] });
		const { ctx } = tuiCtx([{ action: "browser" }]);
		const seam = baselines("# Old plan");

		await reviewPlan({ ctx, web, plans: readingPlans(plan("# New plan")), baselines: seam, plan: plan("# New plan") });

		expect(starts[0]?.baseline).toEqual(sectionDigests("# Old plan"));
		expect(seam.marked).toEqual([{ path: PLAN_PATH, content: "# New plan" }]);
	});

	test("an unrecognized screen action keeps planning", async () => {
		const { ctx } = tuiCtx(["approve"]);
		const { web, starts } = webThatWaits();

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: baselines(), plan: plan() });

		expect(decision.action).toBe("keep");
		expect(starts).toEqual([]);
	});
});

describe("runBrowserReview", () => {
	test("reports a server that cannot start", async () => {
		const result = await runBrowserReview(webThatFails(), "/repo", plan(), { canApprove: false });
		expect(result).toBeUndefined();
	});

	test("an aborted turn never opens the server", async () => {
		const controller = new AbortController();
		controller.abort();
		const { web, starts } = webThatWaits();

		const result = await runBrowserReview(web, "/repo", plan(), { canApprove: true, signal: controller.signal });

		expect(result).toEqual({ status: "cancelled" });
		expect(starts).toEqual([]);
	});

	test("reports the session as opened, then closes it", async () => {
		const { web, closes } = webThatResolves({ status: "cancelled" });
		const opened: string[] = [];

		const result = await runBrowserReview(web, "/repo", plan(), {
			canApprove: false,
			onOpened: (session) => opened.push(session.url),
		});

		expect(result).toEqual({ status: "cancelled" });
		expect(opened).toEqual(["http://127.0.0.1:1/?token=t"]);
		expect(closes).toEqual([1]);
	});
});
