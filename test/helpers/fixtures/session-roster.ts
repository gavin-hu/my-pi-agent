/**
 * A roster record: one session as `lib/session-roster.ts` reads it off the bus.
 *
 * Two suites need one — the roster's own, and the board's addressee — and the copies had already
 * agreed on the wrong thing to duplicate: which fields a *fresh* record carries is a fact about the
 * liveness rule, not about either suite, so it lives here. `now` is the caller's clock rather than a
 * constant, because "fresh" is only a fact about two numbers.
 *
 * Value-only: every call returns a fresh object, so no two tests share one.
 */

import type { RosterSession } from "../../../lib/session-roster.ts";

/** One session record, live at `now` unless the case says otherwise. */
export function rosterSession(
	now: number,
	id: string,
	label: string,
	overrides: Partial<RosterSession> = {},
): RosterSession {
	return { id, label, mode: "tui", lastSeen: now, mail: 0, ...overrides };
}
