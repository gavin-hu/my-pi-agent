/**
 * The `/agents` detail pane over a run that changes while it is open.
 *
 * The pane's facts and subtitle are derived from the row, not stored on it: a run that
 * finishes (or fails) under an open pane must update its status, duration, usage and error
 * rather than freeze the snapshot it was opened with.
 */

import { describe, expect, test } from "bun:test";
import type { BackgroundRun } from "./background.ts";
import { AgentsBoardComponent } from "./view/agents-board.ts";
import { emptyUsage } from "./stream.ts";
import { screenText } from "../../test/helpers/fakes.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

const START = 10_000;

/** A run, and a way to swap it for its finished self under the open pane. */
function harness() {
	let now = START + 1_000;
	let runs: BackgroundRun[] = [
		{ id: "a1", agent: "explorer", task: "map the loader", cwd: "/repo", startedAt: START, status: "running" },
	];
	const component = new AgentsBoardComponent({
		runs: () => runs,
		theme: fakeTheme,
		now: () => now,
		onCollect: () => {},
		onCancel: () => {},
		onClose: () => {},
		requestRender: () => {},
		viewportRows: () => 40,
	});
	return {
		component,
		open() {
			component.handleInput("\r");
		},
		finish(overrides: Partial<BackgroundRun> = {}) {
			now = START + 11_000;
			runs = [
				{
					id: "a1",
					agent: "explorer",
					task: "map the loader",
					cwd: "/repo",
					startedAt: START,
					status: "finished",
					finishedAt: START + 11_000,
					exitCode: 0,
					usage: { ...emptyUsage(), turns: 3, input: 1_200, output: 300 },
					output: "the plan",
					...overrides,
				},
			];
		},
	};
}

describe("a detail pane over a live run", () => {
	test("follows the run to finished instead of freezing it", () => {
		const board = harness();
		board.open();
		expect(screenText(board.component)).toContain("running");
		board.finish();
		const text = screenText(board.component);
		expect(text).toContain("finished");
		expect(text).not.toContain("Still running");
		// Usage arrives with the finish, and the duration is the run's, not the clock's.
		expect(text).not.toContain("(not reported)");
		expect(text).toContain("11.0s");
	});

	test("gains the error row when it fails under the pane", () => {
		const board = harness();
		board.open();
		board.finish({ status: "failed", exitCode: 1, errorMessage: "exit 1" });
		const text = screenText(board.component);
		expect(text).toContain("failed");
		expect(text).toContain("exit 1");
	});
});
