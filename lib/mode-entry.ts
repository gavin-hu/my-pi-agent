/**
 * A mode's entry and what a refusal says, shared by the extension that owns a
 * mode and the ones that ask for it or must answer for it.
 *
 * Each mode has one owner: `plan` gates the tools, persists its flag, and draws
 * the footer; lead mode's owner is the board. A tool context can reach the owner
 * through `ctx.executeTool`, but a command context cannot
 * (`ExtensionCommandContext` has no `executeTool`), so a request travels on
 * `pi.events` as an in-process request/response: plan's own enter, toggle and
 * leave channels are here, and the caller asks the user with the consent sentence
 * below, so the session never asks twice for one decision.
 *
 * The consent sentence, the read-only summary and {@link modeRefusal} live here
 * because more than one extension shows them: one copy each is how a trust
 * guarantee drifts apart. Value-only, as `lib/` must be: the state is the
 * caller's context and a closure, never a module variable.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type BusAnswer, requestOverBus } from "./bus-request.ts";
import { dialogLanguage, isRemoteTurn, type UIContextCarrier } from "./interaction.ts";
import { isPlanModeEnabled, type SessionMode } from "./mode-state.ts";
import { PLAN_TOOL } from "./tool-names.ts";

/** A mode that refuses code: the two a session gates, never `auto`. */
export type LeashedMode = Exclude<SessionMode, "auto">;

/** EventBus channel on which a caller asks `plan` to enable plan mode. */
export const PLAN_ENTER_REQUEST = "my-pi-agent/plan-mode/enter";

/** EventBus channel on which a caller asks `plan` to flip the mode. */
export const PLAN_TOGGLE_REQUEST = "my-pi-agent/plan-mode/toggle";

/**
 * EventBus channel on which a caller asks `plan` to turn the mode off, and to
 * report whether it is off. Idempotent: a session already out of plan mode
 * answers `true` without changing anything, which is what a door entering a
 * different mode needs before it hides anything itself.
 */
export const PLAN_LEAVE_REQUEST = "my-pi-agent/plan-mode/leave";

/** One clause describing the read-only guarantee, reused across prompts. */
export const READ_ONLY_SUMMARY =
	"write and edit are disabled, bash is limited to read-only git commands, and other mutating tools are blocked; " +
	"subagent delegation is forced read-only, and the only file write is the plan file, saved by the `plan` tool's " +
	"`write` action in the agent directory";

/**
 * The consent question, as the user sees it. Shown by the `plan` tool's `enter`
 * action and by any caller that offers plan mode itself, so both describe the same
 * guarantee.
 */
export const PLAN_CONSENT =
	`Plan mode is read-only exploration: ${READ_ONLY_SUMMARY}. ` +
	"Enter plan mode to investigate and propose an approach before making changes?";

/** The short remote consent; the full read-only summary stays in the tool docs. */
export const PLAN_CONSENT_SHORT =
	"Enter read-only plan mode? Writes and mutating tools are disabled until you approve a plan.";
export const PLAN_CONSENT_SHORT_ZH = "进入只读 plan 模式？批准计划前会禁用写入和修改。";

/**
 * The consent sentence to ask with: the full one at the terminal, the short one in
 * the chat's language for a turn answered on a phone, where the read-only summary
 * would fill a bubble on its own. Both askers read it here, so `plan` and `goal`
 * ask the same question one way.
 */
export function planConsent(ctx: UIContextCarrier): string {
	if (!isRemoteTurn(ctx)) return PLAN_CONSENT;
	return dialogLanguage(ctx) === "zh" ? PLAN_CONSENT_SHORT_ZH : PLAN_CONSENT_SHORT;
}

/**
 * The refusal a command shows when the session's mode forbids what it does.
 *
 * Every extension whose command changes something says so the same way and names
 * the action it is not doing, with the hatch that would let it: plan mode asks for
 * the approval, lead mode asks the session to step out of the seat. One sentence
 * in `lib/`, because a copy per caller is how the guarantee stops reading as one
 * guarantee.
 */
export function modeRefusal(mode: LeashedMode, action: string): string {
	return mode === "lead"
		? `Lead mode holds the seat: \`/board exit\` before ${action}.`
		: `Plan mode is read-only. Approve the plan before ${action}.`;
}

/** What a caller sends on {@link PLAN_ENTER_REQUEST} or {@link PLAN_TOGGLE_REQUEST}. */
export interface PlanModeRequest {
	/** The caller's context; `plan` uses it for the footer status. */
	ctx: ExtensionContext;
	/** Claimed once, with whether plan mode is on; the caller settles on that claim. */
	respond(enabled: BusAnswer<boolean>): void;
}

/**
 * Whether the `plan` extension registered its tool in this session.
 */
export function isPlanExtensionLoaded(pi: Pick<ExtensionAPI, "getAllTools">): boolean {
	return pi.getAllTools().some((tool) => tool.name === PLAN_TOOL);
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
 * Ask `plan` to turn the mode off, and report whether it is off.
 *
 * Idempotent, unlike the toggle: a caller that is about to enter another mode
 * needs "plan is not on" rather than "the flip landed", and a session already out
 * of plan mode resolves `true` without a listener doing anything. `false` means
 * nothing answered — the `plan` extension is not loaded, so there is no plan mode
 * to leave.
 */
export function requestPlanLeave(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (!isPlanExtensionLoaded(pi)) return Promise.resolve(false);
	return requestOverBus<boolean, PlanModeRequest>(pi, {
		channel: PLAN_LEAVE_REQUEST,
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
