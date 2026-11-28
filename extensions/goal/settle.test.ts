/**
 * The one moment a planning goal becomes final when no plan was approved.
 *
 * `settle` reads the branch at three moments — a session load, a `/tree`, and the start of
 * a turn — and writes the promoted goal as a `goal` custom entry. The extension suite holds
 * registration, the command and the restatement; this one holds the gate itself, so a change
 * to when it runs reddens here rather than in a case about a widget.
 */
import { describe, expect, test } from "bun:test";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { emit, emitCollect, makeFakePi } from "../../test/helpers/fakes.ts";
import { resultEntry } from "../../test/helpers/fixtures/goal.ts";
import goal, { GOAL_CONTEXT_MARKER } from "./index.ts";
import type { Goal } from "./types.ts";

const planning = (objective: string): Goal => ({ objective, status: "planning" });

/** A branch that plan mode has turned on. */
const PLAN_MODE_ON = { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } };

describe("goal settle gate", () => {
	test("settles a planning goal once plan mode is left without a plan", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it"))] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "design it", status: "active" } });
	});

	test("leaves a planning goal alone while plan mode is on", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it")), PLAN_MODE_ON] });
		await emit(pi, "session_start", { reason: "startup" }, ctx);

		expect(entries).toEqual([]);
	});

	test("promotes the draft on a /tree, where the branch is read again", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it"))] });
		await emit(pi, "session_tree", {}, ctx);

		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "design it", status: "active" } });
	});

	test("leaves the draft alone on a /tree while plan mode is on", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it")), PLAN_MODE_ON] });
		await emit(pi, "session_tree", {}, ctx);

		expect(entries).toEqual([]);
	});

	test("promotes before the turn that restates it", async () => {
		const { pi, entries } = makeFakePi();
		goal(pi);
		// The draft was recorded while plan mode was on, so the load leaves it a draft...
		const loaded = fakeCtx({ branch: [resultEntry(planning("design it")), PLAN_MODE_ON] });
		await emit(pi, "session_start", { reason: "startup" }, loaded.ctx);
		expect(entries).toEqual([]);

		// ...and the turn after the mode was left is where it becomes the objective.
		const { ctx } = fakeCtx({ branch: [resultEntry(planning("design it"))] });
		const [result] = await emitCollect(pi, "before_agent_start", {}, ctx);

		// The write is the gate's, and the restatement below it is built from the promoted goal.
		expect(entries.at(-1)?.data).toEqual({ goal: { objective: "design it", status: "active" } });
		expect(result.message.customType).toBe("goal-context");
		expect(result.message.content).toContain(GOAL_CONTEXT_MARKER);
		expect(result.message.content).toContain("design it");
	});
});
