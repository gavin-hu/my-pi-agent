import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import type { BackgroundRun } from "./background.ts";
import { AgentsBoardComponent } from "./background-tui.ts";

const USAGE = {
	input: 1200,
	output: 800,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0.01,
	contextTokens: 2000,
	turns: 1,
};

const RUNS: BackgroundRun[] = [
	{ id: "a2", agent: "explorer", task: "Map the auth module", cwd: "/repo", startedAt: 1000, status: "running" },
	{
		id: "a1",
		agent: "reviewer",
		task: "Review",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 62_000,
		status: "finished",
		usage: USAGE,
		output: "The diff is coherent.",
	},
	{
		id: "a0",
		agent: "worker",
		task: "Fix the parser",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 1_000,
		status: "failed",
		exitCode: 1,
		errorMessage: "exit 1",
		output: "boom",
	},
];

/** Mount the board. */
function board(overrides: Partial<ConstructorParameters<typeof AgentsBoardComponent>[0]> = {}) {
	const actions = { collect: [] as string[], cancel: [] as string[], close: 0 };
	const component = new AgentsBoardComponent({
		runs: () => RUNS,
		theme: fakeTheme,
		now: () => 12_000,
		onCollect: (id) => actions.collect.push(id),
		onCancel: (id) => actions.cancel.push(id),
		onClose: () => {
			actions.close += 1;
		},
		requestRender: () => {},
		viewportRows: () => 40,
		...overrides,
	});
	return { component, actions };
}

function text(component: AgentsBoardComponent, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

describe("AgentsBoardComponent", () => {
	test("lists runs with status, task, duration, and usage", () => {
		const screen = text(board().component);

		expect(screen).toContain("Agents");
		expect(screen).toContain("3 runs · 1 running");
		expect(screen).toContain("a2 explorer");
		expect(screen).toContain("Map the auth module");
		expect(screen).toContain("a1 reviewer");
		expect(screen).toContain("Review");
		expect(screen).toContain("finished");
		expect(screen).toContain("1m02s");
	});

	test("Enter opens the focused run and Escape returns to the list", () => {
		const { component } = board();
		component.handleInput("\r");

		const detail = text(component);
		expect(detail).toContain("a2 explorer · running");
		expect(detail).toContain("Task");
		expect(detail).toContain("Map the auth module");
		expect(detail).toContain("Cwd");
		expect(detail).toContain("/repo");
		expect(detail).toContain("Esc back");

		component.handleInput("\u001b");
		expect(text(component)).toContain("3 runs");
	});

	test("c collects a finished run and x cancels a running one", () => {
		const { component, actions } = board();
		component.handleInput("x"); // a2, running
		expect(actions.cancel).toEqual(["a2"]);

		component.handleInput("j"); // a1, finished
		component.handleInput("c");
		expect(actions.collect).toEqual(["a1"]);
		component.handleInput("x"); // a1 is finished, no-op
		expect(actions.cancel).toEqual(["a2"]);
	});

	test("Escape on the list closes the board", () => {
		const { component, actions } = board();
		component.handleInput("\u001b");
		expect(actions.close).toBe(1);
	});

	test("shows an empty state", () => {
		const { component } = board({ runs: () => [] });
		expect(text(component)).toContain("No background subagents yet.");
	});

	test("reflects a finish without rebuilding", () => {
		let runs: BackgroundRun[] = [{ ...RUNS[0]! }];
		const { component } = board({ runs: () => runs });
		expect(text(component)).toContain("running");
		runs = [{ ...runs[0]!, status: "finished", finishedAt: 5_000, output: "done" }];
		const screen = text(component);
		expect(screen).toContain("finished");
		expect(screen).not.toContain("1 running");
	});

	test("keeps every line within the width", () => {
		const long: BackgroundRun[] = [
			{
				id: "a9",
				agent: "explorer",
				task: `a very long task ${"x".repeat(200)}`,
				cwd: `/home/u/${"nested/".repeat(10)}repo`,
				startedAt: 0,
				status: "running",
			},
		];
		const { component } = board({ runs: () => long });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
