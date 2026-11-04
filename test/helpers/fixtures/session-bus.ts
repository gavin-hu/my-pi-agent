/**
 * Fixture for the session-bus suites.
 *
 * A listing is read two ways — the model's `formatStatus` text and the `/sessions`
 * screen — so both suites build it from here, where the session id and label are the
 * same in each. Value-only: every call returns a fresh record.
 */

import type { RosterState } from "../../../lib/session-roster.ts";
import type { BusMessage, ClaimRecord, SessionRecord, SessionStatus } from "../../../extensions/session-bus/types.ts";

/** A listed session, as the roster hands it over. */
export type ListedSession = SessionRecord & { unread: number; state: RosterState };

/** The status a listing is formatted from: this session on the bus, with no claims by default. */
export function busStatus(sessions: ListedSession[], claims: ClaimRecord[] = []): SessionStatus {
	return { me: { id: "abcdef123456", label: "frontend" }, onBus: true, sessions, claims };
}

/** One listed session, live unless overridden. */
export function busSession(overrides: Partial<ListedSession> = {}): ListedSession {
	return {
		id: "abcdef123456",
		label: "frontend",
		pid: 1,
		cwd: "/repo/frontend",
		repoRoot: "/repo",
		mode: "tui",
		startedAt: 1_000,
		lastSeen: 10_000,
		unread: 0,
		state: "live",
		...overrides,
	};
}

/** One claim, held by a peer unless overridden. */
export function busClaim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
	return { path: "src/api", owner: "fedcba654321", ownerLabel: "backend", at: 9_000, ...overrides };
}

/** One inbox message, from a peer unless overridden. */
export function busMessage(overrides: Partial<BusMessage> = {}): BusMessage {
	return {
		id: "1-a",
		from: "fedcba654321",
		fromLabel: "backend",
		to: "abcdef123456",
		toLabel: "frontend",
		kind: "message",
		text: "is checkout.ts free?",
		at: 9_500,
		...overrides,
	};
}

/** The board the two transcript suites draw from: this session and two peers, two claims. */
export function busBoard(): SessionStatus {
	return busStatus(
		[
			busSession({ label: "verify-billing", id: "aaa111", mode: "rpc" }),
			busSession({ label: "backend", id: "fedcba654321", unread: 3 }),
			busSession({ label: "frontend", id: "abcdef123456" }),
		],
		[busClaim({ path: "src/api/routes.ts" }), busClaim({ path: "src/api" })],
	);
}
