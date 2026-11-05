/**
 * An interrupt on the plan review: `Ctrl+C` is not another `Escape`.
 *
 * The screen decides, the review loop passes the decision on, and the `exit`
 * action ends the turn — so the cases here run the three together: an interrupt
 * from wherever the keyboard is, the decision it returns, and the block the turn
 * leaves behind. `Escape` keeps its layered meaning, which is the half of the
 * contract an interrupt must not change.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { useEnv } from "../../test/helpers/env.ts";
import { planCtx, planRepoPi } from "../../test/helpers/fixtures/plan.ts";
import { planReview, renderReview, REVIEW_TUI } from "../../test/helpers/plan-view.ts";
import { createPlanPolicy } from "./policy.ts";
import { createPlanRuntime } from "./runtime.ts";
import { executeExit, textExit } from "./tools/exit.ts";
import type { PlanWebReview } from "./web.ts";

const INTERRUPT = "\x03";
const ESCAPE = "\x1b";

/** One agent directory for this file: the plan store lands outside the project. */
const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-interrupt-agent-"));
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

describe("the review screen", () => {
	test("Ctrl+C closes with interrupt from wherever the keyboard is", () => {
		const reading = planReview();
		reading.component.handleInput(INTERRUPT);
		expect(reading.actions).toEqual(["interrupt"]);

		// The y/N approval question and the inline refine editor are the two layers
		// Escape backs out of first; an interrupt answers neither of them.
		const asking = planReview();
		asking.component.handleInput("a");
		asking.component.handleInput(INTERRUPT);
		expect(asking.actions).toEqual(["interrupt"]);

		const editing = planReview(undefined, { tui: REVIEW_TUI });
		renderReview(editing.component, 80);
		editing.component.handleInput("r");
		editing.component.handleInput(INTERRUPT);
		expect(editing.actions).toEqual(["interrupt"]);
	});

	test("Escape still keeps the plan, and still leaves only the layer it is in", () => {
		const reading = planReview();
		reading.component.handleInput(ESCAPE);
		expect(reading.actions).toEqual(["keep"]);

		const asking = planReview();
		asking.component.handleInput("a");
		asking.component.handleInput(ESCAPE);
		expect(asking.actions).toEqual([]);
		expect(renderReview(asking.component, 80).join("\n")).toContain("a approve");

		const editing = planReview(undefined, { tui: REVIEW_TUI });
		renderReview(editing.component, 80);
		editing.component.handleInput("r");
		editing.component.handleInput(ESCAPE);
		expect(editing.actions).toEqual([]);
		// Back to reading, not out of the review: the same key closes it one layer up.
		expect(renderReview(editing.component, 80).join("\n")).toContain("Esc keep plan");
	});
});

describe("the exit action", () => {
	test("aborts the turn and leaves plan mode on", async () => {
		const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-interrupt-")));
		const pi = planRepoPi(root);
		const runtime = createPlanRuntime(pi, createPlanPolicy(pi));
		const { ctx, toolCalls, aborted } = planCtx({ mode: "tui", custom: { action: "interrupt" }, cwd: root });
		runtime.enable(ctx);
		const saved = await runtime.plans.write(root, { title: "Test plan", content: "1. Do it" });

		// The interrupt path must never reach the browser review, so the stub counts
		// the starts it should not see rather than only refusing to serve one.
		let starts = 0;
		const web = {
			start: async () => {
				starts += 1;
				return undefined;
			},
		} as unknown as PlanWebReview;
		const result = await executeExit(pi, runtime, web, { plan_path: saved.path }, ctx, undefined);

		expect(starts).toBe(0);
		expect(aborted()).toBe(1);
		expect(result.details).toMatchObject({ action: "exit", approved: false, interrupted: true });
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		expect(text).toContain("Plan mode is still on");
		// An interrupt is not a request to keep planning, so the model is not told
		// to ask what to change.
		expect(text).not.toContain("ask what to change");
		expect(runtime.isEnabled()).toBe(true);
		expect(toolCalls).toEqual([]);
	});

	test("records the interrupt in the result block", () => {
		const text = textExit(
			{ action: "exit", approved: false, interrupted: true, plan: "1. Do it", relativePath: ".pi/plans/p.md" },
			false,
			fakeTheme,
		);
		expect(text).toContain("Plan review interrupted");
		expect(text).not.toContain("Plan not approved");
		expect(text).toContain(".pi/plans/p.md");
	});
});
