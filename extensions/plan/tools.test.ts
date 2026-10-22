import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import type { ExistingTodo } from "../../lib/todo-state.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";
import { fakeCtx, makeFakePi } from "../../test/helpers/fixtures/plan.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";
import type { PlanAnnotation } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import { createPlanPolicy } from "./policy.ts";
import {
	CANCEL_TOOL,
	createPlanRuntime,
	ENTER_TOOL,
	EXIT_TOOL,
	SET_PLAN_STEPS_TOOL,
	WRITE_PLAN_TOOL,
} from "./runtime.ts";
import { MAX_STEP_LENGTH, MAX_STEPS } from "./steps.ts";
import { DEFAULT_TODO_MAX, mergeTodos, mirrorStepStatuses } from "./todos.ts";
import { registerTools } from "./tools.ts";
import type { PlanReviewOptions, PlanWebReview } from "./web.ts";

function repoExec(root: string) {
	return async (command: string, args: string[]) =>
		command === "git" && args[0] === "rev-parse"
			? { stdout: `${root}\n`, stderr: "", code: 0 }
			: { stdout: "", stderr: "", code: 1 };
}

function setup(web?: PlanWebReview, options: { allTools?: unknown[] } = {}) {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-tools-")));
	const fake = makeFakePi({
		active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo"],
		exec: repoExec(root),
		allTools: options.allTools,
	});
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime, web);
	return {
		...fake,
		runtime,
		root,
		enter: fake.tools.get(ENTER_TOOL),
		exit: fake.tools.get(EXIT_TOOL),
		cancel: fake.tools.get(CANCEL_TOOL),
		write: fake.tools.get(WRITE_PLAN_TOOL),
		setSteps: fake.tools.get(SET_PLAN_STEPS_TOOL),
	};
}

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

/** A branch carrying one successful todo tool result. */
function todoBranch(todos: Array<{ content: string; status: string }>, error?: string): unknown[] {
	return [
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: TODO_TOOL,
				details: error === undefined ? { todos, action: "write" } : { todos, action: "write", error },
			},
		},
	];
}

/** A web review controller whose session resolves with `annotations` saved. */
function webThatSaves(annotations: PlanAnnotation[]): PlanWebReview {
	return {
		start: async (_cwd, plan) => ({
			url: "http://127.0.0.1:1234/?token=tok",
			port: 1234,
			done: Promise.resolve({
				status: "saved" as const,
				plan: { ...plan, content: `${plan.content}\n> [!REVIEW] ${annotations[0]?.comment ?? ""}` },
				annotations,
			}),
			close: async () => {},
		}),
		closeAll: async () => {},
	};
}

/** A web review controller whose session resolves cancelled. */
function webThatCancels(): PlanWebReview {
	return {
		start: async () => ({
			url: "http://127.0.0.1:1234/?token=tok",
			port: 1234,
			done: Promise.resolve({ status: "cancelled" as const }),
			close: async () => {},
		}),
		closeAll: async () => {},
	};
}

/** A web review controller whose session resolves approved, recording its start options. */
function webThatApproves(annotations: PlanAnnotation[]): { web: PlanWebReview; starts: PlanReviewOptions[] } {
	const starts: PlanReviewOptions[] = [];
	const web: PlanWebReview = {
		start: async (_cwd, plan, options) => {
			starts.push(options ?? {});
			return {
				url: "http://127.0.0.1:1234/?token=tok",
				port: 1234,
				done: Promise.resolve({ status: "approved" as const, plan, annotations }),
				close: async () => {},
			};
		},
		closeAll: async () => {},
	};
	return { web, starts };
}

/** Enter plan mode through the real tool, in a repository rooted at `cwd`. */
async function enterPlan(enter: any, runtime: any, cwd: string) {
	const { ctx } = fakeCtx({ confirm: true, cwd });
	await call(enter, {}, ctx);
	expect(runtime.isEnabled()).toBe(true);
}

/** Save a plan file through the real tool and return its path. */
async function savePlan(write: any, ctx: any, content: string): Promise<string> {
	const result = await call(write, { title: "Test plan", content }, ctx);
	expect(result.isError).toBeUndefined();
	return (result.details as { path: string }).path;
}

/** Approve a saved plan through the real tool, leaving plan mode. */
async function approvePlan(exit: any, planPath: string, cwd: string) {
	await call(exit, { plan_path: planPath }, fakeCtx({ select: "Approve and execute", cwd }).ctx);
}

/** A plan whose `Steps` section holds `count` top-level steps. */
function planWithSteps(count: number): string {
	const steps = Array.from({ length: count }, (_, index) => `- [ ] step ${index}`).join("\n");
	return `## Steps\n${steps}`;
}

describe("plan tool registration", () => {
	test("registers four sequential tools with the plan-mode annotations", () => {
		const { enter, write, exit, setSteps } = setup();
		const cases: Array<[any, Record<string, unknown>]> = [
			[enter, { readOnlyHint: true, openWorldHint: false }],
			[write, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }],
			[exit, { readOnlyHint: true, openWorldHint: false }],
			[setSteps, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
		];
		for (const [tool, annotations] of cases) {
			expect(tool.executionMode).toBe("sequential");
			expect(tool.annotations).toMatchObject(annotations);
			expect(tool.promptSnippet.length).toBeGreaterThan(0);
		}
	});

	test("activates enter_plan_mode and set_plan_steps by default, not the plan-mode-only pair", () => {
		const { enter, write, exit, setSteps } = setup();
		expect(enter.defaultActive).toBeUndefined();
		expect(setSteps.defaultActive).toBeUndefined();
		expect(exit.defaultActive).toBe(false);
		expect(write.defaultActive).toBe(false);
	});
});

