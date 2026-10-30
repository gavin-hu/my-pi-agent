/**
 * The seat: the name the page serves as, and the actor it is shown as.
 *
 * A page outlives the session that opened it — a `/resume`, a rename, or a fresh
 * session taking the page over would otherwise change who the page says it is. So the
 * page is a *seat* rather than a session: one fixed name, one fixed id derived from it,
 * and the same identity however many sessions have served it.
 *
 * The page writes nothing, so the id decides no ownership: it is what the page's own
 * roster and the `you` chip are read against, and it keeps a page's reads the same
 * across a handover. The board's tools write as the session — which is why the label is
 * shared with the session serving the page and the ids are not.
 */

import type { Actor } from "./rules.ts";
import { normalizeLabel } from "../session-label.ts";

/** The name a repository's page always serves under, so the lead is a role and not a session. */
export const DEFAULT_SEAT = "team-lead";

/** The prefix of a page's actor id, so one is never mistaken for a session id. */
export const SEAT_ID_PREFIX = "board:";

/** The actor a page reads as: the seat, and an id derived from it. */
export function pageActor(label: string = DEFAULT_SEAT): Actor {
	const seat = normalizeLabel(label, DEFAULT_SEAT);
	return { id: `${SEAT_ID_PREFIX}${seat.toLowerCase()}`, label: seat };
}
