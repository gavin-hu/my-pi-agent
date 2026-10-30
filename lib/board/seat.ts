/**
 * The seat: the name the page serves as, and the actor it is shown as.
 *
 * A page outlives the session that opened it — a `/resume`, a rename, or a fresh session
 * taking the page over would otherwise change who the page says it is. So the page is a *seat*
 * rather than a session: one name for its whole life, one id derived from it, and the same
 * identity however many sessions have served it.
 *
 * That name is `board.lead` — the lead's team name, read by `config.ts` — because the two
 * questions have one answer: the page belongs to the lead, and serving it is how a session
 * *becomes* the lead (the seat outranks the session's own name while it serves, so the gate
 * accepts it). There is no built-in seat name here: a name in this module would be a second
 * answer to a question the config already answers.
 *
 * The page writes nothing, so the id decides no ownership: it is what the page's own roster and
 * the `you` chip are read against, and it keeps a page's reads the same across a handover. The
 * board's tools write as the session — which is why the label is shared with the session
 * serving the page and the ids are not.
 */

import type { Lead } from "./lead.ts";
import type { Actor } from "./rules.ts";

/** The prefix of a page's actor id, so one is never mistaken for a session id. */
export const SEAT_ID_PREFIX = "board:";

/**
 * The actor a page reads as: the lead's name, and an id derived from it.
 *
 * The name arrives already normalized: `board.lead` passes `normalizeLabel` on its way out of
 * `config.ts`, so this only derives the id — one rule for a label, in one place.
 */
export function pageActor(lead: Lead): Actor {
	return { id: `${SEAT_ID_PREFIX}${lead.toLowerCase()}`, label: lead };
}
