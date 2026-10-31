import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GOAL_TOOL, TODO_TOOL } from "../../lib/tool-names.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme, toolRenderContext } from "../../test/helpers/fakes.ts";
import { callTool } from "../../test/helpers/tools.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";
import type { ExecResult } from "../../test/helpers/git.ts";
import { planCtx, makePlanPi } from "../../test/helpers/fixtures/plan.ts";
import { useEnv } from "../../test/helpers/env.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { shortenPath } from "../../lib/format.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";
import type { PlanAnnotation } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
import { createPlanPolicy } from "./policy.ts";
import { PLAN_REVIEW_TIMEOUT_MS } from "./review.ts";
import { createPlanRuntime, PLAN_TOOL } from "./runtime.ts";
import { MAX_STEP_LENGTH, MAX_STEPS } from "./steps.ts";
import { registerTools } from "./tools.ts";
import type { PlanAction } from "./types.ts";
import type { PlanReviewOptions, PlanWebReview } from "./web.ts";

/** One agent directory for this file: plans land outside the project now. */
const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-tools-agent-"));
let scoped: { restore: () => void } | undefined;
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

/** The store one repository's plans land in, keyed by its common git dir. */
function planDir(root: string): string {
	return join(AGENT, "plans", repoKeyOf(root));
}

function repoExec(root: string) {
	return async (command: string, args: string[]) =>
		command === "git" && args[0] === "rev-parse"
			? { stdout: `${root}\n`, stderr: "", code: 0 }
			: { stdout: "", stderr: "", code: 1 };
}

/** The exec seam the fake `pi` calls; `killed` is optional there, so it is left out. */
type FakeExec = (command: string, args: string[]) => Promise<Omit<ExecResult, "killed">>;

/**
 * One action of the folded `plan` tool, bound the way a test wants to call it.
 *
 * The tool is one registration with an `action` discriminant, so a case that
 * exercises `write` passes `write`'s fields and this adds the verb; the seam is
 * the tool's real `execute` and `renderResult`, not a stand-in for them.
 */
function bound(plan: any, action: PlanAction): any {
	return {
		execute: (toolCallId: string, params: Record<string, unknown> = {}, ...rest: unknown[]) =>
			plan.execute(toolCallId, { ...params, action }, ...rest),
		renderResult: (result: unknown, options: { expanded: boolean }, theme: unknown) =>
			plan.renderResult(result, options, theme, toolRenderContext(options)),
	};
}

function setup(web?: PlanWebReview, options: { allTools?: unknown[]; exec?: FakeExec } = {}) {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-tools-")));
	const fake = makePlanPi({
		active: ["read", "bash", "write", "edit", PLAN_TOOL, "todo"],
		exec: options.exec ?? repoExec(root),
		// A normal install has `goal` registered by its sibling extension; the
		// approval probes for it before recording the session goal.
		allTools: options.allTools ?? [{ name: GOAL_TOOL }],
	});
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime, web);
	const plan = fake.tools.get(PLAN_TOOL);
	return {
		...fake,
		runtime,
		root,
		plan,
		enter: bound(plan, "enter"),
		exit: bound(plan, "exit"),
		cancel: bound(plan, "cancel"),
		write: bound(plan, "write"),
		setSteps: bound(plan, "steps"),
	};
}

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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
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
		current: () => undefined,
		share: async () => undefined,
		stopSharing: async () => undefined,
		shareState: () => undefined,
		closeAll: async () => {},
	};
	return { web, starts };
}

/** Enter plan mode through the real tool, in a repository rooted at `cwd`. */
async function enterPlan(enter: any, runtime: any, cwd: string) {
	const { ctx } = planCtx({ confirm: true, cwd });
	await callTool(enter, {}, ctx);
	expect(runtime.isEnabled()).toBe(true);
}

