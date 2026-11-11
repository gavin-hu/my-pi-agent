/**
 * The addressee of a sign: which live session a card's owner names, and whether it is listening.
 *
 * The rules are the bus's own order of resolution, so a suite proves the two places this one
 * differs from `resolveRecipients`: a record whose process is gone is skipped, and an ambiguity
 * falls back to the card so the bus says it rather than the board guessing.
 */

import { describe, expect, test } from "bun:test";
import type { RosterSession } from "../../lib/session-roster.ts";
import { recipientOf } from "./recipient.ts";

const NOW = 1_000;

/** One record, as the bus writes it: a fresh heartbeat unless the case says otherwise. */
function session(id: string, label: string, extra: Partial<RosterSession> = {}): RosterSession {
	return { id, label, mode: "tui", lastSeen: NOW, mail: 0, ...extra };
}

describe("the peer a card's owner names", () => {
	test("is the record with that id, under the name that record holds", () => {
		// The card's label is stale and the session was renamed: the record wins, because it is the
		// name peers resolve now rather than the one the claim wrote down.
		const roster = [session("s-b", "api-core"), session("s-a", "billing-renamed")];
		expect(recipientOf({ id: "s-a", label: "billing-core" }, roster, NOW)).toEqual({
			to: "s-a",
			label: "billing-renamed",
			state: "live",
		});
	});

	test("is found by its label when the card's id names nobody", () => {
		// The session that claimed the card ended and a later one took the label; the id on the card
		// addresses nothing, and the bus refuses an unknown id rather than trying the name.
		const roster = [session("s-new", "api-core")];
		expect(recipientOf({ id: "s-gone", label: "api-core" }, roster, NOW)).toEqual({
			to: "s-new",
			label: "api-core",
			state: "live",
		});
	});

	test("skips a record whose process is gone, whatever it is called", () => {
		// A dead process is not a recipient: the bus filters it too, and picking it here would report
		// a peer that no longer exists instead of the live session that holds the name. The pid is one
		// no process can have, the seam `lib/board/session.test.ts` uses for the same fact.
		const roster = [session("s-dead", "api-core", { pid: 999_999_999 }), session("s-live", "api-core")];
		expect(recipientOf({ id: "s-dead", label: "api-core" }, roster, NOW)).toEqual({
			to: "s-live",
			label: "api-core",
			state: "live",
		});
	});

	test("carries whether that peer is listening", () => {
		const silent = recipientOf(
			{ id: "s-a", label: "api-core" },
			[session("s-a", "api-core", { watching: { armed: false, wake: false } })],
			NOW,
		);
		expect(silent.listening).toBe(false);
		// A record written before the field existed says nothing, which is not "not listening".
		expect(recipientOf({ id: "s-a", label: "api-core" }, [session("s-a", "api-core")], NOW).listening).toBeUndefined();
	});
});

describe("when the roster cannot answer", () => {
	test("keeps the card's own word", () => {
		// No bus is not "nobody is here": the send is still made, and the bus's answer is the fact.
		expect(recipientOf({ id: "s-a", label: "api-core" }, undefined, NOW)).toEqual({ to: "s-a", label: "api-core" });
		expect(recipientOf({ label: "api-core" }, [], NOW)).toEqual({ to: "api-core", label: "api-core" });
	});

	test("leaves a shared label to the bus, which names the ambiguity", () => {
		// Two live sessions on one label is the case the bus refuses with a sentence that says so;
		// guessing one here would send a sign to whichever record happened to sort first.
		const shared = [session("s-1", "api-core"), session("s-2", "api-core")];
		expect(recipientOf({ label: "api-core" }, shared, NOW)).toEqual({ to: "api-core", label: "api-core" });
	});

	test("keeps a quiet session, which is still a recipient, and says that it is quiet", () => {
		// A heartbeat ages out long before a session stops, so the bus still writes its mail — and the
		// result has to carry the fact, because "told api-core" for a record that aged out reads as a
		// session that heard, which is exactly what nobody knows.
		const quiet = [session("s-a", "api-core", { lastSeen: NOW - 60 * 60_000 })];
		expect(recipientOf({ id: "s-a", label: "api-core" }, quiet, NOW)).toMatchObject({ to: "s-a", state: "quiet" });
	});
});
