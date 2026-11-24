/**
 * The board tool: its registration, and the text a model reads.
 *
 * What a call *does* lives in `actions.ts` — the dispatch from an action to the store's write, and the
 * result it reports — so this module is the surface: the name, the schema, the description and the
 * guidelines the prompt budget measures, and the two transcript hooks `result.ts` owns.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deliver, TeamJoin } from "../../lib/session-tool.ts";
import { createTeamJoin } from "../../lib/session-tool.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import type { VerifyRun } from "../../lib/workflow/verify.ts";
import { runAction } from "./actions.ts";
import { renderBoardCall, renderBoardResult } from "./result.ts";
import { type BoardArgs, BoardParams } from "./schema.ts";
import { BOARD_ACTION_DOCS, BOARD_ACTIONS, BOARD_TOOL } from "./types.ts";

/** The verbs as one sentence, in `BOARD_ACTIONS` order; the table owns the words. */
function verbHelp(): string {
	return `${BOARD_ACTIONS.map((action) => `\`${action}\` ${BOARD_ACTION_DOCS[action]}`).join("; ")}.`;
}

/**
 * The tool's description: what the board is, and the actions it takes.
 *
 * Exported, with {@link BOARD_GUIDELINES}, so the surface budget in
 * `test/prompt-budget.test.ts` measures the text that is really registered instead of a
 * second copy of it. The actions are stated once, in `BOARD_ACTION_DOCS`.
 */
export const BOARD_DESCRIPTION =
	"The shared feature list for this repository: one card per feature, which any session reads and writes. " +
	`${verbHelp()} A card's steps do not belong on the board - they belong in the plan and in \`todo\`.`;

/**
 * The workflow itself: the order a card moves in, the lane count, and the handoff.
 *
 * No action doc can say the order, because each one owns a single verb — the gates are what a
 * session gets wrong on its own, and a checklist that stops at `execute` leaves `review` to a
 * paragraph a model reads only when it reaches `done`. Everything a fourth bullet used to say is
 * stated once by the field or the action it is about — a `blocked` card's resume is the
 * `blocker` parameter's sentence, `dependsOn`'s refusal is its own parameter's, "steps belong in
 * `todo`" closes the description, and "`paths` are hints, not claims" closes the `paths`
 * parameter. Repeating one here costs every request for nothing, which is what the ceiling in
 * `test/prompt-budget.test.ts` is for: one idea per bullet, and none of them already said.
 */
export const BOARD_GUIDELINES = [
	"Claim a card, design it in plan mode, record the contract, then `execute`: `approve` gates that, `review` gates `done`, and both signs are the lead's.",
	"Note each phase, and release or reclaim a card you stop holding, so the lane count means what it says.",
	"A `handoff` in your inbox is work you now own: read it with `session inbox`, record the plan, and start it.",
];

/** The one line in the system prompt's tool list: the actions, and nothing they do. */
export const BOARD_SNIPPET = `The shared feature list for this repository: ${BOARD_ACTIONS.join(", ")}.`;

export function registerTools(
	pi: ExtensionAPI,
	runtime: BoardSession,
	deps: { team?: TeamJoin; notify?: Deliver; verify?: VerifyRun } = {},
): void {
	// The team is resolved once, here, and travels into every call: a claim joins through the same
	// one, and a registration that resolved it per call would ask the bus again for each.
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerTool({
		name: BOARD_TOOL,
		label: "Board",
		description: BOARD_DESCRIPTION,
		promptSnippet: BOARD_SNIPPET,
		promptGuidelines: BOARD_GUIDELINES,
		parameters: BoardParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return runAction({ pi, runtime, ctx, deps: { ...deps, team }, args: params as BoardArgs });
		},
		renderCall: renderBoardCall,
		renderResult: renderBoardResult,
	});
}
