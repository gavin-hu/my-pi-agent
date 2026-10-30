/**
 * Fixture for the session-bus suites.
 *
 * A listing is read two ways — the model's `formatStatus` text and the `/sessions`
 * screen — so both suites build it from here, where the session id and label are the
 * same in each. Value-only: every call returns a fresh record.
 */

import type { RosterState } from "../../../lib/session-roster.ts";
import type { ClaimRecord, SessionRecord, SessionStatus } from "../../../extensions/session-bus/types.ts";

/** A listed session, as the roster hands it over. */
export type ListedSession = SessionRecord & { unread: number; state: RosterState };

/** The status a listing is formatted from: this session on the bus, with no claims by default. */
export function busStatus(sessions: ListedSession[], claims: ClaimRecord[] = []): SessionStatus {
	return { me: { id: "abcdef123456", label: "frontend" }, onBus: true, sessions, claims };
}
