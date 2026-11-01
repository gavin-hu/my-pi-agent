/**
 * Plan mode starts no background subagent.
 *
 * A background run outlives the call and is reached only through `/agents`, which plan mode
 * refuses, so allowing the start left a run nobody could inspect or collect until the plan was
 * approved. The refusal is plan's, beside the `readOnly` it already forces onto the same call.
 */

import { describe, expect, test } from "bun:test";
import planMode from "./index.ts";
import { PLAN_TOOL } from "./runtime.ts";
import { SUBAGENT_READ_ONLY_PARAM } from "../../lib/tool-names.ts";
import { emitCollect as emit } from "../../test/helpers/fakes.ts";
import { makePlanPi, planCtx, stateEntry } from "../../test/helpers/fixtures/plan.ts";

/** A pi instance with plan mode restored as enabled and `subagent` registered. */
async function planning() {
	const fakePi = makePlanPi({ active: ["read", "subagent", PLAN_TOOL] });
	fakePi.pi.allTools = [
		{
			name: "subagent",
			parameters: {
				type: "object",
				properties: {
					task: { type: "string" },
					background: { type: "boolean" },
					[SUBAGENT_READ_ONLY_PARAM]: { type: "boolean" },
				},
			},
			sourceInfo: { path: "/pkg/extensions/subagent/index.ts" },
		},
	];
	planMode(fakePi.pi);
	const { ctx } = planCtx({ branch: [stateEntry(true)] });
	await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
	return { fakePi, ctx };
}

describe("a background subagent while planning", () => {
	test("is refused, and says why it could not be collected", async () => {
		const { fakePi, ctx } = await planning();
		const input = { agent: "explorer", task: "map the module", background: true };

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("Plan mode: a background run cannot be inspected or collected");
		expect(result.reason).toContain("run it in the foreground");
		expect(result.reason).toContain("`plan` action `exit`");
	});

	test("leaves the foreground call alone, still forced read-only", async () => {
		const { fakePi, ctx } = await planning();
		const input = { agent: "explorer", task: "map the module", readOnly: false };

		const [result] = await emit(fakePi.pi, "tool_call", { toolName: "subagent", input }, ctx);

		expect(result).toBeUndefined();
		expect(input.readOnly).toBe(true);
	});
});
