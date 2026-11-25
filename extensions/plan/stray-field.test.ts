/**
 * The `plan` tool refuses a field its action never reads, and an action it does not know.
 *
 * A `title` on `enter` was dropped in silence, and an action outside the five fell off the end of
 * the switch and answered nothing at all — the same fall-through `code_review` had. The table is
 * `runtime.ts`'s, beside the action list, and this suite holds both directions.
 */

import { describe, expect, test } from "bun:test";
import { planRuntimeSetup } from "../../test/helpers/fixtures/plan.ts";
import { PLAN_FIELDS, PLAN_TOOL } from "./runtime.ts";
import { PlanParams, registerTools } from "./tools.ts";

/** The tool, registered over a runtime no case here reaches: every one of them refuses first. */
function setup() {
	const { pi, tools, runtime, ctx } = planRuntimeSetup();
	registerTools(pi, runtime);
	return { tool: tools.get(PLAN_TOOL), ctx };
}

describe("plan tool: a stray field", () => {
	test("refuses a field the action never reads, naming the action that takes it", async () => {
		const { tool, ctx } = setup();
		const refused = await tool.execute("t", { action: "enter", title: "x" }, undefined, undefined, ctx);
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("enter does not act on title: `write` takes it");
	});

	test("refuses an action it does not know, instead of answering nothing", async () => {
		const { tool, ctx } = setup();
		const refused = await tool.execute("t", { action: "explode" }, undefined, undefined, ctx);
		expect(refused.isError).toBe(true);
		expect(refused.details.refused).toBe("unknown");
		expect(refused.content[0]?.text).toContain("unknown action");
	});

	test("does not refuse a field the caller left out", async () => {
		const { tool, ctx } = setup();
		const refused = await tool.execute(
			"t",
			{ action: "steps", plan_path: undefined, updates: undefined },
			undefined,
			undefined,
			ctx,
		);
		// It refuses for the missing plan, not for a field it was never sent.
		expect(refused.content[0]?.text).not.toContain("does not act on");
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const published = Object.keys(PlanParams.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(PLAN_FIELDS).flat());
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});
