/**
 * The folded `plan` tool, bound the way a case drives one of its actions.
 *
 * The tool is one registration with an `action` discriminant, so a case that exercises `write`
 * passes `write`'s fields and this adds the verb. The seam is the tool's real `execute` and
 * `renderResult`, not a stand-in for them: a moved signature fails here, and the details a case
 * reads come back as the union the extension declares rather than as `any`.
 *
 * Declared in `test/helpers/` for two reasons — the suite that uses it is over the size bar, and a
 * protocol this precise belongs beside the other plan doubles (`plan-command.ts`, `plan-view.ts`)
 * rather than at the top of one file.
 */

import type {
	AgentToolResult,
	ExtensionToolContext,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { Static } from "typebox";
import { asRecord } from "../../lib/json.ts";
import type { PlanParams } from "../../extensions/plan/tools.ts";
import type { PlanAction, PlanDetails } from "../../extensions/plan/types.ts";
import { toolRenderContext } from "./fakes.ts";

/** The registered plan tool, with the details its renderers read. */
export type PlanTool = ToolDefinition<typeof PlanParams, PlanDetails>;

/** The params a case passes: the tool's own fields, without the verb `boundPlanAction` adds. */
export type BoundParams = Omit<Static<typeof PlanParams>, "action">;

/** One action of the folded plan tool, as a case drives it. */
export interface BoundTool {
	execute: (
		toolCallId: string,
		params: BoundParams,
		signal: AbortSignal | undefined,
		onUpdate: ((partial: AgentToolResult<PlanDetails>) => void) | undefined,
		ctx: ExtensionToolContext,
	) => Promise<AgentToolResult<PlanDetails>>;
	/**
	 * Result rendering, driven with the fields a case builds: a rendering case spells the `details`
	 * its renderer reads rather than a whole tool result, so the body below supplies the empty
	 * content — the two required members `AgentToolResult` has are then both present.
	 */
	renderResult: (
		fields: { details?: unknown; content?: AgentToolResult<unknown>["content"] },
		options: Pick<ToolRenderResultOptions, "expanded">,
		theme: Theme,
	) => Component;
}

/**
 * Bind one action, with the verb folded into the params.
 *
 * `renderResult` takes the three arguments a case has and builds the fourth — the render context the
 * host supplies — the same way every other suite drives a renderer.
 */
export function boundPlanAction(plan: PlanTool, action: PlanAction): BoundTool {
	const render = plan.renderResult;
	if (render === undefined) throw new Error(`${plan.name} registers no renderResult`);
	return {
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			plan.execute(
				toolCallId,
				{ ...(asRecord(params) ?? {}), action } as Static<typeof PlanParams>,
				signal,
				onUpdate,
				ctx,
			),
		renderResult: (fields, options, theme) =>
			render(
				{ content: fields.content ?? [], details: fields.details } as AgentToolResult<PlanDetails>,
				{ ...options, isPartial: false },
				theme,
				toolRenderContext(options) as Parameters<typeof render>[3],
			),
	};
}
