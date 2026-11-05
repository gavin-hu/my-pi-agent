/**
 * What the approval question says, and the facts `exit` hands it.
 *
 * The screen draws the sentence and drops a clause the approval will not carry
 * out; `exit` owns the two facts behind it — the steps the approval seeds and
 * whether the session goal is set — so the seam is driven through the real tool.
 * A blank plan is refused there too, before any surface can offer `a` for it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GOAL_TOOL } from "../../lib/tool-names.ts";
import { useEnv } from "../../test/helpers/env.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";
import { makePlanPi, planCtx } from "../../test/helpers/fixtures/plan.ts";
import { planReview, REVIEW_TUI, renderReview } from "../../test/helpers/plan-view.ts";
import { callTool } from "../../test/helpers/tools.ts";
import type { PlanAction } from "./runtime.ts";
import { createPlanRuntime, PLAN_TOOL } from "./runtime.ts";
import { createPlanPolicy } from "./policy.ts";
import { registerTools } from "./tools.ts";
import type { PlanViewOptions } from "./tui.ts";
import type { ApprovalEffects } from "./types.ts";

/** One agent directory for this file: plans land outside the project now. */
const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-answer-agent-"));
let scoped: { restore: () => void } | undefined;
let root = "";
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
	root = mkdtempSync(join(tmpdir(), "pi-plan-answer-"));
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
	rmSync(root, { recursive: true, force: true });
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

/** The exec seam the fake `pi` calls: every cwd is its own repository root. */
function repoExec(dir: string) {
	return async (command: string, args: string[]) =>
		command === "git" && args[0] === "rev-parse"
			? { stdout: `${dir}\n`, stderr: "", code: 0 }
			: { stdout: "", stderr: "", code: 1 };
}

/** A plan tool registered the way the extension registers it. */
function harness() {
	const fake = makePlanPi({
		active: ["read", "bash", "write", "edit", PLAN_TOOL, "todo"],
		// A normal install has `goal` registered by its sibling extension; the
		// approval probes for it before recording the session goal.
		allTools: [{ name: GOAL_TOOL }],
		exec: repoExec(root),
	});
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime);
	return { ...fake, runtime, plan: fake.tools.get(PLAN_TOOL) };
}

/** The folded tool's one action, as Pi calls it. */
function act(plan: unknown, action: PlanAction, params: Record<string, unknown>, ctx: unknown) {
	return callTool(plan, { ...params, action }, ctx);
}

/** Enter plan mode through the real tool, in a repository rooted at `root`. */
async function enter(plan: unknown, runtime: { isEnabled(): boolean }) {
	await act(plan, "enter", {}, planCtx({ confirm: true, cwd: root }).ctx);
	expect(runtime.isEnabled()).toBe(true);
}

/** Save a plan through the real tool and return its path. */
async function savePlan(plan: unknown, content: string): Promise<string> {
	const result = await act(plan, "write", { title: "Test plan", content }, planCtx({ cwd: root }).ctx);
	expect(result.isError).toBeUndefined();
	return (result.details as { path: string }).path;
}

/**
 * The approval facts `review.ts` handed the screen.
 *
 * The screen keeps what its constructor was given, and its options are private:
 * the factory's one product is that screen, so reading the field back is the only
 * way to see what `exit` said to it.
 */
function handedApproval(factory: unknown): ApprovalEffects | undefined {
	const build = factory as (tui: unknown, theme: unknown, keys: unknown, done: unknown) => unknown;
	const component = build(REVIEW_TUI, fakeTheme, {}, () => {}) as unknown as { options: PlanViewOptions };
	return component.options.approval;
}

/** The footer line a review draws with a pending `y/N` question. */
function questionLine(content: string, approval?: ApprovalEffects, width = 80): string {
	const { component } = planReview(content, approval === undefined ? {} : { approval });
	component.handleInput("a");
	return renderReview(component, width).at(-2) ?? "";
}

describe("the approval question", () => {
	test("names the steps it seeds and the goal it sets", () => {
		const line = questionLine("# Plan\n\n## Steps\n- [ ] one\n- [ ] two\n- [ ] three");
		expect(line).toContain("Approve & run the plan? y/N — plan mode off, 3 steps to todo, goal set");
	});

	test("says one step, not one steps", () => {
		const line = questionLine("# Plan\n\n## Steps\n- [ ] one");
		expect(line).toContain("1 step to todo");
	});

	test("drops the goal clause when the goal is already final", () => {
		expect(questionLine("# Plan\n\n## Steps\n- [ ] one\n- [ ] two", { steps: 2, setsGoal: false })).toContain(
			"plan mode off, 2 steps to todo",
		);
		expect(questionLine("# Plan\n\n## Steps\n- [ ] one\n- [ ] two", { steps: 2, setsGoal: false })).not.toContain(
			"goal",
		);
	});

	test("drops the step clause for a plan with no steps, and keeps the mode change alone", () => {
		expect(questionLine("# Plan\n\nNo steps yet.", { steps: 0, setsGoal: true })).toContain("plan mode off, goal set");
		const bare = questionLine("# Plan\n\nNo steps yet.", { steps: 0, setsGoal: false });
		expect(bare).toContain("plan mode off");
		expect(bare).not.toContain("todo");
		expect(bare).not.toContain("goal");
	});

	test("keeps its answer when the footer is narrow", () => {
		const approval = { steps: 3, setsGoal: true };
		for (const width of [80, 60, 40]) {
			expect(questionLine("# Plan\n\n## Steps\n- [ ] one\n- [ ] two\n- [ ] three", approval, width)).toContain("y/N");
		}
	});
});

describe("the facts exit hands the screen", () => {
	test("counts the plan's steps and promises the goal", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime);
		const path = await savePlan(plan, "# Plan\n\n## Steps\n- [ ] one\n- [ ] two");

		const { ctx, customCalls } = planCtx({ mode: "tui", custom: { action: "keep" }, cwd: root });
		await act(plan, "exit", { plan_path: path }, ctx);

		expect(handedApproval(customCalls[0])).toEqual({ steps: 2, setsGoal: true });
	});

	test("drops the goal when the user's own goal is already final", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime);
		const path = await savePlan(plan, "# Plan\n\n## Steps\n- [ ] one");

		const { ctx, customCalls } = planCtx({
			mode: "tui",
			custom: { action: "keep" },
			cwd: root,
			branch: [resultEntry({ objective: "the user's own goal", status: "active" })],
		});
		const result = await act(plan, "exit", { plan_path: path }, ctx);

		expect(handedApproval(customCalls[0])).toEqual({ steps: 1, setsGoal: false });
		expect(result.details.approved).toBe(false);
	});

	test("refuses a blank plan before any screen opens", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime);
		const path = await savePlan(plan, "# Plan\n\n## Steps\n- [ ] one");
		// A hand-edited or truncated file: `write` refuses empty content, so this is
		// the only way a blank plan reaches the review.
		writeFileSync(path, "");

		const { ctx, customCalls } = planCtx({ mode: "tui", custom: { action: "approve" }, cwd: root });
		const result = await act(plan, "exit", { plan_path: path }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.refused).toBe("exit");
		expect(result.content[0].text).toContain("is empty");
		expect(result.content[0].text).toContain("`cancel`");
		expect(customCalls).toEqual([]);
		expect(runtime.isEnabled()).toBe(true);
	});
});