describe("plan approval merge", () => {
	const step = (content: string, status: "pending" | "completed" = "pending") => ({ content, status });

	const existing: ExistingTodo[] = [
		{ content: "Update CHANGELOG", status: "completed" },
		{ content: "Fix the flaky test", status: "pending" },
	];

	test("keeps existing items and appends the plan's steps", () => {
		const merged = mergeTodos(existing, [step("Add a token bucket"), step("Wire the limiter")], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([
			{ content: "Update CHANGELOG", status: "completed" },
			{ content: "Fix the flaky test", status: "pending" },
			{ content: "Add a token bucket", status: "pending" },
			{ content: "Wire the limiter", status: "pending" },
		]);
		expect(merged).toMatchObject({ added: 2, skipped: 0, kept: 2, deferred: 0 });
	});

	test("skips a step already in the list regardless of case and spacing", () => {
		const merged = mergeTodos(
			existing,
			[step("  fix   the FLAKY test "), step("Add a token bucket")],
			DEFAULT_TODO_MAX,
		);
		expect(merged.added).toBe(1);
		expect(merged.skipped).toBe(1);
		expect(merged.todos.map((todo) => todo.content)).toEqual([
			"Update CHANGELOG",
			"Fix the flaky test",
			"Add a token bucket",
		]);
	});

	test("keeps an existing status rather than the step's", () => {
		const merged = mergeTodos(
			[{ content: "Done already", status: "completed" }],
			[step("Done already")],
			DEFAULT_TODO_MAX,
		);
		expect(merged.todos).toEqual([{ content: "Done already", status: "completed" }]);
		expect(merged).toMatchObject({ added: 0, skipped: 1, kept: 1 });
	});

	test("fills activeForm for a legacy in-progress item", () => {
		const merged = mergeTodos([{ content: "Halfway", status: "in_progress" }], [], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([{ content: "Halfway", status: "in_progress", activeForm: "Halfway" }]);
	});

	test("defers steps beyond the cap without dropping existing items", () => {
		const full: ExistingTodo[] = Array.from({ length: DEFAULT_TODO_MAX }, (_, index) => ({
			content: `Existing ${index}`,
			status: "pending" as const,
		}));
		const merged = mergeTodos(full, [step("Extra one"), step("Extra two")], DEFAULT_TODO_MAX);
		expect(merged.todos).toHaveLength(DEFAULT_TODO_MAX);
		expect(merged).toMatchObject({ added: 0, skipped: 0, kept: DEFAULT_TODO_MAX, deferred: 2 });
	});

	test("appends what fits when the list is nearly full", () => {
		const nearlyFull: ExistingTodo[] = Array.from({ length: DEFAULT_TODO_MAX - 1 }, (_, index) => ({
			content: `Existing ${index}`,
			status: "pending" as const,
		}));
		const merged = mergeTodos(nearlyFull, [step("Fits"), step("Overflow")], DEFAULT_TODO_MAX);
		expect(merged).toMatchObject({ added: 1, deferred: 1 });
		expect(merged.todos.at(-1)?.content).toBe("Fits");
	});

	test("seeds the steps into an empty list", () => {
		const merged = mergeTodos([], [step("First"), step("Second", "completed")], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([
			{ content: "First", status: "pending" },
			{ content: "Second", status: "completed" },
		]);
		expect(merged).toMatchObject({ added: 2, skipped: 0, kept: 0, deferred: 0 });
	});

	test("appends the verification item after the steps without counting it as one", () => {
		const steps = [{ content: "Add the cache", status: "pending" as const }];
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([], steps, 50, verification);

		expect(merged.todos.map((todo) => todo.content)).toEqual(["Add the cache", "Verify: bun run check passes"]);
		expect(merged.added).toBe(1);
		expect(merged.trailing).toBe("added");
	});

	test("skips a verification item the list already holds", () => {
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([verification], [step("Add the cache")], 50, verification);
		expect(merged.trailing).toBe("skipped");
		expect(merged.todos.filter((todo) => todo.content === verification.content)).toHaveLength(1);
	});

	test("defers a verification item when the list is full, after the steps fit", () => {
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([{ content: "existing", status: "pending" }], [step("Add the cache")], 2, verification);
		expect(merged.todos.map((todo) => todo.content)).toEqual(["existing", "Add the cache"]);
		expect(merged.trailing).toBe("deferred");
		expect(merged.deferred).toBe(0);
		expect(mergeTodos([], [step("Add the cache")], 50).trailing).toBeUndefined();
	});

	const list: ExistingTodo[] = [
		{ content: "One", status: "pending" },
		{ content: "Two", status: "in_progress", activeForm: "Doing two" },
	];

	test("mirror ticks the matching item and leaves the rest untouched", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 1, status: "completed", expected: "One" }]);

		expect(mirror.todos).toEqual([
			{ content: "One", status: "completed" },
			{ content: "Two", status: "in_progress", activeForm: "Doing two" },
		]);
		expect(mirror).toMatchObject({ updated: 1, unmatched: 0 });
	});

	test("mirror reopens a completed item, matching regardless of case and spacing", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "pending", expected: "  one " }],
		);

		expect(mirror.todos).toEqual([{ content: "One", status: "pending" }]);
		expect(mirror.updated).toBe(1);
	});

	test("mirror counts an unmatched step instead of inventing an item", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 2, status: "completed", expected: "Renamed" }]);

		expect(mirror.todos).toEqual(list);
		expect(mirror).toMatchObject({ updated: 0, unmatched: 1 });
	});

	test("mirror does not count an item already in the requested state", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "completed", expected: "One" }],
		);

		expect(mirror).toMatchObject({ updated: 0, unmatched: 0 });
	});

	test("mirror lets the last update for a step number win", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "pending" }],
			[
				{ step: 1, status: "completed", expected: "One" },
				{ step: 1, status: "pending", expected: "One" },
			],
		);

		expect(mirror.updated).toBe(0);
		expect(mirror.todos[0]?.status).toBe("pending");
	});

	test("mirror matches an elided step to the elided text approval seeded", () => {
		const elided = `${"x".repeat(MAX_STEP_LENGTH - 1)}…`;
		const mirror = mirrorStepStatuses(
			[{ content: elided, status: "pending" }],
			[{ step: 1, status: "completed", expected: elided }],
		);

		expect(mirror.todos).toEqual([{ content: elided, status: "completed" }]);
		expect(mirror.updated).toBe(1);
	});

	test("mirror does not alias the list it was given", () => {
		const input: ExistingTodo[] = [{ content: "One", status: "pending" }];
		const mirror = mirrorStepStatuses(input, [{ step: 1, status: "completed", expected: "One" }]);

		expect(input[0]?.status).toBe("pending");
		expect(mirror.todos[0]?.status).toBe("completed");
	});
});

