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
import { type BusAnswer, requestOverBus } from "./bus-request.ts";
import { isPlanModeEnabled } from "./plan-state.ts";
import { PLAN_ENTER_TOOL } from "./tool-names.ts";

/** EventBus channel on which a caller asks `plan` to enable plan mode. */
export const PLAN_ENTER_REQUEST = "my-pi-agent/plan-mode/enter";

/** EventBus channel on which a caller asks `plan` to flip the mode. */
export const PLAN_TOGGLE_REQUEST = "my-pi-agent/plan-mode/toggle";

/** One clause describing the read-only guarantee, reused across prompts. */
export const READ_ONLY_SUMMARY =
	"write and edit are disabled, bash is limited to read-only git commands, and other mutating tools are blocked; " +
	"subagent delegation is forced read-only, and the only file write is write_plan (a plan file in the agent " +
	"directory)";

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

/**
 * The refusal a command shows when plan mode forbids what it does.
 *
 * Plan mode is read-only, so every extension whose command changes something says so the
 * same way and names the action it is not doing: one sentence in `lib/`, because five
 * copies is how the guarantee stops reading as one guarantee.
 */
export function planModeRefusal(action: string): string {
	return `Plan mode is read-only. Approve the plan before ${action}.`;
}

/** What a caller sends on {@link PLAN_ENTER_REQUEST} or {@link PLAN_TOGGLE_REQUEST}. */
export interface PlanModeRequest {
	/** The caller's context; `plan` uses it for the footer status. */
	ctx: ExtensionContext;
	/** Claimed once, with whether plan mode is on; the caller settles on that claim. */
	respond(enabled: BusAnswer<boolean>): void;
}

/**
 * Whether the `plan` extension registered its tools in this session.
 */
export function isPlanExtensionLoaded(pi: Pick<ExtensionAPI, "getAllTools">): boolean {
	return pi.getAllTools().some((tool) => tool.name === PLAN_ENTER_TOOL);
}

/**
 * Ask `plan` to turn plan mode on, and report whether it is on afterwards.
 *
 * Resolves `true` without asking when the branch is already planning, and
 * `false` when the `plan` tool is not registered — so `goal` loaded alone keeps
 * working and nothing waits on a listener that is not there. The listener claims
 * synchronously; the shared handshake is what guarantees a resolution.
 */
export function requestPlanMode(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (isPlanModeEnabled(ctx.sessionManager.getBranch())) return Promise.resolve(true);
	if (!isPlanExtensionLoaded(pi)) return Promise.resolve(false);
	return requestOverBus<boolean, PlanModeRequest>(pi, {
		channel: PLAN_ENTER_REQUEST,
		payload: (respond) => ({ ctx, respond }),
		unclaimed: () => false,
	});
}

/**
 * Ask `plan` to flip the mode, and report the state it left behind.
 *
 * A toggle has no branch precondition: the owner reads the flag it persisted and
 * resolves the opposite. `undefined` means nothing is listening (the `plan`
 * extension is not loaded), so the caller can leave its own key alone.
 */
export function requestPlanToggle(
	pi: Pick<ExtensionAPI, "events">,
	ctx: ExtensionContext,
): Promise<boolean | undefined> {
	return requestOverBus<boolean | undefined, PlanModeRequest>(pi, {
		channel: PLAN_TOGGLE_REQUEST,
		payload: (respond) => ({ ctx, respond }),
		unclaimed: () => undefined,
	});
}
