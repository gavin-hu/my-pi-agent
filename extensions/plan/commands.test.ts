import { describe, expect, test } from "bun:test";
import { registerCommands } from "./commands.ts";
import type { PlanAnnotation } from "./feedback.ts";
import type { StoredPlan } from "./plans.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanReviewOptions, PlanReviewResult, PlanWebReview } from "./web.ts";
import { fakeCtx, makeFakePi } from "../../test/helpers/fixtures/plan.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";

const PATH = "/repo/.pi/plans/2026-10-14-1600-demo.md";

function plan(content = "- one"): StoredPlan {
	return { path: PATH, relativePath: ".pi/plans/2026-10-14-1600-demo.md", content, bytes: content.length };
}

function fakeRuntime(
	options: { file?: StoredPlan; latest?: StoredPlan; last?: string; enabled?: boolean; previous?: string } = {},
) {
	const readCalls: string[] = [];
	const latestCalls: string[] = [];
	const marks: Array<{ path: string; content: string }> = [];
	const file = options.file;
	const runtime = {
		isEnabled: () => options.enabled ?? false,
		enable: () => {},
		toggle: () => {},
		lastPlanPath: () => options.last ?? file?.path,
		reviewed: () => options.previous,
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
		},
	};
	return { runtime: runtime as unknown as PlanRuntime, readCalls, latestCalls, marks };
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
	previous?: string;
	result: PlanReviewResult;
}) {
	const { runtime, readCalls, latestCalls, marks } = fakeRuntime(options);
	const { web, started, starts, closeCalls } = fakeWeb(options.result);
	const pi = makeFakePi();
	registerCommands(pi.pi, runtime, web);
	const { ctx, notifications } = fakeCtx({ cwd: "/repo" });
	return { pi, ctx, notifications, runtime, readCalls, latestCalls, marks, started, starts, closeCalls };
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

	test("hands the previous review's content to the browser", async () => {
		const file = plan();
		const { pi, ctx, starts, marks } = setup({ file, previous: "# Old", result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review", ctx);

		expect(starts[0].previous).toBe("# Old");
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
		expect(notifications).toContain("plan review: could not start the browser review server.");
	});

	test("still treats other arguments as a task", async () => {
		const { pi, ctx } = setup({ result: { status: "cancelled" } });

		await pi.commands.get("plan").handler("review the auth flow", ctx);

		expect(pi.sentMessages).toEqual([{ content: "review the auth flow", options: undefined }]);
	});
});