/** Save a plan file through the real tool and return its path. */
async function savePlan(write: any, ctx: any, content: string): Promise<string> {
	const result = await callTool(write, { title: "Test plan", content }, ctx);
	expect(result.isError).toBeUndefined();
	return (result.details as { path: string }).path;
}

/** Approve a saved plan through the real tool, leaving plan mode. */
async function approvePlan(exit: any, planPath: string, cwd: string) {
	await callTool(exit, { plan_path: planPath }, planCtx({ editor: "1", cwd }).ctx);
}

/** A plan whose `Steps` section holds `count` top-level steps. */
function planWithSteps(count: number): string {
	const steps = Array.from({ length: count }, (_, index) => `- [ ] step ${index}`).join("\n");
	return `## Steps\n${steps}`;
}

describe("plan enter", () => {
	test("enables plan mode, keeps the plan tool, and names the folded calls", async () => {
		const { enter, plan, runtime, activeTools, root } = setup();
		const { ctx } = planCtx({ confirm: true, cwd: root });
		const result = await callTool(enter, {}, ctx);

		expect(result.details).toEqual({ action: "enter", entered: true });
		expect(runtime.isEnabled()).toBe(true);
		expect(activeTools()).not.toContain("write");
		expect(activeTools()).toContain(plan.name);
		expect(result.content[0].text).toContain("`plan` action `write`");
	});

	test("stays in normal mode when the user declines", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = planCtx({ confirm: false, cwd: root });
		const result = await callTool(enter, {}, ctx);

		expect(result.details).toEqual({ action: "enter", entered: false });
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(false);
	});

	test("reports an already-enabled mode without claiming a change", async () => {
		const { enter, runtime, root } = setup();
		await enterPlan(enter, runtime, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(enter, {}, ctx);
		expect(result.details).toEqual({ action: "enter", entered: true, already: true });

		const text = enter.renderResult(result, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(text).toContain("Already in plan mode");
		expect(text).not.toContain("Plan mode enabled");
	});

	test("reports an error without a UI", async () => {
		const { enter, runtime, root } = setup();
		const { ctx } = planCtx({ hasUI: false, cwd: root });
		const result = await callTool(enter, {}, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});
});

describe("plan write", () => {
	test("refuses outside plan mode", async () => {
		const { write, root } = setup();
		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(write, { title: "x", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("names the droppable headings and how steps are counted", () => {
		const { plan } = setup();
		expect(plan.description).toContain("a guide, not a form");
		expect(plan.description).toContain("drop Context, Approach, Visual, or Risks");
		expect(plan.description).toContain("the shallowest list anywhere becomes the steps");
		expect(plan.description).toContain("before and after in one fence each");
	});

	test("asks a refinement to keep its section headings", () => {
		const { plan } = setup();
		expect(plan.promptGuidelines.join("\n")).toContain("keep every section heading");
	});

	test("writes the plan file, remembers it, and repaints the footer", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx, statusCalls } = planCtx({ cwd: root });

		const result = await callTool(write, { title: "Add rate limiting", content: "# Plan\n1. Do it" }, ctx);
		const details = result.details as { path: string; relativePath: string; bytes: number };

		expect(existsSync(details.path)).toBe(true);
		expect(readFileSync(details.path, "utf-8")).toBe("# Plan\n1. Do it");
		expect(details.path).toStartWith(planDir(root));
		expect(details.relativePath).toBe(shortenPath(details.path));
		expect(details.bytes).toBeGreaterThan(0);
		expect(result.content[0].text).toContain(details.path);
		expect(runtime.lastPlanPath()).toBe(details.path);
		expect(String(statusCalls.at(-1)?.text)).toContain(`${GLYPHS.plan} plan`);
	});

	test("refuses a plan with more steps than approval can track", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = planCtx({ cwd: root });

		const result = await callTool(write, { title: "Big", content: planWithSteps(MAX_STEPS + 1) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(`${MAX_STEPS + 1} top-level steps`);
		expect(result.content[0].text).toContain(`at most ${MAX_STEPS}`);
		expect(result.content[0].text).toContain("Nothing was written");
		expect(result.details.refused).toBe("write");
		expect(runtime.lastPlanPath()).toBeUndefined();
	});

	test("writes an exactly-full plan, which still approves", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const full = planWithSteps(MAX_STEPS);

		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, full);
		expect(readFileSync(planPath, "utf-8")).toBe(full);

		await approvePlan(exit, planPath, root);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("a refinement over the cap leaves the plan file unchanged", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const original = planWithSteps(2);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, original);
		const { ctx } = planCtx({ cwd: root });

		const result = await callTool(
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
		const { ctx } = planCtx({ cwd: root });

		const long = await callTool(
			write,
			{ title: "Long", content: `## Steps\n- [ ] ${"x".repeat(MAX_STEP_LENGTH + 1)}` },
			ctx,
		);
		expect(long.content[0].text).toContain("longer than 200 characters");
		expect(long.content[0].text).toContain("shortened in the todo list");

		const short = await callTool(write, { title: "Fine", content: "## Steps\n- [ ] One" }, ctx);
		expect(short.content[0].text).not.toContain("Note:");
	});

	test("refuses a write with no title instead of naming a file for it", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(write, { title: "   ", content: "y" }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("`write` needs a title");
		expect(runtime.lastPlanPath()).toBeUndefined();
	});

	test("reports an oversized plan from the store", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(write, { title: "Huge", content: "x".repeat(256 * 1024 + 1) }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("too large");
	});

	test("renders the saved relative path", () => {
		const { write } = setup();
		const component = write.renderResult(
			{ details: { action: "write", path: "/x/plans/p.md", relativePath: "/x/plans/p.md", bytes: 1 } },
			{ expanded: false },
			fakeTheme,
		);
		expect(component.render(80).join("\n")).toContain("/x/plans/p.md");
	});
});

describe("a plan approved twice", () => {
	test("replaces the items its first approval seeded, and says so", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(
			write,
			planCtx({ cwd: root }).ctx,
			"# Plan\n\n## Steps\n\n- [ ] Wire the limiter into the router",
		);
		// Approve it once, then read the list back as the branch would hold it. The seed
		// record is the entry the first approval appended, keyed by the resolved path.
		await callTool(exit, { plan_path: planPath }, planCtx({ editor: "1", cwd: root }).ctx);
		expect(runtime.seeded(planPath)).toEqual(["Wire the limiter into the router"]);

		// Approve a refined plan over a branch still holding the older step's item.
		await enterPlan(enter, runtime, root);
		const { ctx, toolCalls } = planCtx({
			editor: "1",
			branch: todoBranch([{ content: "Wire the limiter", status: "pending" }]),
			cwd: root,
		});
		runtime.markSeeded(planPath, ["Wire the limiter"]);
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		// The untouched leftover is replaced, not left beside the step that renamed it.
		expect(toolCalls[0]?.args).toEqual({ todos: [{ content: "Wire the limiter into the router", status: "pending" }] });
		expect(result.content[0].text).toContain("1 stale item from the earlier approval replaced");
	});

	test("warns that a refined plan's todo items are stale, at the write", async () => {
		const { enter, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const ctx = planCtx({ cwd: root }).ctx;
		const planPath = await savePlan(write, ctx, "# Plan\n\n## Steps\n\n- [ ] one");
		// Not seeded: refining a plan nobody approved says nothing about the todo list.
		const first = await callTool(
			write,
			{ title: "Again", content: "# Plan\n\n## Steps\n\n- [ ] two", plan_path: planPath },
			ctx,
		);
		expect(first.content[0].text).not.toContain("approved before");

		runtime.markSeeded(planPath, ["one"]);
		const second = await callTool(
			write,
			{ title: "Again", content: "# Plan\n\n## Steps\n\n- [ ] three", plan_path: planPath },
			ctx,
		);
		expect(second.content[0].text).toContain("This plan was approved before");
		expect(second.content[0].text).toContain("approving it again replaces the steps that changed");
	});
});

describe("plan exit with a browser review", () => {
	test("approves from the page and records the steps", async () => {
		const { web, starts } = webThatApproves([]);
		const { enter, exit, write, runtime, root } = setup(web);
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Plan\n\n## Steps\n\n- [ ] one");

		const { ctx } = planCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		expect(starts[0]?.canApprove).toBe(true);
		expect(result.details.approved).toBe(true);
	});
});

describe("plan exit", () => {
	test("rejects when not in plan mode", async () => {
		const { exit, root } = setup();
		const { ctx } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: join(planDir(root), "x.md") }, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Not in plan mode");
	});

	test("rejects a missing plan file and a path outside the plans directory", async () => {
		const { enter, exit, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const { ctx } = planCtx({ cwd: root });

		const missing = await callTool(exit, { plan_path: join(planDir(root), "nope.md") }, ctx);
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain("No plan file");

		writeFileSync(join(root, "secret.md"), "s");
		const outside = await callTool(exit, { plan_path: join(root, "secret.md") }, ctx);
		expect(outside.isError).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("reports an error without a UI", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ hasUI: false, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("refuses to present a plan file over the step cap", async () => {
		const { enter, exit, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		// A hand-edited (or older-session) file can exceed the cap without the write action.
		const plansDir = planDir(root);
		mkdirSync(plansDir, { recursive: true });
		const planPath = join(plansDir, "big.md");
		writeFileSync(planPath, planWithSteps(MAX_STEPS + 1));

		const { ctx } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.approved).toBe(false);
		expect(result.content[0].text).toContain(`${MAX_STEPS + 1} top-level steps`);
		expect(result.content[0].text).toContain("`plan` action `write`");
		// Nothing was approved: the session is still planning.
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning when the user chooses that option", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ editor: "2", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(false);
		expect(result.isError).toBeUndefined();
		expect(runtime.isEnabled()).toBe(true);
	});

	test("keeps planning when the plan review is dismissed", async () => {
		// Nothing is not a decision: leaving plan mode restores write access, so it takes an answer.
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ editor: undefined, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details).toMatchObject({ approved: false });
		expect(result.details.cancelled).toBeUndefined();
		expect(result.content[0].text).toContain("Stay in plan mode");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("leaves plan mode through the Exit review option", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ editor: "3", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.cancelled).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
		expect(existsSync(planPath)).toBe(true);
	});

	test("plan cancel restores write access without touching todos or goals", async () => {
		const { enter, cancel, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);

		const { ctx, notices, toolCalls } = planCtx({ cwd: root });
		const result = await callTool(cancel, {}, ctx);
		expect(result.details.cancelled).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");
		expect(toolCalls).toEqual([]);
		expect(notices.at(-1)?.message).toContain("full access restored");
	});

	test("remote entry names the mode and its exit", async () => {
		const { enter, runtime, root } = setup();
		const { ctx, notices } = remoteCtx({ cwd: root, confirm: true });
		await callTool(enter, {}, ctx);
		expect(runtime.isEnabled()).toBe(true);
		expect(notices.some((notice) => notice.message.includes("write access is off"))).toBe(true);
	});

	test("refuses outside plan mode", async () => {
		const { cancel } = setup();
		const { ctx } = planCtx();
		const result = await callTool(cancel, {}, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.refused).toBe("cancel");
		expect(result.content[0].text).toContain("nothing to cancel");
	});

	test("approves, restores write access, and seeds the todo list from the file", async () => {
		const { enter, exit, write, runtime, activeTools, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);

		// Accept the goal offer: the approval records the goal, which is what this
		// asserts.
		const { ctx, toolCalls } = planCtx({ editor: "1", confirm: true, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		expect(result.details.approved).toBe(true);
		expect(result.details.planPath).toBe(planPath);
		expect(runtime.isEnabled()).toBe(false);
		expect(activeTools()).toContain("write");

		// The approval seeds the steps and then records the goal, in that order.
		expect(toolCalls.map((entry) => entry.name)).toEqual([TODO_TOOL, GOAL_TOOL]);
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
		expect(result.content[0].text).toContain("`plan` action `steps`");
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Plan\n\n## Verification\n- run the suite");

		const { ctx, toolCalls } = planCtx({ editor: "1", cwd: root });
		await callTool(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0]?.args).toEqual({ todos: [{ content: "run the suite", status: "pending" }] });
	});

	test("names a verification item the full list could not take", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const plan = ["# Plan", "## Steps", "- [ ] Add the cache", "## Verification", "- run the suite"].join("\n");
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);
		// A branch whose todo list is already at its cap keeps the verification out.
		const full = Array.from({ length: 50 }, (_, index) => ({ content: `existing ${index}`, status: "pending" }));
		const { ctx } = planCtx({ editor: "1", branch: todoBranch(full), cwd: root });

		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = planCtx({
			editor: "1",
			cwd: root,
			branch: todoBranch([{ content: "Fix the flaky test", status: "pending" }]),
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, plan);

		const { ctx, toolCalls } = planCtx({
			editor: "1",
			cwd: root,
			branch: todoBranch([{ content: "  fix   the FLAKY test ", status: "completed" }]),
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "## Steps\n- [ ] Only step");

		const { ctx, toolCalls } = planCtx({
			editor: "1",
			cwd: root,
			branch: todoBranch([{ content: "Only step", status: "completed" }]),
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		// Nothing to seed, so the todo tool is not called at all; the goal is still
		// offered, which is a separate write.
		expect(toolCalls.filter((entry) => entry.name === TODO_TOOL)).toHaveLength(0);
		expect(result.content[0].text).toContain("already in the todo list");
	});

	test("stops at the todo tool's advertised cap and defers the rest", async () => {
		const { enter, exit, write, runtime, root } = setup(undefined, {
			allTools: [{ name: TODO_TOOL, parameters: { properties: { todos: { maxItems: 2 } } } }],
		});
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, planWithSteps(3));

		const { ctx, toolCalls } = planCtx({
			editor: "1",
			cwd: root,
			branch: todoBranch([{ content: "Existing", status: "pending" }]),
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);

		expect(toolCalls[0].args).toEqual({
			todos: [
				{ content: "Existing", status: "pending" },
				{ content: "step 0", status: "pending" },
			],
		});
		expect(result.content[0].text).toContain("2 deferred, list full");
	});

	test("accepts a plan_path named relative to the store", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: basename(planPath) }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("accepts a plan_path spelled the way the tool displays it", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ editor: "1", cwd: root });
		const result = await callTool(exit, { plan_path: shortenPath(planPath) }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("approves even when the todo tool is unavailable", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Only step");

		const { ctx, setExecuteError } = planCtx({ editor: "1", cwd: root });
		setExecuteError(true);
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
	});

	test("reports why the todo seed failed instead of calling the tool unavailable", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Only step");

		const { ctx } = planCtx({
			editor: "1",
			cwd: root,
			extra: {
				executeTool: async () => ({
					isError: true,
					toolCall: { name: "todo", arguments: {} },
					result: { content: [{ type: "text", text: 'Validation failed for tool "todo"\n  - todos: too many' }] },
				}),
			},
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(result.content[0].text).toContain('Validation failed for tool "todo"');
		expect(result.content[0].text).not.toContain("unavailable");
	});

	test("returns the user's refinement and stays in plan mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = planCtx({ editor: "Use a hand-written lexer instead.", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("Use a hand-written lexer instead.");
		expect(result.content[0].text).toContain("Use a hand-written lexer instead.");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("treats a numbered sentence as feedback, not an approval", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = planCtx({ editor: "1. make step 2 smaller", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("1. make step 2 smaller");
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("an empty review keeps planning without approving", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = planCtx({ editor: "   ", cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.cancelled).toBeUndefined();
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
	});

	test("uses the review screen in TUI mode", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ mode: "tui", custom: { action: "approve" }, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(runtime.isEnabled()).toBe(false);
	});

	test("carries an inline TUI refinement through", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Use a generator");

		const { ctx } = planCtx({
			mode: "tui",
			custom: { action: "refine", refinement: "use a hand-written lexer" },
			cwd: root,
		});
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.refined).toBe(true);
		expect(result.details.refinement).toBe("use a hand-written lexer");
		expect(result.content[0].text).toContain("use a hand-written lexer");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("a browser save returns the comments as a refinement", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "make it concrete" }];
		const { enter, exit, write, runtime, root } = setup(webThatSaves(annotations));
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- one");

		const { ctx, notifications } = planCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
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
		const ctx = planCtx({ cwd: root }).ctx;
		const planPath = await savePlan(write, ctx, "## Goal\nOld body\n## Steps\n- [ ] One");

		const first = planCtx({ mode: "tui", cwd: root }).ctx;
		first.ui.custom = async () => ({ action: "refine", refinement: "tighten the goal" });
		await callTool(exit, { plan_path: planPath }, first);

		await callTool(
			write,
			{ title: "Test plan", content: "## Goal\nNew body\n## Steps\n- [ ] One", plan_path: planPath },
			ctx,
		);

		const second = planCtx({ mode: "tui", custom: { action: "browser" }, cwd: root }).ctx;
		const result = await callTool(exit, { plan_path: planPath }, second);

		expect(result.details.approved).toBe(true);
		expect(starts[0].baseline).toEqual(sectionDigests("## Goal\nOld body\n## Steps\n- [ ] One"));
		expect(starts[0].baseline).not.toEqual(sectionDigests("## Goal\nNew body\n## Steps\n- [ ] One"));
	});

	test("a browser approve leaves plan mode and seeds the todo list", async () => {
		const annotations: PlanAnnotation[] = [{ anchor: 0, quote: "one", comment: "ship it" }];
		const { web, starts } = webThatApproves(annotations);
		const { enter, exit, write, runtime, root, activeTools } = setup(web);
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Read the parser\n2. Update tests");

		const { ctx, toolCalls } = planCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await callTool(exit, { plan_path: planPath }, ctx);

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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- one");

		const controller = new AbortController();
		controller.abort();
		const { ctx } = planCtx({ mode: "tui", custom: { action: "browser" }, cwd: root });
		const result = await exit.execute("call-1", { plan_path: planPath }, controller.signal, undefined, ctx);

		expect(starts).toEqual([]);
		expect(result.details.approved).toBe(false);
		expect(result.content[0].text).toContain("Plan not approved");
		expect(runtime.isEnabled()).toBe(true);
	});

	test("a cancelled browser review returns to the review screen", async () => {
		const { enter, exit, write, runtime, root } = setup(webThatCancels());
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- one");

		const { ctx } = planCtx({ mode: "tui", cwd: root });
		let calls = 0;
		ctx.ui.custom = async () => (calls++ === 0 ? { action: "browser" } : { action: "keep" });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(calls).toBe(2);
		expect(result.details.approved).toBe(false);
		expect(result.details.refined).toBeUndefined();
		expect(runtime.isEnabled()).toBe(true);
	});

	test("uses dialogs on a remote turn instead of the review screen", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx, customCalls, files, events, editorCalls, timeouts } = remoteCtx({ cwd: root, editor: "1" });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(true);
		expect(customCalls).toEqual([]);
		expect(files).toEqual([{ path: planPath, name: basename(planPath) }]);
		expect(events).toEqual(["file", "editor"]);
		const prompt = editorCalls[0]?.title ?? "";
		expect(prompt).toContain("Plan (1 step)");
		expect(prompt).toContain("Plan mode is on");
		expect(prompt).toContain("1. Do it");
		expect(prompt).toContain("The plan is above.");
		expect(prompt).toContain("Reply 1 approve");
		expect(timeouts).toEqual([PLAN_REVIEW_TIMEOUT_MS]);
	});

	test("sends the plan file before the prompt", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx, files, editorCalls } = remoteCtx({ cwd: root, editor: "2" });
		await callTool(exit, { plan_path: planPath }, ctx);
		expect(files).toEqual([{ path: planPath, name: basename(planPath) }]);
		expect(editorCalls[0]?.title).toContain("The plan is above.");
	});

	test("the digest names the plan title when the file has one", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Test plan\n\n1. Do it");

		const { ctx, editorCalls } = remoteCtx({ cwd: root, editor: "3" });
		await callTool(exit, { plan_path: planPath }, ctx);
		expect(editorCalls[0]?.title).toContain("Plan: Test plan (1 step)");
	});

	test("removes the full-plan action and keeps planning on 2", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Test plan\n\n1. Do it");

		const { ctx, posted, files, editorCalls, timeouts } = remoteCtx({ cwd: root, editor: "2" });
		const result = await callTool(exit, { plan_path: planPath }, ctx);
		expect(result.details.approved).toBe(false);
		expect(runtime.isEnabled()).toBe(true);
		expect(files).toEqual([{ path: planPath, name: basename(planPath) }]);
		expect(posted).toEqual([]);
		expect(editorCalls).toHaveLength(1);
		expect(timeouts).toEqual([PLAN_REVIEW_TIMEOUT_MS]);
		const prompt = editorCalls[0]?.title ?? "";
		expect(prompt).not.toContain("full plan");
		expect(prompt).toContain("2 keep planning");
	});

	test("falls back to the plan text when the file cannot be sent", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Test plan\n\n1. Do it");

		const { ctx, posted, events, setFileResult } = remoteCtx({ cwd: root, editor: "1" });
		setFileResult(false);
		await callTool(exit, { plan_path: planPath }, ctx);
		expect(events).toEqual(["file", "post", "editor"]);
		expect(posted[0]).toContain("# Test plan");
		expect(posted[0]).toContain("1. Do it");
	});

	// The review sizes itself to the whole terminal, so it must be an overlay.
	// Mounted in the editor slot of Pi's dock it would share the terminal with the
	// transcript, status line, widgets, and footer, and the layout would clip the
	// bottom of the screen — its own footer hints.
	test("mounts the review screen as a full-screen overlay", async () => {
		const { enter, exit, write, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. Do it");

		const { ctx } = planCtx({ mode: "tui", cwd: root });
		const seen: unknown[] = [];
		ctx.ui.custom = async (_factory: unknown, options: unknown) => {
			seen.push(options);
			return "approve";
		};
		await callTool(exit, { plan_path: planPath }, ctx);

		expect(seen).toEqual([
			{
				overlay: true,
				overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
			},
		]);
	});

	describe("the session goal", () => {
		/** Approve `content` through the dialog path with the given fake ctx options. */
		async function approve(content: string, options: { branch?: unknown[]; executeError?: string } = {}) {
			const { enter, exit, write, runtime, root } = setup();
			await enterPlan(enter, runtime, root);
			const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, content);
			const fake = planCtx({
				editor: "1",
				branch: options.branch,
				executeError: options.executeError,
				cwd: root,
			});
			const result = await callTool(exit, { plan_path: planPath }, fake.ctx);
			return { ...fake, result };
		}

		test("records the plan's title without asking", async () => {
			const { confirms, toolCalls, result } = await approve("# Add rate limiting\n\n## Steps\n- [ ] One");

			expect(confirms).toEqual([]);
			expect(
				toolCalls.some(
					(entry) => entry.name === "goal" && (entry.args as { objective: string }).objective === "Add rate limiting",
				),
			).toBe(true);
			expect(result.content[0].text).toContain("Recorded the session goal: Add rate limiting.");
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

		test("says nothing about a goal when the goal tool is not installed", async () => {
			// `allTools` names no goal, as when the sibling extension is disabled.
			const { enter, exit, write, runtime, root } = setup(undefined, { allTools: [{ name: TODO_TOOL }] });
			await enterPlan(enter, runtime, root);
			const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "# Add rate limiting\n\n## Steps\n- [ ] One");

			const { ctx, toolCalls } = planCtx({ editor: "1", cwd: root });
			const result = await callTool(exit, { plan_path: planPath }, ctx);

			expect(result.details.approved).toBe(true);
			expect(toolCalls.some((entry) => entry.name === "goal")).toBe(false);
			expect(result.content[0].text).not.toContain("session goal");
		});
	});
});

describe("plan steps", () => {
	test("ticks steps off in an approved plan and reports progress", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One\n2. Two\n3. Three");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- First [DONE:1]\n- Second");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One\n2. Two");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = planCtx({
			cwd: root,
			branch: todoBranch([
				{ content: "One", status: "pending" },
				{ content: "Two", status: "pending" },
			]),
		});
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = planCtx({ cwd: root, branch: todoBranch([{ content: "One", status: "completed" }]) });
		const result = await callTool(
			setSteps,
			{ plan_path: planPath, updates: [{ step: 1, status: "completed", expected: "One" }] },
			ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(toolCalls).toHaveLength(0);
		expect(result.content[0].text).toContain(`(1/1 done) in ${shortenPath(planDir(root))}`);
		expect(result.content[0].text).not.toContain("todo item");
	});

	test("reports a step with no matching todo item instead of inventing one", async () => {
		const { enter, exit, write, setSteps, runtime, root } = setup();
		await enterPlan(enter, runtime, root);
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx, toolCalls } = planCtx({ cwd: root, branch: todoBranch([{ content: "Renamed", status: "pending" }]) });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "1. One");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({
			cwd: root,
			branch: todoBranch([{ content: "One", status: "pending" }]),
			executeError: "at most 50 todos are allowed",
		});
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- One");
		await approvePlan(exit, planPath, root);

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		runtime.disable(planCtx({ cwd: root }).ctx);
		writeFileSync(join(root, "secret.md"), "- One");

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
		const planPath = await savePlan(write, planCtx({ cwd: root }).ctx, "- One");

		const { ctx } = planCtx({ cwd: root });
		const result = await callTool(
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
					action: "steps",
					path: "/x/plans/p.md",
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
	test("plan exit previews the plan and shows it in full when expanded", async () => {
		const { exit } = setup();
		const plan = ["# Plan", ...Array.from({ length: 20 }, (_, index) => `${index + 1}. step`)].join("\n");
		const details = { action: "exit", approved: true, plan, planPath: "/x/plans/p.md", relativePath: ".pi/plans/p.md" };

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
			{
				details: {
					action: "exit",
					approved: true,
					plan: "# P",
					planPath: "/x/plans/p.md",
					relativePath: ".pi/plans/p.md",
				},
			},
			{ expanded: false },
			fakeTheme,
		);
		const text = component.render(80).join("\n");
		expect(text).toContain(".pi/plans/p.md");
		expect(text).not.toContain("/x/plans/p.md");
	});

	test("strips control characters from the rendered plan and refinement", () => {
		const { exit } = setup();
		for (const expanded of [false, true]) {
			const component = exit.renderResult(
				{
					details: {
						action: "exit",
						approved: false,
						plan: "hello\u001b[31mred\u001b[0m\u0007 world",
						planPath: "/x/plans/p.md",
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
