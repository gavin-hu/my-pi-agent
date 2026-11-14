/**
 * The shapes `team` registers and reports.
 *
 * A `team` result is usually one card plus what happened to the handoff, so the details
 * say both: `assigned` is who the card went to, `delivered` is the labels the bus wrote
 * a message file for, and `messageError` is the send that never landed — a card is
 * never left in a state the report does not describe. `ask` is the one verb with no
 * card: it reports the same two send facts and nothing else.
 *
 * The prompt text lives here for the reason `board`'s action docs do: `test/prompt-budget.test.ts`
 * measures the registered surface, so the words are exported where a test can reach them, and the
 * description is the only place a verb's behaviour is written down.
 *
 * Only the verbs that send mail are here. A card's own state — the claim that takes one, the reclaim
 * that gives one back, the plan, the two signs — is `board`'s: it is one store operation with one
 * sentence and one result line there, and this tool offering it a second time is what #581 removed.
 */

import type { Card } from "../../lib/board/card.ts";
import type { CardOwner } from "../../lib/board/card.ts";
import { LEAD_ROUND } from "../../lib/board/round-text.ts";
import type { DeliveryFailure } from "../../lib/session-tool.ts";

/** The tool's name. `board` owns the cards; `team` owns the round. */
export const TEAM_TOOL = "team";

/** The three actions that reach another session: hand a card out, offer one, ask a question. */
export const TEAM_ACTIONS = ["assign", "offer", "ask"] as const;

/** One action. */
export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** What a round is, and what each of its three verbs does. */
export const TEAM_DESCRIPTION =
	"Run a round of work over the shared board: `assign` sends a running session a handoff and then records the owner " +
	"(`to` is a teammate's label or id, as `/team` lists them); `offer` broadcasts an unclaimed card to every other " +
	"live session, then records the moment it was made — the lane and the owner stay put — so the first to claim " +
	"it takes it, and a lead can tell an offer nobody took from a card nobody has looked at; `ask` sends one peer a " +
	"question and reports what the bus did with it — delivered, or waiting for that peer's next turn — so the answer " +
	"arrives as mail and nothing waits on it. Nothing here starts a peer's turn: a message waits in its inbox, and a " +
	"peer that is listening reports it at its next turn. A card's own state — its lane, its plan, its two signs — is " +
	"`board`'s.";

/** The one line in the system prompt's tool list. */
export const TEAM_SNIPPET =
	"Run a round over the board: assign a card to a running session, offer one, or ask one peer a question.";

/** The round's habits, `team.lead`'s duty with `LEAD_ROUND`, and the `board` verbs a lead still reaches for. */
export const TEAM_GUIDELINES = [
	"Offer a card nobody has taken; assign one you mean a particular peer to hold; take one yourself with " +
		"`board` action `claim`, then plan and record it.",
	// The lead's duty and the round's own line, both from `LEAD_ROUND`: `/team`'s description says the
	// same sentence, so the two doors onto the round cannot name it differently. It is also the only
	// always-on sentence naming `team.lead`: `board`'s `approve` doc carried the key until this one
	// took it, and two statements of who signs is how a gate drifts from its config.
	`${LEAD_ROUND} If you are \`team.lead\`, it is yours: read it with \`board\` list \`round\`, then sign ` +
		"`approve` and `review`.",
	"Ask a peer with `ask` when a card cannot answer the question — the round says what a session holds, not how " +
		"the work is going — and read the inbox before asking again.",
	"When a result says `Not listening`, say so: the message waits for that peer's next turn.",
	"Reclaim a card whose owner stopped with `board` rather than editing someone else's work.",
];

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
	/**
	 * The peers the message reached whose record has aged out: the file is in the inbox, and nothing
	 * says the session is still there to read it.
	 */
	quiet?: string[];
	/** The peers no message file could be written for, when the send reached somebody else. */
	failed?: DeliveryFailure[];
	/**
	 * The id this `ask` minted, so the caller can match an answer to it.
	 *
	 * The only record of an ask: the message text carries the same string, and a reply that opens with
	 * `re: <id>` is what pairs the two. Present on `ask` alone.
	 */
	askId?: string;
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
	ask: ["to", "question"],
};

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeTeamAction(raw: unknown): TeamAction | undefined {
	return typeof raw === "string" && TEAM_ACTIONS.includes(raw as TeamAction) ? (raw as TeamAction) : undefined;
}