describe("enter_plan_mode", () => {
	test("enables plan mode and activates both control tools when the user confirms", async () => {
		const { enter, runtime, activeTools, root } = setup();
		const { ctx } = fakeCtx({ confirm: true, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: true });
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain(EXIT_TOOL);
		expect(activeTools()).toContain(WRITE_PLAN_TOOL);
		expect(result.content[0].text).toContain("write_plan");
	});

	test("stays in normal mode when the user declines", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = fakeCtx({ confirm: false, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.details).toEqual({ entered: false });
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(false);
	});

	test("reports an already-enabled mode without claiming a change", async () => {
		const { enter, runtime, root } = setup();
		await enterPlan(enter, runtime, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(enter, {}, ctx);
		expect(result.details).toEqual({ entered: true, already: true });

		const text = enter.renderResult(result, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(text).toContain("Already in plan mode");
		expect(text).not.toContain("Plan mode enabled");
	});

	test("reports an error without a UI", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = fakeCtx({ hasUI: false, cwd: root });
		const result = await call(enter, {}, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});
});

describe("write_plan", () => {
	test("refuses outside plan mode", async () => {
		const { write, root } = setup();
		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(write, { title: "x", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("says the outline is a guide and how steps are counted", () => {
		const { write } = setup();
		expect(write.description).toContain("a guide, not a form");
		expect(write.description).toContain("only the shallowest list is tracked");
	});

	test("writes the plan file, remembers it, and repaints the footer", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx, statusCalls } = fakeCtx({ cwd: root });

		const result = await call(write, { title: "Add rate limiting", content: "# Plan\n1. Do it" }, ctx);
		const details = result.details as { path: string; relativePath: string; bytes: number };

		expect(existsSync(details.path)).toBe(true);
		expect(readFileSync(details.path, "utf-8")).toBe("# Plan\n1. Do it");
		expect(details.path).toContain(join(".pi", "plans"));
		expect(details.bytes).toBeGreaterThan(0);
		expect(result.content[0].text).toContain(details.path);
		expect(runtime.lastPlanPath()).toBe(details.path);
		expect(String(statusCalls.at(-1)?.text)).toContain(`${GLYPHS.plan} plan`);
	});

	test("refuses a plan with more steps than approval can track", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });

		const result = await call(write, { title: "Big", content: planWithSteps(MAX_STEPS + 1) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(`${MAX_STEPS + 1} top-level steps`);
		expect(result.content[0].text).toContain(`at most ${MAX_STEPS}`);
		expect(result.content[0].text).toContain("Nothing was written");
		expect(result.details).toBeUndefined();
		expect(runtime.lastPlanPath()).toBeUndefined();
	});

	test("writes an exactly-full plan, which still approves", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const full = planWithSteps(MAX_STEPS);

		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, full);
		expect(readFileSync(planPath, "utf-8")).toBe(full);

		await approvePlan(exit, planPath, root);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("a refinement over the cap leaves the plan file unchanged", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const original = planWithSteps(2);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, original);
		const { ctx } = fakeCtx({ cwd: root });

		const result = await call(
			write,
			{ title: "Test plan", content: planWithSteps(MAX_STEPS + 1), plan_path: planPath },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(`at most ${MAX_STEPS}`);
		expect(readFileSync(planPath, "utf-8")).toBe(original);
	});

	test("notes a step that will be shortened in the todo list, and stays quiet otherwise", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });

		const long = await call(
			write,
			{ title: "Long", content: `## Steps\n- [ ] ${"x".repeat(MAX_STEP_LENGTH + 1)}` },
			ctx,
		);
		expect(long.content[0].text).toContain("longer than 200 characters");
		expect(long.content[0].text).toContain("shortened in the todo list");

		const short = await call(write, { title: "Fine", content: "## Steps\n- [ ] One" }, ctx);
		expect(short.content[0].text).not.toContain("Note:");
	});

	test("reports a write failure as an error result", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(write, { title: "   ", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Could not write the plan");
	});

	test("reports an oversized plan from the store", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(write, { title: "Huge", content: "x".repeat(256 * 1024 + 1) }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("too large");
	});

	test("renders the saved relative path", () => {
		const { write } = setup();
		const component = write.renderResult(
			{ details: { path: "/x/.pi/plans/p.md", relativePath: ".pi/plans/p.md", bytes: 1 } },
			{ expanded: false },
			fakeTheme,
		);
		expect(component.render(80).join("\n")).toContain(".pi/plans/p.md");
	});
});

