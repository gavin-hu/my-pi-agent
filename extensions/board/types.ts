/**
 * The shapes the `board` tool registers and reports.
 *
 * `details` is the result's state: the card an action produced, the cards a list
 * read, the rollup when it was asked for, and — on a refusal — the card as it was,
 * so a retry starts from the truth rather than from what the model thought it
 * knew. The renderer and the tool share these types, and nothing else.
 */

import type { Card } from "../../lib/board/card.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { RoundSummary } from "../../lib/board/round.ts";

/** The tool's name. One extension registers it, so it stays here. */
export const BOARD_TOOL = "board";

/** The actions the tool accepts, in the order the description lists them. */
export const BOARD_ACTIONS = [
	"list",
	"add",
	"claim",
	"release",
	"reclaim",
	"move",
	"note",
	"plan",
	"edit",
	"drop",
] as const;

/** One action. */
export type BoardAction = (typeof BOARD_ACTIONS)[number];

/** A result the transcript renders and the page's routes mirror. */
export interface BoardDetails {
	action: BoardAction;
	/** The serving session: the id Pi knows, and the label a card records. */
	me: Actor;
	/** The board a `list` read, in lane order. */
	cards?: Card[];
	/** The card an action produced, or the one a refusal left untouched. */
	card?: Card;
	/** The lead's rollup, only for `list` with `round`. */
	round?: RoundSummary;
	/** The id a `drop` removed. */
	dropped?: string;
	/** A refusal's reason, which the renderer draws instead of the details. */
	error?: string;
}

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeBoardAction(raw: unknown): BoardAction | undefined {
	return typeof raw === "string" && BOARD_ACTIONS.includes(raw as BoardAction) ? (raw as BoardAction) : undefined;
}
