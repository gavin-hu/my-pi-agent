/**
 * The shapes `team` registers and reports.
 *
 * A `team` result is one card plus what happened to the handoff, so the details say
 * both: `assigned` is who the card went to, `delivered` is the labels the bus wrote
 * a message file for, and `messageError` is the send that never landed — a card is
 * never left in a state the report does not describe.
 */

import type { Card } from "../../lib/board/card.ts";
import type { CardOwner } from "../../lib/board/card.ts";

/** The tool's name. `board` owns the cards; `team` owns the round. */
export const TEAM_TOOL = "team";

/** The three actions: the lead's whole surface — hand out, offer, take back. */
export const TEAM_ACTIONS = ["assign", "offer", "reclaim"] as const;

/** One action. */
export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** What one call did. */
export interface TeamDetails {
	action: TeamAction;
	/** The card after the action, or the one a refusal left alone. */
	card?: Card;
	/** Who the card was assigned to, when the assignment happened. */
	assigned?: CardOwner;
	/**
	 * The labels a message file was written for, when the send landed: the one peer for
	 * `assign`, every other live session for `offer`.
	 */
	delivered?: string[];
	/**
	 * The peers the message reached whose record says they are not listening, so it waits
	 * for their next turn instead of being raised as one. Absent when every peer listens.
	 */
	notListening?: string[];
	/** Why the handoff was not sent; the card is untouched when this is set. */
	messageError?: string;
	/** A refusal's reason, which the renderer draws instead of the details. */
	error?: string;
}

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeTeamAction(raw: unknown): TeamAction | undefined {
	return typeof raw === "string" && TEAM_ACTIONS.includes(raw as TeamAction) ? (raw as TeamAction) : undefined;
}
