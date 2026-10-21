import { describe, expect, test } from "bun:test";
import { PLAN_CONSENT, PLAN_ENTER_REQUEST, type PlanEnterRequest } from "../../lib/plan-entry.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { PLAN_ASK, goalPhase } from "./plan-route.ts";
import type { Goal } from "./types.ts";

const planning = (objective: string): Goal => ({ objective, status: "planning" });
const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

/** A branch that plan mode has turned on. */
const PLANNING_ON = [{ type: "custom", customType: "plan-mode", data: { enabled: true } }];

/** A fake pi that registers `enter_plan_mode`, as the plan extension does. */
function fakePi() {
	return makeFakePi({ allTools: [{ name: "enter_plan_mode" }] });
}

/** A fake pi without the plan extension, so the phase cannot be entered. */
function fakePiWithoutPlan() {
	return makeFakePi({ allTools: [{ name: "read" }] });
}

describe("goalPhase", () => {
	test("keeps the phase of a goal that is already pursued", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, active("ship it"), { ask: true })).toBe("active");
		expect(await goalPhase(pi, ctx, planning("design it"), { ask: true })).toBe("planning");
		expect(confirms).toEqual([]);
	});

	test("names a draft while plan mode is already on", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx({ branch: PLANNING_ON });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("planning");
		expect(confirms).toEqual([]);
	});

	test("does not ask when the command records without a run", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, null, { ask: false })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("does not ask without a dialog UI", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx({ mode: "print" });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("does not ask when plan mode is not loaded", async () => {
		const { pi } = fakePiWithoutPlan();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("asks with the shared consent sentence and records the draft when accepted", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx({ confirm: true });
		const requests: PlanEnterRequest[] = [];
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => {
			requests.push(data as PlanEnterRequest);
			(data as PlanEnterRequest).respond(true);
		});

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("planning");
		expect(confirms).toEqual([{ title: PLAN_ASK, message: PLAN_CONSENT }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].ctx).toBe(ctx);
	});

	test("records the objective when the offer is declined, without requesting plan mode", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx({ confirm: false });
		const requests: PlanEnterRequest[] = [];
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => requests.push(data as PlanEnterRequest));

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toHaveLength(1);
		expect(requests).toEqual([]);
	});

	test("records the objective when the request is not answered", async () => {
		const { pi } = fakePi();
		const { ctx } = fakeCtx({ confirm: true });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
	});

	test("a new goal over an achieved one is offered the phase again", async () => {
		const { pi } = fakePi();
		const { ctx, confirms } = fakeCtx({ confirm: false });

		expect(await goalPhase(pi, ctx, achieved("old goal"), { ask: true })).toBe("active");
		expect(confirms).toHaveLength(1);
	});
});
