/**
 * The plan command surface and the review gate: `/plan review`, `/plan list`,
 * and the one decision flow shared by `exit_plan_mode` and the browser.
 *
 * The runtime and the browser server are doubles, so nothing here writes a plan
 * or opens a socket. `review.ts` is driven through its context and web seams,
 * which is where the abort, baseline, and re-offer rules live.
 */

import { describe, expect, test } from "bun:test";
import { registerCommands } from "./commands.ts";
import type { PlanAnnotation } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import { type ReviewBaselines, reviewPlan, runBrowserReview } from "./review.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanReviewOptions, PlanReviewResult, PlanWebReview } from "./web.ts";
import { fakeCtx, makeFakePi } from "../../test/helpers/fixtures/plan.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";

const PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";

function plan(content = "- one"): StoredPlan {
	return { path: PATH, relativePath: ".pi/plans/2026-10-14-1600-demo.md", content, bytes: content.length };
}

interface RuntimeOptions {
	file?: StoredPlan;
	latest?: StoredPlan;
	last?: string;
	enabled?: boolean;
	baseline?: string;
	summaries?: PlanSummary[];
}

/** The slice of `PlanRuntime` the command reads, with its calls recorded. */
function fakeRuntime(options: RuntimeOptions = {}) {
	const readCalls: string[] = [];
	const latestCalls: string[] = [];
	const indexCalls: string[] = [];
	const enableCalls: string[] = [];
	const marks: Array<{ path: string; content: string }> = [];
	const file = options.file;
	const summaries: PlanSummary[] = options.summaries ?? [];
	let enabled = options.enabled ?? false;
	const runtime = {
		isEnabled: () => enabled,
		enable: () => {
			enableCalls.push("enable");
			enabled = true;
		},
		toggle: () => {
			enabled = !enabled;
		},
		lastPlanPath: () => options.last ?? file?.path,
		reviewed: () => (options.baseline === undefined ? undefined : sectionDigests(options.baseline)),
		markReviewed: (path: string, content: string) => marks.push({ path, content }),
		plans: {
			read: async (_cwd: string, path: string) => {
				readCalls.push(path);
				return file;
			},
			latest: async (cwd: string) => {
				latestCalls.push(cwd);
				return options.latest;
			},
			index: async (cwd: string) => {
				indexCalls.push(cwd);
				return summaries;
			},
			dirFor: async () => "/repo/.pi/plans",
		},
	};
	return { runtime: runtime as unknown as PlanRuntime, readCalls, latestCalls, indexCalls, enableCalls, marks };
}

function fakeWeb(result: PlanReviewResult) {
	const started: StoredPlan[] = [];
	const starts: PlanReviewOptions[] = [];
	const closeCalls: number[] = [];
	const web: PlanWebReview = {
		start: async (_cwd, candidate, options) => {
			started.push(candidate);
			starts.push(options ?? {});
			return {
				url: "http://127.0.0.1:1234/?token=tok",
				port: 1234,
				done: Promise.resolve(result),
				close: async () => {
					closeCalls.push(1);
				},
			};
		},
		closeAll: async () => {},
	};
	return { web, started, starts, closeCalls };
}

function saved(target: StoredPlan, annotations: PlanAnnotation[]): PlanReviewResult {
	return { status: "saved", plan: target, annotations };
}

function setup(
	options: RuntimeOptions & {
		result: PlanReviewResult;
		idle?: boolean;
	},
) {
	const { runtime, readCalls, latestCalls, indexCalls, enableCalls, marks } = fakeRuntime(options);
	const { web, started, starts, closeCalls } = fakeWeb(options.result);
	const pi = makeFakePi();
	registerCommands(pi.pi, runtime, web);
	const { ctx, notifications } = fakeCtx({ cwd: "/repo", isIdle: () => options.idle ?? true });
	return {
		pi,
		ctx,
		notifications,
		runtime,
		readCalls,
		latestCalls,
		indexCalls,
		enableCalls,
		marks,
		started,
		starts,
		closeCalls,
	};
}

