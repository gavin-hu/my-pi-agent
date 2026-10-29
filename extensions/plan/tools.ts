/**
 * Model-facing registration for the plan-mode tools.
 *
 * `enter_plan_mode` lets the model ask to plan before touching code; it needs
 * user confirmation. `write_plan` saves the plan artifact in the plans directory and
 * returns its path. `cancel_plan_mode` leaves planning without approving, so a
 * phone user is never trapped in read-only mode. `exit_plan_mode` reads that file
 * back, presents it for approval (a scrollable review screen in the TUI, a select dialog elsewhere),
 * and on approval seeds the `todo` tool with the plan's steps (through
 * `ctx.executeTool`, so the todo widget and validation run normally).
 * `set_plan_steps` then keeps the plan current: after approval the model ticks
 * each step off in place as it finishes it, and the todo item approval seeded
 * from that step is ticked with it. The file is the source of truth: the model
 * executes from it.
 *
 * Each registration lives in `tools/`: its schema, execute handler, and
 * transcripts stay together, and the approval-time helpers they share live next
 * to them. This module only composes them, in the order the session sees them.
 *
 * Without an interactive UI the approval tools fail with an actionable message
 * instead of deciding for the user.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PlanRuntime } from "./runtime.ts";
import { registerCancelTool } from "./tools/cancel.ts";
import { registerEnterTool } from "./tools/enter.ts";
import { registerExitTool } from "./tools/exit.ts";
import { registerSetPlanStepsTool } from "./tools/steps.ts";
import { registerWriteTool } from "./tools/write.ts";
import { createLazyPlanWebReview, NO_SERVER_DEPS } from "./web-lazy.ts";
import type { PlanWebReview } from "./web.ts";

export function registerTools(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createLazyPlanWebReview(runtime.plans, NO_SERVER_DEPS),
): void {
	registerEnterTool(pi, runtime);
	registerCancelTool(pi, runtime);
	registerWriteTool(pi, runtime);
	registerExitTool(pi, runtime, web);
	registerSetPlanStepsTool(pi, runtime);
}