describe("exit_plan_mode", () => {
	test("rejects when not in plan mode", async () => {
		const { exit, root } = setup();
		const { ctx } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: join(root, ".pi", "plans", "x.md") }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("rejects a missing plan file and a path outside the plans directory", async () => {
		const { enter, exit, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = fakeCtx({ cwd: root });

		const missing = await call(exit, { plan_path: join(root, ".pi", "plans", "nope.md") }, ctx);
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain("No plan file");

		writeFileSync(join(root, "secret.md"), "s");
		const outside = await call(exit, { plan_path: join(root, "secret.md") }, ctx);
		expect(outside.isError).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("reports an error without a UI", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ hasUI: false, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("refuses to present a plan file over the step cap", async () => {
		const { enter, exit, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		// A hand-edited (or older-session) file can exceed the cap without write_plan.
		const plansDir = join(root, ".pi", "plans");
		mkdirSync(plansDir, { recursive: true });
		const planPath = join(plansDir, "big.md");
		writeFileSync(planPath, planWithSteps(MAX_STEPS + 1));

		const { ctx } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.approved).toBe(false);
		expect(result.content[0].text).toContain(`${MAX_STEPS + 1} top-level steps`);
		expect(result.content[0].text).toContain("write_plan");
		// Nothing was approved: the session is still planning.
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning only when the user chooses that explicit option", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ select: "Keep planning (stay in plan mode)", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(false);
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(true);
	});

	test("leaves plan mode when the plan review is dismissed", async () => {
		const { enter, exit, write, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx, toolCalls } = fakeCtx({ select: undefined, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details).toMatchObject({ approved: false, cancelled: true });
		expect(result.content[0].text).toContain("Plan mode is off");
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(toolCalls).toEqual([]);
	});

	test("leaves plan mode through the Exit review option", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ select: "Exit plan mode (discard)", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.cancelled).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
		expect(existsSync(planPath)).toBe(true);
	});

	test("cancel_plan_mode restores write access without touching todos or goals", async () => {
		const { enter, cancel, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);

		const { ctx, notices, toolCalls } = fakeCtx({ cwd: root });
		const result = await call(cancel, {}, ctx);
		expect(result.details.cancelled).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(toolCalls).toEqual([]);
		expect(notices.at(-1)?.message).toContain("full access restored");
	});

	test("remote entry names the mode and its exit", async () => {
		const { enter, runtime, root } = setup();
		const { ctx, notices } = remoteCtx({ cwd: root, confirm: true });
		await call(enter, {}, ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(notices.some((notice) => notice.message.includes("write access is off"))).toBe(true);
	});

	test("cancel_plan_mode refuses outside plan mode", async () => {
		const { cancel } = setup();
		const { ctx } = fakeCtx();
		const result = await call(cancel, {}, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.cancelled).toBe(false);
		expect(result.content[0].text).toContain("nothing to cancel");
	});

	test("approves, restores write access, and seeds the todo list from the file", async () => {
		const { enter, exit, write, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(result.details.approved).toBe(true);
		expect(result.details.planPath).toBe(planPath);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(activeTools()).not.toContain(EXIT_TOOL);
		expect(activeTools()).not.toContain(WRITE_PLAN_TOOL);

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("todo");
		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Read the parser", status: "pending" },
				{ content: "Add a tokenizer", status: "pending" },
				{ content: "Update tests", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("test-plan.md");
		expect(result.content[0].text).toContain("source of truth");
		expect(result.content[0].text).toContain("1. [ ] Read the parser");
		expect(result.content[0].text).toContain(SET_PLAN_STEPS_TOOL);
	});

	test("carries the Verification section as the last todo item", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = [
			"# Plan",
			"## Steps",
			"- [ ] Add the cache",
			"- [ ] Wire it",
			"## Verification",
			"- `bun run check` passes",
			"- approve and merge",
		].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0]?.args).toEqual({
			todos: [
				{ content: "Add the cache", status: "pending" },
				{ content: "Wire it", status: "pending" },
				{ content: "Verify: bun run check passes; approve and merge", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("The plan's verification section is the last todo item");
		// The verification item is not a plan step, so step numbers still line up.
		expect(result.content[0].text).toContain("Merged 2 of 2 plan steps");
	});

	test("adds no verification item to a plan with no Steps heading", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		// Without a `Steps` heading the shallowest list is the plan (the older rule),
		// so the verification bullets are already steps and a summary would duplicate
		// them.
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "# Plan\n\n## Verification\n- run the suite");

		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute", cwd: root });
		await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0]?.args).toEqual({ todos: [{ content: "run the suite", status: "pending" }] });
	});

	test("names a verification item the full list could not take", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["# Plan", "## Steps", "- [ ] Add the cache", "## Verification", "- run the suite"].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);
		// A branch whose todo list is already at its cap keeps the verification out.
		const full = Array.from({ length: 50 }, (_, index) => ({ content: `existing ${index}`, status: "pending" }));
		const { ctx } = fakeCtx({ select: "Approve and execute", branch: todoBranch(full), cwd: root });

		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(result.content[0].text).toContain("did not fit in the full todo list");
	});

	test("seeds only the Steps section, not prose bullets", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = [
			"# Plan",
			"## Context",
			"- the repo is large",
			"## Approach",
			"- use a cache",
			"## Steps",
			"- [ ] Add the cache",
			"- [ ] Wire it",
			"## Risks",
			"- stale reads",
		].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Add the cache", status: "pending" },
				{ content: "Wire it", status: "pending" },
			],
		});
		expect(result.content[0].text).not.toContain("the repo is large");
		expect(result.content[0].text).not.toContain("use a cache");
	});

	test("merges the plan's steps into the existing todo list", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["## Steps", "- [ ] Read the parser", "- [ ] Add a tokenizer"].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({
			select: "Approve and execute",
			cwd: root,
			branch: todoBranch([{ content: "Fix the flaky test", status: "pending" }]),
		});
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Fix the flaky test", status: "pending" },
				{ content: "Read the parser", status: "pending" },
				{ content: "Add a tokenizer", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("Merged 2 of 2 plan steps into the todo list (1 existing kept)");
	});

	test("skips a step the list already has", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["## Steps", "- [ ] Fix the flaky test", "- [ ] Add a token bucket"].join("\n");
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = fakeCtx({
			select: "Approve and execute",
			cwd: root,
			branch: todoBranch([{ content: "  fix   the FLAKY test ", status: "completed" }]),
		});
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "fix the FLAKY test", status: "completed" },
				{ content: "Add a token bucket", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("1 already present");
	});

	test("does not rewrite a todo list that already holds every step", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "## Steps\n- [ ] Only step");

		const { ctx, toolCalls } = fakeCtx({
			select: "Approve and execute",
			cwd: root,
			branch: todoBranch([{ content: "Only step", status: "completed" }]),
		});
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls).toHaveLength(0);
		expect(result.content[0].text).toContain("already in the todo list");
	});

	test("stops at the todo tool's advertised cap and defers the rest", async () => {
		const { enter, exit, write, runtime, root } = setup(undefined, {
			allTools: [{ name: TODO_TOOL, parameters: { properties: { todos: { maxItems: 2 } } } }],
		});
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, planWithSteps(3));

		const { ctx, toolCalls } = fakeCtx({
			select: "Approve and execute",
			cwd: root,
			branch: todoBranch([{ content: "Existing", status: "pending" }]),
		});
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Existing", status: "pending" },
				{ content: "step 0", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("2 deferred, list full");
	});

	test("accepts a plan_path relative to the working directory", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");
		const relative = planPath.slice(root.length + 1);

		const { ctx } = fakeCtx({ select: "Approve and execute", cwd: root });
		const result = await call(exit, { plan_path: relative }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("approves even when the todo tool is unavailable", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Only step");

		const { ctx, setExecuteError } = fakeCtx({ select: "Approve and execute", cwd: root });
		setExecuteError(true);
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("reports why the todo seed failed instead of calling the tool unavailable", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Only step");

		const { ctx } = fakeCtx({
			select: "Approve and execute",
			cwd: root,
			extra: {
				executeTool: async () => ({
					isError: true,
					toolCall: { name: "todo", arguments: {} },
					result: { content: [{ type: "text", text: 'Validation failed for tool "todo"\n  - todos: too many' }] },
				}),
			},
		});
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(result.content[0].text).toContain('Validation failed for tool "todo"');
		expect(result.content[0].text).not.toContain("unavailable");
	});

	test("returns the user's refinement and stays in plan mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = fakeCtx({ select: "Refine the plan", editor: "  Use a hand-written lexer instead.  ", cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("Use a hand-written lexer instead.");
		expect(result.content[0].text).toContain("Use a hand-written lexer instead.");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("an empty refinement returns to the review", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = fakeCtx({
			select: ["Refine the plan", "Keep planning (stay in plan mode)"],
			editor: ["   "],
			cwd: root,
		});
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBeUndefined();
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("uses the review screen in TUI mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ mode: "tui", custom: { action: "approve" }, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("carries an inline TUI refinement through", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = fakeCtx({
			mode: "tui",
			custom: { action: "refine", refinement: "use a hand-written lexer" },
			cwd: root,
		});
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("use a hand-written lexer");
		expect(result.content[0].text).toContain("use a hand-written lexer");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("a browser save returns the comments as a refinement", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "make it concrete" }];
		const { enter, exit, write, runtime, root } = setup(webThatSaves(annotations));
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- one");

		const { ctx, notifications } = fakeCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toContain("make it concrete");
		expect(result.content[0].text).toContain("browser");
		expect(runtime.isEnabled()).toBe(true);
		expect(notifications.some((message) => message.includes("Plan review:"))).toBe(true);
	});

	test("a second review compares against what the first one showed", async () => {
		const { web, starts } = webThatApproves([]);
		const { enter, exit, write, runtime, root } = setup(web);
		await enterPlan(enter, runtime, root);
		const ctx = fakeCtx({ cwd: root }).ctx;
		const planPath = await savePlan(write, ctx, "## Goal\nOld body\n## Steps\n- [ ] One");

		const first = fakeCtx({ mode: "tui", cwd: root }).ctx;
		first.ui.custom = async () => ({ action: "refine", refinement: "tighten the goal" });
		await call(exit, { plan_path: planPath }, first);

		await call(
			write,
			{ title: "Test plan", content: "## Goal\nNew body\n## Steps\n- [ ] One", plan_path: planPath },
			ctx,
		);

		const second = fakeCtx({ mode: "tui", custom: { action: "browser" }, cwd: root }).ctx;
		const result = await call(exit, { plan_path: planPath }, second);

		expect(result.details.approved).toBe(true);
		expect(starts[0].baseline).toEqual(sectionDigests("## Goal\nOld body\n## Steps\n- [ ] One"));
		expect(starts[0].baseline).not.toEqual(sectionDigests("## Goal\nNew body\n## Steps\n- [ ] One"));
	});

	test("a browser approve leaves plan mode and seeds the todo list", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "ship it" }];
		const { web, starts } = webThatApproves(annotations);
		const { enter, exit, write, runtime, root, activeTools } = setup(web);
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Read the parser\n2. Update tests");

		const { ctx, toolCalls } = fakeCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await call(exit, { plan_path: planPath }, ctx);

		expect(starts[0]).toMatchObject({ canApprove: true });
		expect(result.details.approved).toBe(true);
		// The comments the approval was conditioned on travel with the result.
		expect(result.details.annotations).toEqual(annotations);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(toolCalls[0]?.name).toBe("todo");
		expect(result.content[0].text).toContain("Plan approved");
		expect(result.content[0].text).toContain("ship it");
	});

	test("an aborted call never opens the browser review", async () => {
		const { web, starts } = webThatApproves([]);
		const { enter, exit, write, runtime, root } = setup(web);
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- one");

		const controller = new AbortController();
		controller.abort();
		const { ctx } = fakeCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await exit.execute("call-1", { plan_path: planPath }, controller.signal, undefined, ctx);

		expect(starts).toEqual([]);
		expect(result.details.approved).toBe(false);
		expect(result.content[0].text).toContain("Plan not approved");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("a cancelled browser review returns to the review screen", async () => {
		const { enter, exit, write, runtime, root } = setup(webThatCancels());
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- one");

		const { ctx } = fakeCtx({ mode: "tui", cwd: root });
		let calls = 0;
		ctx.ui.custom = async () => (calls++ === 0 ? { action: "browser" } : { action: "keep" });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(calls).toBe(2);
		expect(result.details.approved).toBe(false);
		expect(result.details.refined).toBeUndefined();
		expect(runtime.isEnabled()).toBe(true);
	});

	test("uses dialogs on a remote turn instead of the review screen", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx, customCalls, files, posted } = remoteCtx({ cwd: root, select: "Approve and execute" });
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(customCalls).toEqual([]);
		// The plan file is sent before the choices.
		expect(files).toEqual([{ path: planPath, name: basename(planPath) }]);
		// A digest follows, so the choice is answerable if the file is never opened.
		const digest = posted.at(-1) ?? "";
		expect(digest).toContain("Plan (1 step)");
		expect(digest).toContain("Plan mode is on");
		expect(digest).toContain("1. Do it");
	});

	test("falls back to the plan text when the file cannot be sent", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx, posted, setFileResult } = remoteCtx({ cwd: root, select: "Keep planning (stay in plan mode)" });
		setFileResult(false);
		await call(exit, { plan_path: planPath }, ctx);
		expect(posted[0]).toContain("Do it");
		// The digest still follows the fallback text.
		expect(posted.at(-1)).toContain("Plan (1 step)");
	});

	test("the digest names the plan title when the file has one", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "# Test plan\n\n1. Do it");

		const { ctx, posted } = remoteCtx({ cwd: root, select: "Keep planning (stay in plan mode)" });
		await call(exit, { plan_path: planPath }, ctx);
		expect(posted.at(-1)).toContain("Plan: Test plan (1 step)");
	});

	test("sends the full plan on request, then asks again", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "# Test plan\n\n1. Do it");

		const { ctx, selects, posted, files } = remoteCtx({
			cwd: root,
			select: ["Send the full plan", "Approve and execute"],
		});
		const result = await call(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		// The file went out on the first pass; the second pass posts the text instead.
		expect(files).toHaveLength(1);
		expect(selects[0]).toContain("Send the full plan");
		expect(selects).toHaveLength(2);
		expect(posted.some((text) => text.includes("# Test plan") && text.includes("1. Do it"))).toBe(true);
	});

	// The review sizes itself to the whole terminal, so it must be an overlay.
	// Mounted in the editor slot of Pi's dock it would share the terminal with the
	// transcript, status line, widgets, and footer, and the layout would clip the
	// bottom of the screen — its own footer hints.
	test("mounts the review screen as a full-screen overlay", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = fakeCtx({ mode: "tui", cwd: root });
		const seen: unknown[] = [];
		ctx.ui.custom = async (_factory: unknown, options: unknown) => {
			seen.push(options);
			return "approve";
		};
		await call(exit, { plan_path: planPath }, ctx);

		expect(seen).toEqual([
			{
				overlay: true,
				overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
			},
		]);
	});

	describe("the session-goal offer", () => {
		/** Approve `content` through the dialog path with the given fake ctx options. */
		async function approve(
			content: string,
			options: { confirm?: boolean; branch?: unknown[]; executeError?: string } = {},
		) {
			const { enter, exit, write, runtime, root } = setup();
			await enterPlan(enter, runtime, root);
			const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, content);
			const fake = fakeCtx({
				select: "Approve and execute",
				confirm: options.confirm ?? true,
				branch: options.branch,
				executeError: options.executeError,
				cwd: root,
			});
			const result = await call(exit, { plan_path: planPath }, fake.ctx);
			return { ...fake, result };
		}

		test("offers the plan's title and records it as the goal when accepted", async () => {
			const { confirms, toolCalls, result } = await approve("# Add rate limiting\n\n## Steps\n- [ ] One");

			expect(confirms.map((entry) => entry.message)).toEqual(["Add rate limiting"]);
			expect(
				toolCalls.some(
					(entry) => entry.name === "goal" && (entry.args as { objective: string }).objective === "Add rate limiting",
				),
			).toBe(true);
			expect(result.content[0].text).toContain("Recorded the session goal: Add rate limiting.");
		});

		test("records nothing when the offer is declined", async () => {
			const { toolCalls, result } = await approve("# Add rate limiting\n\n## Steps\n- [ ] One", { confirm: false });

			expect(toolCalls.some((entry) => entry.name === "goal")).toBe(false);
			expect(result.content[0].text).not.toContain("Recorded the session goal");
		});

		test("leaves an existing goal alone without asking", async () => {
			const { confirms, toolCalls, result } = await approve("# Add rate limiting\n\n## Steps\n- [ ] One", {
				branch: [resultEntry({ objective: "the user's own goal", status: "active" })],
			});

			expect(confirms).toEqual([]);
			expect(toolCalls.some((entry) => entry.name === "goal")).toBe(false);
			expect(result.content[0].text).not.toContain("session goal");
		});

		test("promotes a planning goal to the plan's own Goal, without asking", async () => {
			const content = "# Add rate limiting\n\n## Goal\nProtect the public API\n\n## Steps\n- [ ] One";
			const { confirms, toolCalls, result } = await approve(content, {
				branch: [resultEntry({ objective: "protect the API", status: "planning" })],
			});

			expect(confirms).toEqual([]);
			expect(
				toolCalls.some(
					(entry) =>
						entry.name === "goal" &&
						(entry.args as { objective: string; status?: string }).objective === "Protect the public API" &&
						(entry.args as { status?: string }).status === "active",
				),
			).toBe(true);
			expect(result.content[0].text).toContain("Set the session goal from the plan: Protect the public API.");
		});

		test("reports a goal the goal tool refused", async () => {
			const { result } = await approve("# Add rate limiting\n\n## Steps\n- [ ] One", {
				executeError: "objective is longer than 2000 characters.",
			});

			expect(result.content[0].text).toContain(
				"Could not record the session goal: objective is longer than 2000 characters.",
			);
		});
	});
});

