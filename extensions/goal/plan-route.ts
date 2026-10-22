/**
 * The planning phase of a goal (host).
 *
 * A goal is recorded either as a draft to be designed (`planning`) or as a final
 * objective (`active`). The phase is decided in exactly one place, so the tool,
 * the command, and the plan-mode entry cannot disagree:
 *
 * - a goal that is already pursued keeps its phase, so refining one never re-asks;
 * - while plan mode is on, a new goal is a draft being designed;
 * - otherwise the user is asked once, and a yes enables plan mode through the
 *   shared request channel (which never asks a second time).
 *
 * An explicit `status` from a `goal` call never reaches this module: the caller
 * decided, and that is how `plan` finalizes a draft at approval.
 *
 * `ask: false` is for the commands that record a goal without starting a run:
 * there is no work to plan yet, so the phase is not theirs to decide.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isPursuedGoal } from "../../lib/goal-state.ts";
import { isRemoteTurn, remoteLanguage } from "../../lib/interaction.ts";
import { PLAN_CONSENT, PLAN_CONSENT_SHORT, PLAN_CONSENT_SHORT_ZH, requestPlanMode } from "../../lib/plan-entry.ts";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { PLAN_ENTER_TOOL } from "../../lib/tool-names.ts";
import type { Goal, GoalStatus } from "./types.ts";

/** Dialog title: the question the phase answers. */
export const PLAN_ASK = "Plan first?";

/**
 * The phase to record for a goal about to be written.
 *
 * `previous` is the goal before the write. Returns `planning` only when plan mode
 * is known to be on, so the stored phase can never claim a plan that was not
 * started; `active` is the safe answer everywhere else.
 */
export async function goalPhase(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
	previous: Goal | null,
	options: { ask: boolean },
): Promise<GoalStatus> {
	if (isPursuedGoal(previous)) return previous.status;
	if (isPlanModeEnabled(ctx.sessionManager.getBranch())) return "planning";
	if (!options.ask || !ctx.hasUI) return "active";
	// Do not ask about a phase this session cannot enter.
	if (!pi.getAllTools().some((tool) => tool.name === PLAN_ENTER_TOOL)) return "active";
	const consent = isRemoteTurn(ctx)
		? remoteLanguage(ctx) === "zh"
			? PLAN_CONSENT_SHORT_ZH
			: PLAN_CONSENT_SHORT
		: PLAN_CONSENT;
	const approved = await ctx.ui.confirm(PLAN_ASK, consent);
	if (!approved) return "active";
	return (await requestPlanMode(pi, ctx)) ? "planning" : "active";
}
