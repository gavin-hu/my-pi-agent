/**
 * The plan command surface and the review gate: `/plan list`'s view,
 * and the one decision flow shared by the `exit` action and the browser.
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
import { planCtx, makePlanPi } from "../../test/helpers/fixtures/plan.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";

const PATH = "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md";

function plan(content = "- one"): StoredPlan {
	return {
		path: PATH,
		relativePath: "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md",
		content,
		bytes: content.length,
	};
}

interface RuntimeOptions {
	file?: StoredPlan;
	last?: string;
	enabled?: boolean;
	baseline?: string;
	summaries?: PlanSummary[];
}

/** The slice of `PlanRuntime` the command reads, with its calls recorded. */
function fakeRuntime(options: RuntimeOptions = {}) {
	const readCalls: string[] = [];
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
		disable: () => {
			enabled = false;
		},
		lastPlanPath: () => options.last ?? file?.path,
		reviewed: () => (options.baseline === undefined ? undefined : sectionDigests(options.baseline)),
		markReviewed: (path: string, content: string) => marks.push({ path, content }),
		plans: {
			read: async (_cwd: string, path: string) => {
				readCalls.push(path);
				return file;
			},
			index: async (cwd: string) => {
				indexCalls.push(cwd);
				return summaries;
			},
			dirFor: async () => "~/.pi/agent/plans/a1f9c02",
			takeNotice: () => undefined,
		},
	};
	return { runtime: runtime as unknown as PlanRuntime, readCalls, indexCalls, enableCalls, marks };
}

function fakeWeb() {
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
				done: Promise.resolve({ status: "cancelled" } as PlanReviewResult),
				close: async () => {
					closeCalls.push(1);
				},
			};
		},
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
		closeAll: async () => {},
	};
	return { web, started, starts, closeCalls };
}

function setup(options: RuntimeOptions & { idle?: boolean } = {}) {
	const { runtime, readCalls, indexCalls, enableCalls, marks } = fakeRuntime(options);
	const { web, started, starts, closeCalls } = fakeWeb();
	const pi = makePlanPi();
	registerCommands(pi.pi, runtime, web);
	const { ctx, notifications } = planCtx({ cwd: "/repo", isIdle: () => options.idle ?? true });
	return {
		pi,
		ctx,
		notifications,
		runtime,
		readCalls,
		indexCalls,
		enableCalls,
		marks,
		started,
		starts,
		closeCalls,
	};
}

describe("/plan retired subcommands", () => {
	test("sends a line beginning with share to the model", async () => {
		const { pi, runtime } = (() => {
			const built = setup();
			return { pi: built.pi, runtime: built.runtime };
		})();
		const { ctx } = planCtx({ cwd: "/repo" });

		await pi.commands.get("plan").handler("share the load between two sessions", ctx);

		expect(pi.sentMessages).toHaveLength(1);
		expect(pi.sentMessages[0]?.content).toContain("share the load");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("sends a line beginning with cancel to the model", async () => {
		const { pi, runtime } = setup();
		const { ctx } = planCtx({ cwd: "/repo" });

		await pi.commands.get("plan").handler("cancel that idea", ctx);

		expect(pi.sentMessages).toEqual([{ content: "cancel that idea", options: undefined }]);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("sends a line beginning with review to the model", async () => {
		// The browser review is the exit screen's browser step now, so neither a bare
		// `review` nor a path after it opens anything: both are planning tasks.
		const { pi } = setup();
		const { ctx } = planCtx({ cwd: "/repo" });

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages).toEqual([{ content: "review", options: undefined }]);
	});
});

describe("/plan list", () => {
	const summaries: PlanSummary[] = [
		{
			path: "~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			relativePath: "~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			title: "Add rate limiting",
			modified: Date.UTC(2026, 9, 16, 10, 30),
			bytes: 512,
			steps: { done: 3, total: 7 },
		},
	];

	test("lists the plans directory as a notice outside the TUI", async () => {
		const { pi, ctx, notifications, indexCalls } = setup({ summaries });

		await pi.commands.get("plan").handler("list", ctx);

		expect(indexCalls).toEqual(["/repo"]);
		expect(notifications.at(-1)).toContain("Add rate limiting — 3/7 steps");
		expect(pi.sentMessages).toEqual([]);
		expect(ctx.customCalls).toHaveLength(0);
	});

	test("opens a picker in the TUI and reads the chosen plan", async () => {
		const { pi, readCalls, started, starts, marks } = setup({ file: plan(), summaries });
		const { ctx: tuiCtx, notifications } = planCtx({ mode: "tui", cwd: "/repo" });
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
		expect({ started: started.length, mode: starts[0]?.mode, marks }).toEqual({ started: 1, mode: "view", marks: [] });
		expect(notifications.some((line) => line.includes("Plan view:"))).toBe(true);
	});

	test("hides the goal and todo rails while the picker is open", async () => {
		const { pi } = setup({ summaries });
		const seen: unknown[] = [];
		pi.pi.events.on("my-pi-agent/rails-screen", (value: unknown) => seen.push(value));
		const { ctx: tuiCtx } = planCtx({ mode: "tui", cwd: "/repo" });
		tuiCtx.ui.custom = async () => undefined;

		await pi.commands.get("plan").handler("list", tuiCtx);

		expect(seen).toEqual([true, false]);
	});

	test("refuses to open the browser on a remote turn", async () => {
		const { pi, started } = setup({ file: plan(), summaries });
		const { ctx: remote } = remoteCtx({ cwd: "/repo" });
		// The screen selects the first plan, as Enter on a focused row does.
		remote.ui.custom = async (
			factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => { handleInput(data: string): void },
		) => {
			const component = factory(
				{ requestRender: () => {}, terminal: { rows: 24, columns: 80 } },
				remote.ui.theme,
				{},
				() => {},
			);
			component.handleInput("\r");
			return undefined;
		};

		await pi.commands.get("plan").handler("list", remote);

		// The page would open on this machine's screen, in the middle of a conversation
		// being answered from somewhere else: refused, and nothing is sent.
		expect(started).toEqual([]);
		expect(pi.sentMessages).toHaveLength(0);
	});

	test("treats a sentence starting with list as a task", async () => {
		const { pi, ctx } = setup({ summaries });

		await pi.commands.get("plan").handler("list the untracked files", ctx);

		expect(pi.sentMessages).toEqual([{ content: "list the untracked files", options: undefined }]);
	});

	test("completes the one reserved word", () => {
		const { pi } = setup();
		const complete = (prefix: string): string[] =>
			(pi.commands.get("plan").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);

		expect(complete("")).toEqual(["list"]);
		expect(complete("li")).toEqual(["list"]);
		expect(complete("r")).toEqual([]);
		expect(complete("s")).toEqual([]);
		expect(complete("c")).toEqual([]);
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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
		closeAll: async () => {},
	};
}

/** A TUI context whose review screen answers with `choices`, in order. */
function tuiCtx(choices: unknown[], editorAnswers: Array<string | undefined> = []) {
	const { ctx, notifications } = planCtx({ mode: "tui" });
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

	test("a save with no comments returns to the review screen", async () => {
		const { web } = webThatResolves({ status: "saved", plan: plan(), annotations: [] });
		const { ctx } = tuiCtx([{ action: "browser" }, { action: "approve" }]);
		const seam = baselines();

		const decision = await reviewPlan({ ctx, web, plans: readingPlans(), baselines: seam, plan: plan() });

		// Nothing was asked for, so the screen is shown again rather than the model being
		// told to read comments that do not exist.
		expect(decision.action).toBe("approve");
		expect(seam.marked).toHaveLength(2);
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
