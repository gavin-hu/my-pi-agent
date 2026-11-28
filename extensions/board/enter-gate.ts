/**
 * Whether this session may start planning: one question, asked of the cards it holds.
 *
 * The workflow is claim, plan, contract, sign, execute — and the lane gate that enforces the
 * rest cannot see the first step. Its leash is a card this session holds, and `card.ts` keeps a
 * card in the pool ownerless, so `heldCards` never returns one and a session that opened plan
 * mode before it claimed wrote a plan no card could record: the approval seeded steps for work
 * the board never saw, the contract refused until a claim, and the claim could refuse on a full
 * `plan` lane. This is that step's gate.
 *
 * What it deliberately does not gate: `/plan` and Shift+Tab, which are the person's own doors and
 * never raise a `tool_call` at all; `goal`'s plan route, which plans an objective rather than a
 * card; and plan mode outside a board, which is not this board's business. The model's `plan`
 * `enter` is the door here, and the wiring decides *whether* to ask — a session the board does
 * not speak for is not gated, because the board must never brick work that is not its own.
 *
 * Value-only: the held set is a caller's, and the sentence is the whole output.
 */

import type { Card } from "../../lib/workflow/card.ts";

/**
 * How the sentence offers the way out, which depends on what the build has.
 *
 * `team` is a session on a bus, where leaving the team is a door. `solo` is the board with no bus
 * loaded: there is no team to leave, and the only door is a card of its own.
 */
export type EnterHatch = "team" | "solo";

/** The clause both hatches open with, so they cannot drift about what the claim is for. */
const CLAIM =
	"claim one (`board claim <id>`, and `board list` shows the pool) so the plan has a card to record it against";

/** What each build can offer instead of a claim. */
const HATCH: Record<EnterHatch, string> = {
	team: "`board add` opens one, or `/team exit` plans without the board",
	solo: "`board add` opens one",
};

/**
 * Why this session may not enter plan mode, or `undefined` when a card of its own is held.
 *
 * `held` is `heldCards`' answer, which is the cards this session holds and not `done` — and never
 * a card in the pool. So there is no filter here: the shape of the set is the caller's one rule,
 * and a second reading of it would be a second answer to "which cards are mine".
 */
export function planEntryRefusal(held: readonly Card[], hatch: EnterHatch): string | undefined {
	if (held.length > 0) return undefined;
	return `board: plan mode needs a card you hold — ${CLAIM}; ${HATCH[hatch]}.`;
}
