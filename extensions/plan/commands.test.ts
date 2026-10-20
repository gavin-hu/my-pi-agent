import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { registerCommands } from "./commands.ts";
import type { PlanAnnotation } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanReviewOptions, PlanReviewResult, PlanWebReview } from "./web.ts";
import { fakeCtx, makeFakePi } from "../../test/helpers/fixtures/plan.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";

const PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";

function plan(content = "- one"): StoredPlan {
	return { path: PATH, relativePath: ".pi/plans/2026-10-14-1600-demo.md", content, bytes: content.length };
}

function fakeRuntime(
	options: {
		file?: StoredPlan;
		latest?: StoredPlan;
		last?: string;
		enabled?: boolean;
		baseline?: string;
		summaries?: PlanSummary[];
	} = {},
) {
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

function saved(p: StoredPlan, annotations: PlanAnnotation[]): PlanReviewResult {
	return { status: "saved", plan: p, annotations };
}

function setup(options: {
	file?: StoredPlan;
	latest?: StoredPlan;
	last?: string;
	enabled?: boolean;
	baseline?: string;
	summaries?: PlanSummary[];
	result: PlanReviewResult;
	idle?: boolean;
}) {
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

	test("asks for plan-mode revision when plan mode is on", async () => {
		const file = plan();
		const { pi, ctx } = setup({ file, enabled: true, result: saved(file, [{ anchor: 0, comment: "tighten this" }]) });

		await pi.commands.get("plan").handler("review", ctx);

		expect(pi.sentMessages[0].content).toContain("Stay in plan mode");
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

	test("hands the previous review's sections to the browser", async () => {
		const file = plan();
		const { pi, ctx, starts, marks } = setup({ file, baseline: "# Old", result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(starts[0].baseline).toEqual(sectionDigests("# Old"));
		expect(marks).toEqual([{ path: file.path, content: file.content }]);
	});

	test("prefers the session's own plan over the newest file", async () => {
		const file = plan();
		const other = plan("- newer on disk");
		const { pi, ctx, latestCalls, readCalls, started } = setup({
			file,
			latest: other,
			result: saved(file, []),
		});

		await pi.commands.get("plan").handler("review", ctx);

		expect(readCalls).toEqual([file.path]);
		expect(latestCalls).toEqual([]);
		expect(started).toEqual([file]);
	});

	test("warns and sends nothing when there is no plan", async () => {
		const { pi, ctx, notifications, started } = setup({ result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(started).toEqual([]);
		expect(pi.sentMessages).toHaveLength(0);
		expect(notifications.some((message) => message.includes("no plan"))).toBe(true);
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
		expect(notifications).toContain("Plan review: could not start the browser review server.");
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
			tuiCtx.ui.custom = async (factory: any) => {
				const component = factory(
					{ requestRender: () => {}, terminal: { rows: 24, columns: 80 } },
					fakeCtx({ mode: "tui" }).ctx.ui.theme,
					{},
					() => {},
				);
				component.handleInput("\r");
				return undefined;
			};

			await pi.commands.get("plan").handler("list", tuiCtx);

			// The chosen row is what the review reads, and the browser was opened for it.
			expect(readCalls).toEqual([summaries[0]?.path]);
			expect(started).toHaveLength(1);
			expect(notifications.some((message) => message.includes("Plan review:"))).toBe(true);
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

		test("treats a sentence starting with list as a task", async () => {
			const { pi, ctx } = setup({ result: { status: "cancelled" }, summaries });

			await pi.commands.get("plan").handler("list the untracked files", ctx);

			expect(pi.sentMessages).toEqual([{ content: "list the untracked files", options: undefined }]);
		});
	});

	test("still treats other arguments as a task", async () => {
		const { pi, ctx } = setup({ result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review the auth flow", ctx);

		expect(pi.sentMessages).toEqual([{ content: "review the auth flow", options: undefined }]);
	});
});

describe("init skill", () => {
	test("packages a built-in interview, plan-first, quality-gated skill", () => {
		const skill = readFileSync(join(import.meta.dir, "../../skills/init/SKILL.md"), "utf-8");
		const questions = readFileSync(
			join(import.meta.dir, "../../skills/init/references/interview-questions.md"),
			"utf-8",
		);
		const quality = readFileSync(join(import.meta.dir, "../../skills/init/references/agents-md-quality.md"), "utf-8");

		expect(skill).toContain("name: init");
		expect(skill).toContain("ask_user_question");
		expect(skill).toContain("Existing project, no `AGENTS.md`");
		expect(skill).toContain("Empty or near-empty repository");
		expect(skill).toContain("record each unanswered gap under assumptions");
		expect(skill).toContain("exit_plan_mode");
		expect(skill).toContain("references/interview-questions.md");
		expect(skill).toContain("references/agents-md-quality.md");
		expect(questions).toContain("## Deterministic default sets");
		expect(questions).toContain("| Isolation |");
		expect(questions).toContain("| Existing file |");
		expect(questions).toContain("| Stack |");
		expect(quality).toContain("## Question-bank use");
		expect(quality).toContain("## Interview quality");
		expect(quality).toContain("## Existing files");
		expect(quality).toContain("## Empty repository");
		expect(quality).toContain("## Final read-back");
	});
});
