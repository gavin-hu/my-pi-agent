/**
 * Addressing a peer: which record a name reaches, and what that record says about reading mail.
 *
 * The second capability of `lib/session-roster.ts`, and its own suite for the reason the module is
 * one file: the record's *liveness* is read there, and the *rule* that turns a name into a record is
 * answered here. Both extensions address by it — a sign's `recipientOf` and the round's `actorFor` —
 * so a case that would have been written twice is written once, and the two callers' differing
 * fallbacks are each their own suite's business.
 *
 * Rows are built two ways on purpose: `rosterSession` is what the roster reader produces, and `row`
 * is what the `session status` payload spells — the same fields, read from the other place, which is
 * why one type describes both.
 */

import { describe, expect, test } from "bun:test";
import { rosterSession } from "../test/helpers/fixtures/session-roster.ts";
import { ALARM_REASON, type PeerRow, peerAlarm, peerNamed, peerOf, peerRowOf } from "./session-roster.ts";

const NOW = 1_000_000_000;

/** One record as the `session status` payload spells it, which is the other way a row is read. */
function row(id: string, label: string, extra: Partial<PeerRow> = {}): PeerRow {
	return { id, label, ...extra };
}

describe("peerRowOf", () => {
	test("carries the record's liveness and the watch it says it has", () => {
		const live = rosterSession(NOW, "s-core", "billing-core", { watching: { armed: false, wake: false } });
		expect(peerRowOf(live, NOW)).toEqual({
			id: "s-core",
			label: "billing-core",
			state: "live",
			listening: false,
		});
	});

	test("leaves listening unsaid when the record does not say, which is not a no", () => {
		// A record written before the field existed is not a session ignoring its mail.
		expect(peerRowOf(rosterSession(NOW, "s-core", "billing-core"), NOW)).toEqual({
			id: "s-core",
			label: "billing-core",
			state: "live",
		});
	});
});

describe("peerOf", () => {
	test("a live id is that session, whatever the label the card kept says", () => {
		// The card's label is stale and the session was renamed: the record is the name peers resolve.
		const rows = [row("s-a", "billing-renamed", { state: "live" }), row("s-b", "api-core", { state: "live" })];
		expect(peerOf(rows, { id: "s-a", label: "billing-core" })).toEqual({
			id: "s-a",
			label: "billing-renamed",
			state: "live",
		});
	});

	test("a quiet id is still the session it names, and says so", () => {
		// A heartbeat ages out long before a session stops, and the bus still writes its mail — so the
		// record the id names is the answer, with the fact that nobody is known to be there.
		const rows = [row("s-a", "api-core", { state: "quiet" })];
		expect(peerOf(rows, { id: "s-a", label: "api-core" })).toEqual({
			id: "s-a",
			label: "api-core",
			state: "quiet",
		});
	});

	test("a stopped id finds a live session under its label, and itself when there is none", () => {
		// The session that claimed the card ended and a later one took the name. A dead process is not
		// an addressee, so the label is tried next — the bus resolves it the same way.
		const moved = [row("s-dead", "api-core", { state: "gone" }), row("s-live", "api-core", { state: "live" })];
		expect(peerOf(moved, { id: "s-dead", label: "api-core" })?.id).toBe("s-live");
		// With nobody live under the label the stopped record is the answer, not nothing: a caller that
		// names a session gets that session, and a caller that writes mail refuses it by its state.
		const alone = [row("s-dead", "api-core", { state: "gone" })];
		expect(peerOf(alone, { id: "s-dead", label: "api-core" })).toEqual({
			id: "s-dead",
			label: "api-core",
			state: "gone",
		});
	});

	test("a label names the one session it holds, and nothing when two share it", () => {
		// Two live sessions on one label is the bus's ambiguity to name; guessing one here would send
		// a sign to whichever record happened to sort first.
		const rows = [row("s-new", "api-core", { state: "live" })];
		expect(peerOf(rows, { id: "s-gone", label: "api-core" })?.id).toBe("s-new");
		const shared = [row("s-1", "api-core", { state: "live" }), row("s-2", "API-core", { state: "live" })];
		expect(peerOf(shared, { label: "api-core" })).toBeUndefined();
	});

	test("a record whose state cannot be told is not a record that stopped", () => {
		// Absent is the question rather than the answer, and a caller may still address the name.
		expect(peerOf([row("s-a", "api-core")], { id: "s-a", label: "api-core" })?.id).toBe("s-a");
	});

	test("answers nothing for a roster that cannot be read, and for a name it does not hold", () => {
		// No bus is not an empty team: the caller's own fallback is the answer, and it words it itself.
		expect(peerOf(undefined, { label: "api-core" })).toBeUndefined();
		expect(peerOf([], { label: "api-core" })).toBeUndefined();
		expect(peerOf([row("s-a", "api-core", { state: "live" })], { label: "ops-helper" })).toBeUndefined();
	});
});

describe("peerNamed", () => {
	test("takes a name a person typed as an id and as a label", () => {
		const rows = [row("s-core", "billing-core", { state: "live" }), row("s-web", "billing-web", { state: "live" })];
		expect(peerNamed(rows, "s-core")?.label).toBe("billing-core");
		expect(peerNamed(rows, " BILLING-WEB ")?.id).toBe("s-web");
		expect(peerNamed(rows, "nobody")).toBeUndefined();
		expect(peerNamed(undefined, "billing-core")).toBeUndefined();
	});
});

describe("peerAlarm", () => {
	test("a quiet record outranks the watch it still carries", () => {
		// One peer, one sentence, the louder of the two: a watch on a record that may be dead is the
		// weaker fact, so a quiet peer that also says it is not listening reads as quiet.
		expect(peerAlarm({ state: "quiet", listening: false })).toBe("quiet");
		expect(peerAlarm({ state: "quiet", listening: true })).toBe("quiet");
	});

	test("a live record that says it is not listening is the other alarm", () => {
		expect(peerAlarm({ state: "live", listening: false })).toBe("not-listening");
	});

	test("says nothing when the record does not, and nothing for a session that stopped", () => {
		// An absent field is not an accusation, and a stopped record is not a recipient at all: both
		// sentences promise the mail will be read later, which a process that is gone does not.
		expect(peerAlarm({ state: "live" })).toBeUndefined();
		expect(peerAlarm({ state: "live", listening: true })).toBeUndefined();
		expect(peerAlarm({ state: "gone", listening: false })).toBeUndefined();
	});

	test("every alarm has its one sentence", () => {
		expect(ALARM_REASON.quiet).toBe("nothing says it is still there");
		expect(ALARM_REASON["not-listening"]).toBe("it reads this at its next turn");
	});
});
