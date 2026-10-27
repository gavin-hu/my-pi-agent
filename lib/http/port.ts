/**
 * The per-session port band the loopback pages share.
 *
 * Two pages draw from it — `/board` and `/browse` — so a session's pages cluster where a
 * person's bookmarks already point. The band is one product decision, stated here once:
 * a number repeated in each extension's config is two chances to move one of them, and
 * nothing would notice until a bookmark landed outside the range.
 *
 * A pick is a guess, not a reservation. `serveLoopback` binds it and falls back to
 * whatever free port the OS gives, so a port another process holds costs a retry rather
 * than a start.
 */

import { randomInt } from "node:crypto";

/** Base of the per-session port range. */
export const PORT_BASE = 4780;

/** Number of ports in the per-session range. */
export const PORT_RANGE = 1000;

/** A random port in the per-session range `PORT_BASE`–`PORT_BASE + PORT_RANGE - 1`. */
export function randomPort(): number {
	return PORT_BASE + randomInt(PORT_RANGE);
}