describe("/plan review", () => {
	test("opens the most recent plan and sends saved comments to the model", async () => {
		const file = plan();
		const { pi, ctx, notifications, readCalls, started, closeCalls } = setup({
			file,
			result: saved(file, [{ anchor: 0, quote: "one", comment: "make it concrete" }]),
		});

		await pi.commands.get("plan").handler("review", ctx);

		expect(readCalls).toEqual([file.path]);
		expect(started).toEqual([file]);
		expect(notifications.some((message) => message.includes("opened"))).toBe(true);
		expect(closeCalls).toHaveLength(1);
		expect(pi.sentMessages).toHaveLength(1);
		expect(pi.sentMessages[0].content).toContain("make it concrete");
		expect(pi.sentMessages[0].content).toContain("Update the plan file");
	});

	test("asks for a plan-mode revision when plan mode is on", async () => {
		const file = plan();
		const { pi, ctx } = setup({ file, enabled: true, result: saved(file, [{ anchor: 0, comment: "tighten this" }]) });

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages[0]?.content).toContain("Stay in plan mode");
	});

	test("reviews an explicit path after the subcommand", async () => {
		const file = plan();
		const { pi, ctx, readCalls } = setup({ file, result: saved(file, [{ anchor: 0, comment: "note" }]) });

		await pi.commands.get("plan").handler("review /repo/.pi/plans/other.md", ctx);

		expect(readCalls).toEqual(["/repo/.pi/plans/other.md"]);
	});

	test("falls back to the newest plan when the session has not written one", async () => {
		const file = plan("- from an earlier session");
		const { pi, ctx, latestCalls, readCalls, started } = setup({ latest: file, result: saved(file, []) });

		await pi.commands.get("plan").handler("review", ctx);

		expect(latestCalls).toEqual(["/repo"]);
		expect(readCalls).toEqual([]);
		expect(started).toEqual([file]);
	});

	test("prefers the session's own plan over the newest file", async () => {
		const file = plan();
		const other = plan("- newer on disk");
		const { pi, ctx, latestCalls, readCalls, started } = setup({ file, latest: other, result: saved(file, []) });

		await pi.commands.get("plan").handler("review", ctx);

		expect(readCalls).toEqual([file.path]);
		expect(latestCalls).toEqual([]);
		expect(started).toEqual([file]);
	});

	test("hands the previous review's sections to the browser and marks what it shows", async () => {
		const file = plan();
		const { pi, ctx, starts, marks } = setup({ file, baseline: "# Old", result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(starts[0]?.baseline).toEqual(sectionDigests("# Old"));
		expect(marks).toEqual([{ path: file.path, content: file.content }]);
	});

	test("stays quiet when the review is cancelled", async () => {
		const file = plan();
		const { pi, ctx, notifications } = setup({ file, result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications.some((message) => message.includes("closed without saving"))).toBe(true);
	});

	test("sends nothing when the review saved no comments", async () => {
		const file = plan();
		const { pi, ctx, notifications } = setup({ file, result: saved(file, []) });

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications.some((message) => message.includes("no comments"))).toBe(true);
	});

	test("warns and sends nothing when there is no plan", async () => {
		const { pi, ctx, notifications, started } = setup({ result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(started).toEqual([]);
		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications.some((message) => message.includes("no plan"))).toBe(true);
	});

	test("refuses on a remote turn, where the loopback server cannot be reached", async () => {
		const file = plan();
		const { runtime } = fakeRuntime({ file });
		const { web, started } = fakeWeb(saved(file, []));
		const pi = makeFakePi();
		registerCommands(pi.pi, runtime, web);
		const { ctx, notifications } = remoteCtx({ cwd: "/repo" });

		await pi.commands.get("plan").handler("review", ctx);

		expect(started).toEqual([]);
		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications.some((message) => message.includes("local machine"))).toBe(true);
	});

	test("a review server that cannot start leaves the baseline unmarked", async () => {
		const file = plan();
		const { runtime, marks } = fakeRuntime({ file });
		const web: PlanWebReview = {
			start: async () => {
				throw new Error("bind failed");
			},
			closeAll: async () => {},
		};
		const pi = makeFakePi();
		registerCommands(pi.pi, runtime, web);
		const { ctx, notifications } = fakeCtx({ cwd: "/repo" });

		await pi.commands.get("plan").handler("review", ctx);

		expect(marks).toEqual([]);
		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications).toContain("Plan review: could not start the browser review server.");
	});

	test("delivers the refinement as a follow-up while the agent is busy", async () => {
		const file = plan();
		const { pi, ctx } = setup({
			file,
			idle: false,
			result: saved(file, [{ anchor: 0, comment: "tighten this" }]),
		});

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages[0]?.options).toEqual({ deliverAs: "followUp" });
	});

	test("treats a sentence starting with review as a task", async () => {
		const { pi, ctx } = setup({ result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review the auth flow", ctx);

		expect(pi.sentMessages).toEqual([{ content: "review the auth flow", options: undefined }]);
	});
});

describe("/plan list", () => {
	const summaries: PlanSummary[] = [
		{
			path: "/repo/.pi/plans/2026-10-16-1030-add-rate-limiting.md",
			relativePath: ".pi/plans/2026-10-16-1030-add-rate-limiting.md",
			title: "Add rate limiting",
			modified: Date.UTC(2026, 9, 16, 10, 30),
			bytes: 512,
			steps: { done: 3, total: 7 },
		},
	];

	test("lists the plans directory as a notice outside the TUI", async () => {
		const { pi, ctx, notifications, indexCalls } = setup({ result: { status: "cancelled" }, summaries });

		await pi.commands.get("plan").handler("list", ctx);

		expect(indexCalls).toEqual(["/repo"]);
		expect(notifications.at(-1)).toContain("Add rate limiting — 3/7 steps");
		expect(pi.sentMessages).toEqual([]);
		expect(ctx.customCalls).toHaveLength(0);
	});

	test("opens a picker in the TUI and reviews the chosen plan", async () => {
		const { pi, readCalls, started } = setup({
			file: plan(),
			summaries,
			result: { status: "saved", plan: plan(), annotations: [] },
		});
		const { ctx: tuiCtx, notifications } = fakeCtx({ mode: "tui", cwd: "/repo" });
		// The screen selects the first plan immediately, as Enter on a focused row does.
		tuiCtx.ui.custom = async (
			factory: (
				tui: unknown,
				theme: unknown,
				keys: unknown,
				done: () => void,
			) => {
				handleInput(data: string): void;
			},
		) => {
			const component = factory(
				{ requestRender: () => {}, terminal: { rows: 24, columns: 80 } },
				tuiCtx.ui.theme,
				{},
				() => {},
			);
			component.handleInput("\r");
			return undefined;
		};

		await pi.commands.get("plan").handler("list", tuiCtx);

		expect(readCalls).toEqual([summaries[0]?.path]);
		expect(started).toHaveLength(1);
		expect(notifications.some((message) => message.includes("Plan review:"))).toBe(true);
	});

	test("treats a sentence starting with list as a task", async () => {
		const { pi, ctx } = setup({ result: { status: "cancelled" }, summaries });

		await pi.commands.get("plan").handler("list the untracked files", ctx);

		expect(pi.sentMessages).toEqual([{ content: "list the untracked files", options: undefined }]);
	});

	test("completes list alongside review", () => {
		const { pi } = setup({ result: { status: "cancelled" } });
		const complete = (prefix: string): string[] =>
			(pi.commands.get("plan").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);

		expect(complete("")).toEqual(["list", "review"]);
		expect(complete("li")).toEqual(["list"]);
		expect(complete("r")).toEqual(["review"]);
		expect(complete("review ")).toEqual([]);
	});
});

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

describe("review gate", () => {
	test("an aborted turn closes the browser review and keeps planning", async () => {
		const controller = new AbortController();
		const { web, starts, closes } = webThatWaits();
		const { ctx } = tuiCtx([{ action: "browser" }]);

		const pending = reviewPlan({
			ctx,
			web,
			plans: readingPlans(),
			baselines: baselines(),
			plan: plan(),
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
		const revised = { ...plan(), content: "# Plan\n> [!REVIEW] make it concrete" };
		const { web } = webThatResolves({ status: "saved", plan: revised, annotations });
		const { ctx } = tuiCtx([{ action: "browser" }]);

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: baselines(), plan: plan() });

		expect(decision).toMatchObject({ action: "refine", fromBrowser: true, comments: annotations });
		if (decision.action !== "refine") throw new Error("expected a refinement");
		expect(decision.refinement).toContain("make it concrete");
		expect(decision.plan.content).toContain("[!REVIEW]");
	});

	test("a server that cannot start re-offers the review screen", async () => {
		const { ctx, notifications } = tuiCtx([{ action: "browser" }, { action: "approve" }]);
		const seam = baselines();

		const decision = await reviewPlan({
			ctx,
			web: webThatFails(),
			plans: readingPlans(),
			baselines: seam,
			plan: plan(),
		});

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
		const current = plan("# New plan");
		const { web, starts } = webThatResolves({ status: "approved", plan: current, annotations: [] });
		const { ctx } = tuiCtx([{ action: "browser" }]);
		const seam = baselines("# Old plan");

		await reviewPlan({ ctx, web, plans: readingPlans(current), baselines: seam, plan: current });

		expect(starts[0]?.baseline).toEqual(sectionDigests("# Old plan"));
		expect(seam.marked).toEqual([{ path: PATH, content: "# New plan" }]);
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
