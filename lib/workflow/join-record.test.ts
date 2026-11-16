/**
 * What the bus record says about its watch, and what a door asks for it.
 *
 * `joinTeam` asks only while the record cannot answer for itself, so the answer is a state the
 * record names: armed with wake, armed without it, disarmed by the user, another pane's own, or
 * nothing at all — a record written before the field existed. Each case here seeds the bus's file
 * and reads what the door asked, where `join.test.ts` holds the door's other decisions (the
 * standing, the roster, liveness, the sentences a refusal prints) and the fixture both suites seed
 * is `test/helpers/join-fixture.ts`.
 *
 * The suite is split from `join.test.ts` because that one is at the size bar: a record state is a
 * capability of its own, and a case that needs room for one belongs beside the states, not at the
 * end of a file measured as a whole.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { ID, LABEL, NOW, joinHarness, joinedStanding, liveRecord } from "../../test/helpers/join-fixture.ts";
import { joinTeam } from "./join.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the record's watch", () => {
	test("keeps a record this process wrote, which is this pane's own watch", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			pid: process.pid,
			watching: { armed: false, wake: false },
		});
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: false });
		expect(asked).toEqual([]);
	});

	test("upgrades an armed watch that cannot wake this session", async () => {
		// Armed but not woken is the one watch a team door repairs: a teammate that hears mail
		// and is never woken for it is a teammate that still needs a human turn.
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: joinedStanding({ armed: true, wake: false }),
		});
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			pid: process.pid,
			watching: { armed: true, wake: false },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("leaves an armed watch that already wakes alone", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: joinedStanding({ armed: true, wake: true }),
		});
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			pid: process.pid,
			watching: { armed: true, wake: true },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks when the live record is another process's, which a second pane writes", async () => {
		// Two panes share one session id: the other pane's record carries its pid, so the label is
		// right and the watch is not this pane's. A record whose process is gone never reaches
		// here, because the roster already reads it as `gone`.
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, pid: process.ppid });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("a live record under the name answers a failed standing, which needs no repair", async () => {
		// The bus already holds this session: a request whose answer was lost is not a reason to
		// ask again, and the record's watch is what the line repeats.
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: { ok: false, error: "the request was lost" },
		});
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			watching: { armed: false, wake: false },
		});
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: false });
		expect(asked).toEqual([]);
	});

	test("skips without a standing when the record already holds the name", async () => {
		// A session joined through `/session join` or the `/sessions` board never asked a board
		// door, so there is no standing — but the bus's record is still the fact.
		const { session, team, ctx, asked, busDir } = joinHarness(temps);
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			watching: { armed: false, wake: false },
		});
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: false });
		expect(asked).toEqual([]);
	});

	test("a rename repeats the disarmed watch the record names, not the standing's silence", async () => {
		// The watch was turned off through the bus, which this process never recorded; the record
		// is the only word that the seat's rename must repeat it disarmed.
		const { session, team, ctx, asked, busDir } = joinHarness(temps);
		writeBusRecord(busDir, {
			id: ID,
			label: "core-claims",
			lastSeen: NOW,
			watching: { armed: false, wake: false },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("a rename keeps the wake the record names", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps);
		writeBusRecord(busDir, {
			id: ID,
			label: "core-claims",
			lastSeen: NOW,
			watching: { armed: true, wake: true },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("a live record that is not listening is the user's choice, not something to repair", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
		});
		writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			watching: { armed: false, wake: false },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks for the wake a record written before the field cannot promise", async () => {
		// The boot write lands before any join writes `watching`, so an absent field is "no answer
		// yet" rather than the user's `listen: false`: a door that read it as the opt-out asked for
		// nothing, and the session sat armed without wake until a human turn came.
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		liveRecord(busDir);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("a field-less record with a disarmed standing repeats the disarmed join", async () => {
		// The boundary the fix must not cross: no record to read, so the standing is the only word
		// that mail was turned off, and asking again cannot arm what the user turned off.
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
		});
		liveRecord(busDir);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});
});
