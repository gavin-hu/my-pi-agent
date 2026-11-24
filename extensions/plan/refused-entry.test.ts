/**
 * A refused entry, at both doors that enter plan mode.
 *
 * The state is a branch holding the board's seat with `board` unloaded, so no refusal hook stands in
 * front of the call and the mode's own gate is the only thing between the call and a result claiming a
 * mode that never came on. `runtime.enable` answers with that gate's sentence, and both doors say it:
 * the tool as a `RefusedPlanDetails` refusal, `/plan <task>` as a notice that stops before the send.
 *
 * Its own suite rather than a case beside each door: `tools.test.ts` and `commands.test.ts` both sit
 * past the 400-line bar at a height `test/suite-sizes.test.ts` names, and a named suite may not gain a
 * line — the answer to a case that needs room is a split.
 */

import { describe, expect, test } from "bun:test";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { planCtx, planRuntimeSetup } from "../../test/helpers/fixtures/plan.ts";
import { callTool } from "../../test/helpers/tools.ts";
import { registerCommands } from "./commands.ts";
import { PLAN_TOOL } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** The sentence the gate hands a branch that holds the seat, which every door must say the same way. */
const REFUSAL = "Lead mode holds the seat: `/board exit` before planning.";

/** A branch holding the seat: the state where `board` may not be registered to refuse the call first. */
const leadEntry = (): unknown => ({ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } });

describe("a refused plan entry", () => {
	test("the tool answers the gate's sentence instead of a mode it did not enter", async () => {
		const { pi, tools, runtime } = planRuntimeSetup();
		registerTools(pi, runtime);
		const { ctx, notices } = planCtx({ confirm: true, branch: [leadEntry()] });

		const result = await callTool(tools.get(PLAN_TOOL), { action: "enter" }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ refused: "enter", error: REFUSAL });
		expect(result.content[0].text).toBe(`Error: ${REFUSAL}`);
		expect(runtime.isEnabled()).toBe(false);
		// One sentence, read by two readers: the runtime's warning is the only copy in the transcript.
		expect(notices.filter((notice) => notice.message === REFUSAL)).toHaveLength(1);
	});

	test("a task is not sent into the mode the branch refused", async () => {
		const { pi, commands, runtime, sentMessages } = planRuntimeSetup();
		registerCommands(pi, runtime);
		const { ctx, notices } = planCtx({ branch: [leadEntry()] });

		await commands.get("plan").handler("fix the retry loop", ctx);

		expect(runtime.isEnabled()).toBe(false);
		// The send is the half a notice alone never fixed: it would run with write access on.
		expect(sentMessages).toEqual([]);
		expect(notices.filter((notice) => notice.message === REFUSAL)).toHaveLength(1);
		expect(notices.some((notice) => notice.message.startsWith("Plan mode enabled"))).toBe(false);
	});
});
