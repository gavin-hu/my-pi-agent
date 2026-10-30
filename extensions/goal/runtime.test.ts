import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";
import { resultEntry, todoEntry } from "../../test/helpers/fixtures/goal.ts";
import { DEFAULT_GOAL_CONFIG, loadGoalConfig, normalizeGoalConfig } from "./config.ts";
import { createGoalRuntime } from "./runtime.ts";
import { openTodoCount, reconstructGoal, settledGoal } from "./state.ts";
import type { Goal } from "./types.ts";

const planning = (objective: string): Goal => ({ objective, status: "planning" });
const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

describe("goal state", () => {
	test("reads the last goal written on the branch", () => {
		expect(reconstructGoal([resultEntry(active("first")), resultEntry(achieved("second"))])).toEqual(
			achieved("second"),
		);
	});

	test("reads a command entry and honours an explicit clear", () => {
		const command = { type: "custom", customType: "goal", data: { goal: active("from command") } };
		expect(reconstructGoal([command])).toEqual(active("from command"));
		expect(reconstructGoal([resultEntry(active("one")), resultEntry(null)])).toBeNull();
	});

	test("returns null for an empty branch", () => {
		expect(reconstructGoal([])).toBeNull();
	});

	test("reads the planning phase off the branch", () => {
		expect(reconstructGoal([resultEntry(planning("design it"))])).toEqual(planning("design it"));
		const command = { type: "custom", customType: "goal", data: { goal: planning("from command") } };
		expect(reconstructGoal([command])).toEqual(planning("from command"));
	});

	test("openTodoCount counts only the items the list still has open", () => {
		const branch = [
			todoEntry([
				{ content: "Close the docs", status: "completed" },
				{ content: "Ship the parser", status: "in_progress" },
				{ content: "Write the notes", status: "pending" },
			]),
		];
		expect(openTodoCount(branch)).toBe(2);
		expect(openTodoCount([])).toBe(0);
	});

	test("settledGoal promotes a planning goal only once plan mode is off", () => {
		expect(settledGoal(planning("ship it"), false)).toEqual(active("ship it"));
		expect(settledGoal(planning("ship it"), true)).toBeNull();
	});

	test("settledGoal never rewrites a final goal", () => {
		expect(settledGoal(active("ship it"), false)).toBeNull();
		expect(settledGoal(achieved("ship it"), false)).toBeNull();
		expect(settledGoal(null, false)).toBeNull();
	});
});

describe("goal config", () => {
	test("returns the base for missing input and defaults to hiding achieved goals", () => {
		const base = normalizeGoalConfig(undefined, DEFAULT_GOAL_CONFIG);
		expect(base).toEqual(DEFAULT_GOAL_CONFIG);
		expect(normalizeGoalConfig({}, base).achieved).toBe("hide");
	});

	test("accepts show/hide and falls back on retired or unknown values", () => {
		expect(normalizeGoalConfig({ achieved: "show" }, DEFAULT_GOAL_CONFIG).achieved).toBe("show");
		expect(normalizeGoalConfig({ achieved: "hide" }, DEFAULT_GOAL_CONFIG).achieved).toBe("hide");
		for (const bad of ["collapse", "block", "nope"]) {
			expect(normalizeGoalConfig({ achieved: bad }, DEFAULT_GOAL_CONFIG).achieved).toBe("hide");
		}
	});

	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
		}, "goal-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("goal-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ goal: { achieved: "hide" } }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ goal: { achieved: "show" } }));
			expect(loadGoalConfig(repo).achieved).toBe("hide");
		}, "goal-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadGoalConfig(tempDir("goal-repo-"))).toEqual(DEFAULT_GOAL_CONFIG);
		}, "goal-global-");
	});
});

describe("goal runtime", () => {
	test("getGoal returns a copy that cannot mutate the live goal", () => {
		const runtime = createGoalRuntime();
		runtime.setGoal({ objective: "ship it", status: "active" });

		const snapshot = runtime.getGoal();
		snapshot!.objective = "mutated";

		expect(runtime.getGoal()).toEqual({ objective: "ship it", status: "active" });
	});

	test("sets a rail widget on a TUI session and clears it with the goal", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });

		runtime.setGoal(active("ship it"), ctx);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);

		runtime.setGoal(null, ctx);
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("does not touch the widget in a non-TUI session", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "print" });

		runtime.setGoal(active("ship it"), ctx);

		expect(widgetCalls).toHaveLength(0);
	});

	test("hides an achieved goal by default and shows it when configured", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });

		runtime.setGoal(achieved("done"), ctx);
		expect(lastWidget(widgetCalls)).toBeUndefined();

		runtime.setConfig({ achieved: "show" });
		runtime.setGoal(achieved("done"), ctx);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("reconstructs the goal from the branch and syncs the widget", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry(active("branched"))] });

		runtime.reconstruct(ctx);

		expect(runtime.getGoal()).toEqual(active("branched"));
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("reconstructs a hidden achieved goal without rendering it", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui", branch: [resultEntry(achieved("done"))] });

		runtime.reconstruct(ctx);

		expect(runtime.getGoal()).toEqual(achieved("done"));
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("announces a rail change only when a visible goal is set", () => {
		const { pi } = makeFakePi();
		const runtime = createGoalRuntime(pi);
		runtime.setConfig({ achieved: "hide" });
		let announces = 0;
		pi.events.on("my-pi-agent/rails-changed/goal", () => announces++);
		const { ctx } = fakeCtx({ mode: "tui" });

		// Achieved + `hide` removes the rail, so the rails below it need no re-assert.
		runtime.setGoal(achieved("ship it"), ctx);
		expect(announces).toBe(0);

		// A visible (active) goal re-asserts the stack under it.
		runtime.setGoal(active("ship again"), ctx);
		expect(announces).toBe(1);
	});

	test("hides the rail while a dock screen is open and restores it after", async () => {
		const { pi } = makeFakePi();
		const runtime = createGoalRuntime(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		runtime.setGoal(active("ship it"), ctx);

		await withRailsSuppressed(pi, async () => {
			expect(lastWidget(widgetCalls)).toBeUndefined();
		});

		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("a suppression change after clear cannot touch the stale context", async () => {
		const { pi } = makeFakePi();
		const runtime = createGoalRuntime(pi);
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		runtime.setGoal(active("ship it"), ctx);
		runtime.clear(ctx);
		const callsAfterClear = widgetCalls.length;

		await withRailsSuppressed(pi, async () => {});

		expect(widgetCalls).toHaveLength(callsAfterClear);
	});

	test("clear drops the goal and the widget", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		runtime.setGoal(active("ship it"), ctx);

		runtime.clear(ctx);

		expect(runtime.getGoal()).toBeNull();
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("renders the rail with the configured achieved style", () => {
		const runtime = createGoalRuntime();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		runtime.setConfig({ achieved: "show" });
		runtime.setGoal(achieved("done"), ctx);

		const factory = lastWidget(widgetCalls) as (
			tui: unknown,
			theme: typeof fakeTheme,
		) => { render(w: number): string[] };
		expect(factory(undefined, fakeTheme).render(40)).toEqual(["Goal · achieved · done"]);
	});
});
