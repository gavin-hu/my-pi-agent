/**
 * Plan-mode entry, shared by the extension that owns the mode and the one that
 * offers it as a phase of the goal.
 *
 * Plan mode has one owner: `plan` gates the tools, persists the flag, and draws
 * the footer. A tool context can reach it through `ctx.executeTool`, but a
 * command context cannot (`ExtensionCommandContext` has no `executeTool`), so the
 * request travels on `pi.events` as an in-process request/response. The caller
 * asks the user — with the consent sentence below — and `plan` enables without a
 * second dialog, so the session never asks twice for one decision.
 *
 * The consent sentence and the read-only summary live here because two
 * extensions show them: one copy each is how a trust guarantee drifts apart.
 * Value-only, as `lib/` must be: the state is the caller's context and a closure,
 * never a module variable.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isPlanModeEnabled } from "./plan-state.ts";
import { PLAN_ENTER_TOOL } from "./tool-names.ts";

/** EventBus channel on which a caller asks `plan` to enable plan mode. */
export const PLAN_ENTER_REQUEST = "my-pi-agent/plan-mode/enter";

/** One clause describing the read-only guarantee, reused across prompts. */
export const READ_ONLY_SUMMARY =
	"write and edit are disabled, bash is limited to read-only git commands, and other mutating tools are blocked; " +
	"subagent delegation is forced read-only, and the only file write is write_plan (under .pi/plans, or the agent " +
	"directory outside a repository)";

/**
 * The consent question, as the user sees it. Shown by `enter_plan_mode` and by
 * any caller that offers plan mode itself, so both describe the same guarantee.
 */
export const PLAN_CONSENT =
	`Plan mode is read-only exploration: ${READ_ONLY_SUMMARY}. ` +
	"Enter plan mode to investigate and propose an approach before making changes?";

/** The short remote consent; the full read-only summary stays in the tool docs. */
export const PLAN_CONSENT_SHORT =
	"Enter read-only plan mode? Writes and mutating tools are disabled until you approve a plan.";
export const PLAN_CONSENT_SHORT_ZH = "进入只读 plan 模式？批准计划前会禁用写入和修改。";

/** What a caller sends on {@link PLAN_ENTER_REQUEST}. */
export interface PlanEnterRequest {
	/** The caller's context; `plan` uses it for the footer status. */
	ctx: ExtensionContext;
	/** Called once, synchronously, with whether plan mode is on. */
	respond(entered: boolean): void;
}

/**
 * Ask `plan` to turn plan mode on, and report whether it is on afterwards.
 *
 * Resolves `true` without asking when the branch is already planning, and
 * `false` when the `plan` tool is not registered — so `goal` loaded alone keeps
 * working and nothing waits on a listener that is not there. The listener answers
 * synchronously; the microtask is the fallback that guarantees resolution.
 */
export function requestPlanMode(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (isPlanModeEnabled(ctx.sessionManager.getBranch())) return Promise.resolve(true);
	if (!pi.getAllTools().some((tool) => tool.name === PLAN_ENTER_TOOL)) return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const respond = (entered: boolean): void => {
			if (settled) return;
			settled = true;
			resolve(entered);
		};
		pi.events.emit(PLAN_ENTER_REQUEST, { ctx, respond } satisfies PlanEnterRequest);
		queueMicrotask(() => respond(false));
	});
}
