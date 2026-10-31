/**
 * The shapes `team` registers and reports.
 *
 * A `team` result is usually one card plus what happened to the handoff, so the details
 * say both: `assigned` is who the card went to, `delivered` is the labels the bus wrote
 * a message file for, and `messageError` is the send that never landed — a card is
 * never left in a state the report does not describe. `ask` is the one verb with no
 * card: it reports the same two send facts and nothing else.
 */

import type { Card } from "../../lib/board/card.ts";
import type { CardOwner } from "../../lib/board/card.ts";

/** The tool's name. `board` owns the cards; `team` owns the round. */
export const TEAM_TOOL = "team";

/**
 * The five actions: the lead's round — hand out, offer, take back, and take one itself —
 * and the question it can send one peer.
 */
export const TEAM_ACTIONS = ["assign", "offer", "reclaim", "claim", "ask"] as const;

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
	 * `assign` and `ask`, every other live session for `offer`.
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

/**
 * The fields each action acts on: what a call may carry, per action.
 *
 * The parameters are one flat object, so a field is published to every action at once,
 * and only this table stops one reaching an action that would drop it. `to` is `assign`'s
 * and `ask`'s: an `offer` that named a peer was broadcast to every live session instead, and a
 * `reclaim` that named one took the card back from whoever held it.
 *
 * A test holds the other direction — every published parameter but `action` is claimed
 * here — so a field cannot be published without an action that acts on it.
 */
export const ACTION_FIELDS: Record<TeamAction, readonly string[]> = {
	assign: ["card", "to", "note"],
	offer: ["card", "note"],
	reclaim: ["card"],
	claim: ["card"],
	ask: ["to", "question"],
};

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeTeamAction(raw: unknown): TeamAction | undefined {
	return typeof raw === "string" && TEAM_ACTIONS.includes(raw as TeamAction) ? (raw as TeamAction) : undefined;
}