describe("set_plan_steps", () => {
	test("ticks steps off in an approved plan and reports progress", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One\n2. Two\n3. Three");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{
				plan_path: planPath,
				updates: [
					{ step: 1, status: "completed", expected: "One" },
					{ step: 3, status: "completed", expected: "Three" },
				],
			},
			ctx,
		);
		const details = result.details as { done: number; total: number };

		expect(result.isError).toBeUndefined();
		expect(details.done).toBe(2);
		expect(details.total).toBe(3);
		expect(result.content[0].text).toContain("Steps 1, 3 completed (2/3 done)");
		expect(readFileSync(planPath, "utf-8")).toBe("1. [x] One\n2. Two\n3. [x] Three");
	});

	test("reopens a step and drops its DONE marker", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- First [DONE:1]\n- Second");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "pending", expected: "First" }] },
			ctx,
		);
		const details = result.details as { done: number };

		expect(result.isError).toBeUndefined();
		expect(details.done).toBe(0);
		expect(readFileSync(planPath, "utf-8")).toBe("- [ ] First\n- Second");
	});

	test("refuses a stale expected text and leaves the file unchanged", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 2, status: "completed", expected: "Wire it" }] },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Step 2 is no longer "Wire it"; the file now has "Two"');
		expect(readFileSync(planPath, "utf-8")).toBe("1. One\n2. Two");
	});

	test("accepts an expected text that matches after normalization", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "  ONE " }] },
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(readFileSync(planPath, "utf-8")).toBe("1. [x] One\n2. Two");
	});

	test("ticks the todo item approval seeded from the same step", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = fakeCtx({
			cwd: root,
			branch: todoBranch([
				{ content: "One", status: "pending" },
				{ content: "Two", status: "pending" },
			]),
		});
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0]?.name).toBe(TODO_TOOL);
		expect(toolCalls[0]?.args).toEqual({
			todos: [
				{ content: "One", status: "completed" },
				{ content: "Two", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("; 1 todo item updated");
		expect(readFileSync(planPath, "utf-8")).toBe("1. [x] One\n2. Two");
	});

	test("writes nothing when the matching item is already in that state", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = fakeCtx({ cwd: root, branch: todoBranch([{ content: "One", status: "completed" }]) });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(toolCalls).toHaveLength(0);
		expect(result.content[0].text).toContain(`(1/1 done) in ${join(".pi", "plans")}`);
		expect(result.content[0].text).not.toContain("todo item");
	});

	test("reports a step with no matching todo item instead of inventing one", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = fakeCtx({ cwd: root, branch: todoBranch([{ content: "Renamed", status: "pending" }]) });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(toolCalls).toHaveLength(0);
		expect(result.content[0].text).toContain("; 1 step has no matching todo item");
		expect(readFileSync(planPath, "utf-8")).toBe("1. [x] One");
	});

	test("reports a failed todo write without turning the written plan into an error", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({
			cwd: root,
			branch: todoBranch([{ content: "One", status: "pending" }]),
			executeError: "at most 50 todos are allowed",
		});
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("could not update 1 todo item in the todo list");
		expect(result.content[0].text).toContain("at most 50 todos are allowed");
		expect(readFileSync(planPath, "utf-8")).toBe("1. [x] One");
	});

	test("refuses when any step is out of range and leaves the file unchanged", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- One");
		await approvePlan(exit, planPath, root);

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{
				plan_path: planPath,
				updates: [
					{ step: 1, status: "completed", expected: "One" },
					{ step: 5, status: "completed", expected: "Five" },
				],
			},
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("out of range");
		expect(readFileSync(planPath, "utf-8")).toBe("- One");
	});

	test("refuses a plan outside the plans directory", async () => {
		const { enter, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		runtime.disable(fakeCtx({ cwd: root }).ctx);
		writeFileSync(join(root, "secret.md"), "- One");

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{ plan_path: join(root, "secret.md"), updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(readFileSync(join(root, "secret.md"), "utf-8")).toBe("- One");
	});

	test("refuses while still in plan mode", async () => {
		const { enter, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, fakeCtx({ cwd: root }).ctx, "- One");

		const { ctx } = fakeCtx({ cwd: root });
		const result = await call(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
		expect(readFileSync(planPath, "utf-8")).toBe("- One");
	});

	test("renders the completion state", () => {
		const { setSteps } = setup();
		const component = setSteps.renderResult(
			{
				details: {
					path: "/x/.pi/plans/p.md",
					relativePath: ".pi/plans/p.md",
					updates: [{ step: 2, status: "completed" }],
					done: 2,
					total: 5,
				},
			},
			{ expanded: false },
			fakeTheme,
		);
		const text = component.render(80).join("\n");
		expect(text).toContain("Step 2 done");
		expect(text).toContain("2/5");
	});
});

describe("plan tool rendering", () => {
	test("exit_plan_mode previews the plan and shows it in full when expanded", async () => {
		const { exit } = setup();
		const plan = ["# Plan", ...Array.from({ length: 20 }, (_, index) => `${index + 1}. step`)].join("\n");
		const details = { approved: true, plan, planPath: "/x/.pi/plans/p.md", relativePath: ".pi/plans/p.md" };

		const collapsed = exit.renderResult({ details }, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(collapsed).toContain("Plan approved");
		expect(collapsed).toContain("# Plan");
		expect(collapsed).toContain("more lines");
		expect(collapsed).not.toContain("20. step");

		const expanded = exit.renderResult({ details }, { expanded: true }, fakeTheme).render(80).join("\n");
		expect(expanded).toContain("20. step");
		expect(expanded).not.toContain("more lines");
	});

	test("renders the relative plan path, not the absolute one", async () => {
		const { exit } = setup();
		const component = exit.renderResult(
			{ details: { approved: true, plan: "# P", planPath: "/x/.pi/plans/p.md", relativePath: ".pi/plans/p.md" } },
			{ expanded: false },
			fakeTheme,
		);
		const text = component.render(80).join("\n");
		expect(text).toContain(".pi/plans/p.md");
		expect(text).not.toContain("/x/.pi/plans/p.md");
	});

	test("strips control characters from the rendered plan and refinement", () => {
		const { exit } = setup();
		for (const expanded of [false, true]) {
			const component = exit.renderResult(
				{
					details: {
						approved: false,
						plan: "hello\u001b[31mred\u001b[0m\u0007 world",
						planPath: "/x/.pi/plans/p.md",
						relativePath: ".pi/plans/p.md",
						refined: true,
						refinement: "use\u001b[2J x",
					},
				},
				{ expanded },
				fakeTheme,
			);
			const text = component.render(80).join("\n");
			expect(text).not.toContain("\u001b");
			expect(text).not.toContain("\u0007");
		}
	});
});
