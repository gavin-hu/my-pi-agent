/**
 * What `/agents` offers while plan mode is on.
 *
 * A background run started before the plan was entered keeps running, and the board is
 * the only screen that reaches it: cancelling stays open while collecting does not,
 * because a collect writes the run's result into a session meant to be read-only. The
 * board takes that as one predicate, so the `c` key and both hint sites read one fact —
 * and each case below pins both sides of it, because a case that only shows the planning
 * half passes on a predicate hard-wired to `false`.
 */

import { describe, expect, test } from "bun:test";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { fakeCtx, mountCustom } from "../../test/helpers/context.ts";
import { fakeTheme, makeFakePi, screenText } from "../../test/helpers/fakes.ts";
import type { BackgroundRun, BackgroundRuntime } from "./background.ts";
import { openAgents } from "./commands.ts";
import { AgentsBoardComponent } from "./view/agents-board.ts";

/** A finished run first, so `c` has something to act on, and a running one behind it. */
const RUNS: BackgroundRun[] = [
	{
		id: "a1",
		agent: "reviewer",
		task: "look",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 1_000,
		status: "finished",
		output: "looks good",
	},
	{ id: "a2", agent: "explorer", task: "map it", cwd: "/repo", startedAt: 0, status: "running" },
];

/** The branch that says plan mode is on. */
const PLANNING = [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }];

/** A board over those runs, with the policy the caller supplies. */
function board(collectable: () => boolean) {
	const collected: string[] = [];
	const cancelled: string[] = [];
	const component = new AgentsBoardComponent({
		runs: () => RUNS,
		theme: fakeTheme,
		now: () => 5_000,
		collectable,
		onCollect: (id) => collected.push(id),
		onCancel: (id) => cancelled.push(id),
		onClose: () => {},
		requestRender: () => {},
		viewportRows: () => 40,
	});
	return { component, collected, cancelled };
}

describe("the board under a collect policy", () => {
	test("acts on collect only where the policy allows it, and always on cancel", () => {
		const planned = board(() => false);
		planned.component.handleInput("c");
		expect(planned.collected).toEqual([]);
		planned.component.handleInput("j");
		planned.component.handleInput("x");
		expect(planned.cancelled).toEqual(["a2"]);

		const free = board(() => true);
		free.component.handleInput("c");
		expect(free.collected).toEqual(["a1"]);
	});

	test("offers the collect hint only where the policy allows it", () => {
		expect(screenText(board(() => false).component)).not.toContain("c collect");
		expect(screenText(board(() => true).component)).toContain("c collect");
	});
});

describe("the /agents command while planning", () => {
	test("opens the board, cancels a run, and collects nothing", async () => {
		const calls = { collect: [] as string[], cancel: [] as string[] };
		const background = {
			list: () => RUNS,
			collect: (id: string) => {
				calls.collect.push(id);
				return { ok: true, text: "collected output" } as const;
			},
			cancel: (id: string) => {
				calls.cancel.push(id);
				return true;
			},
			subscribe: () => () => {},
		} as unknown as BackgroundRuntime; // allow:interface-cast — the four calls this case drives, not the host's runtime
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: PLANNING }).ctx;
		mountCustom(ctx, {
			rows: 40,
			mounted: (component) => {
				component.handleInput("c");
				component.handleInput("j");
				component.handleInput("x");
				component.handleInput("\u001b");
			},
		});

		await openAgents(makeFakePi().pi, background, ctx);

		expect(calls.collect).toEqual([]);
		expect(calls.cancel).toEqual(["a2"]);
	});
});
