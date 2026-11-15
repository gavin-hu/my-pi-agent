/**
 * The one join: when a door asks, what it repeats when it asks again, and what a line reads.
 *
 * The rule is one sentence and three answers — ask while the standing says nothing good,
 * keep a standing the roster still backs under the name asked for, ask again while it does
 * not — and the cases here are its boundaries: the record that aged out, the process that is
 * gone, the host with no session id, the roster that will not read, and the record that holds
 * another name. The bus's files are real; the session's `roster` is the reader the round
 * already uses, so nothing here stubs the parse or the liveness rule.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { removeBusRecord, writeBusRecord } from "../../test/helpers/bus.ts";
import { type RosterSession, SESSION_TTL_MS, readRoster } from "../session-roster.ts";
import { type JoinResult, NO_BUS_ERROR, type TeamJoin, type TeamJoinInput } from "../session-tool.ts";
import type { TeamStanding } from "./session.ts";
import { joinFailureLine, joinTeam, type JoinSession, standingOf, teamStatus } from "./join.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 500_000;
const ID = "s-lead";
const LABEL = "billing-core";

/** What a case may vary about the session its claim joins as. */
interface JoinHarnessOptions {
	/** The standing the session already carries, or none when it has not asked yet. */
	record?: JoinResult;
	/** Make the join reject, so the swallow-and-record path is the one under test. */
	fails?: boolean;
	/** The sentence the bus refuses with, so the failure's own reading is the one under test. */
	refuses?: string;
	/** The roster the session reads; absence is the temp bus directory this harness writes. */
	roster?: () => Promise<RosterSession[] | undefined>;
}

/**
 * One session, one recorded join, and a bus directory in a temp root.
 *
 * The join answers `ok` and records nothing on the bus itself: a case that wants the record
 * a real join leaves writes it, which is the only way to say "the bus holds this session"
 * and "the bus does not" with the same caller.
 */
function harness(options: JoinHarnessOptions = {}) {
	let standing = options.record;
	const busDir = temps.track(tempDir("pi-bus-join-"));
	const asked: Array<TeamJoinInput | undefined> = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			asked.push(input);
			if (options.fails === true) throw new Error("the bus went away");
			if (options.refuses !== undefined) return { ok: false, error: options.refuses };
			return { ok: true, label: LABEL, watching: { armed: true, wake: false } };
		},
	};
	const session: JoinSession = {
		team: {
			last: () => standing,
			record: (result) => {
				standing = result;
			},
		} satisfies TeamStanding,
		roster: options.roster ?? (() => readRoster(busDir)),
		now: () => NOW,
	};
	const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: ID });
	return { session, team, ctx, asked, busDir, standing: () => standing };
}

/** The joined standing, as a case seeds it: on the team, and armed unless it says not. */
function joined(watching: { armed: boolean; wake: boolean } = { armed: true, wake: false }): JoinResult {
	return { ok: true, label: LABEL, watching };
}

/** One live record for this session, where the roster reads it. */
function recordLive(busDir: string, lastSeen = NOW): string {
	return writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen });
}

describe("joinTeam", () => {
	test("asks when this session has not asked yet, under the label the card was written as", async () => {
		const { session, team, ctx, asked } = harness();
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("keeps the standing while the roster still holds this session", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		recordLive(busDir);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks when the live record is another process's, which a second pane writes", async () => {
		// Two panes share one session id: the other pane's record carries its pid, so the label is
		// right and the watch is not this pane's. A record whose process is gone never reaches
		// here, because the roster already reads it as `gone`.
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, pid: process.ppid });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("keeps a record this process wrote, which is this pane's own watch", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
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

	test("asks again when the bus holds another name, which is what the page's seat does", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		// A session the bus holds live under the name it joined as, now serving the page as the
		// seat: the record is live but says another name, so the open renames it.
		recordLive(busDir);
		await joinTeam(session, team, ctx, "team-lead");
		expect(asked).toEqual([{ label: "team-lead" }]);
	});

	test("a rename repeats a disarmed join, so the page cannot turn mail back on", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined({ armed: false, wake: false }) });
		writeBusRecord(busDir, { id: ID, label: "core-claims", lastSeen: NOW });
		await joinTeam(session, team, ctx, "team-lead");
		expect(asked).toEqual([{ label: "team-lead", listen: false }]);
	});

	test("asks again when the bus stopped and took its record with it", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		const file = recordLive(busDir);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
		// A stop removes the record, and the standing is no evidence that peers resolve the
		// name any more: without this the next claim writes a card under a dead label.
		removeBusRecord(file);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again when the record aged out of the bus's TTL", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		recordLive(busDir, NOW - SESSION_TTL_MS - 1);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again when the only record is another session's", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		writeBusRecord(busDir, { id: "s-peer", label: "billing-web", lastSeen: NOW });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again after a failure, which a later attempt replaces", async () => {
		const { session, team, ctx, asked, standing } = harness({
			record: { ok: false, error: "the session bus is not loaded" },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
		expect(standing()?.ok).toBe(true);
	});

	test("a live record under the name answers a failed standing, which needs no repair", async () => {
		// The bus already holds this session: a request whose answer was lost is not a reason to
		// ask again, and the record's watch is what the line repeats.
		const { session, team, ctx, asked, busDir } = harness({
			record: { ok: false, error: "the request was lost" },
		});
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, watching: { armed: false, wake: false } });
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: false });
		expect(asked).toEqual([]);
	});

	test("skips without a standing when the record already holds the name", async () => {
		// A session joined through `/session join` or the `/sessions` board never asked a board
		// door, so there is no standing — but the bus's record is still the fact.
		const { session, team, ctx, asked, busDir } = harness();
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, watching: { armed: false, wake: false } });
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: false });
		expect(asked).toEqual([]);
	});

	test("a rename repeats the disarmed watch the record names, not the standing's silence", async () => {
		// The watch was turned off through the bus, which this process never recorded; the record
		// is the only word that the seat's rename must repeat it disarmed.
		const { session, team, ctx, asked, busDir } = harness();
		writeBusRecord(busDir, { id: ID, label: "core-claims", lastSeen: NOW, watching: { armed: false, wake: false } });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("a rename keeps the wake the record names", async () => {
		const { session, team, ctx, asked, busDir } = harness();
		writeBusRecord(busDir, { id: ID, label: "core-claims", lastSeen: NOW, watching: { armed: true, wake: true } });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("a live record that is not listening is the user's choice, not something to repair", async () => {
		const { session, team, ctx, asked, busDir } = harness({
			record: joined({ armed: false, wake: false }),
		});
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, watching: { armed: false, wake: false } });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("repeats a disarmed join, so asking again cannot arm mail the user turned off", async () => {
		const { session, team, ctx, asked } = harness({ record: joined({ armed: false, wake: false }) });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("repeats an armed watch with the wake it had", async () => {
		const { session, team, ctx, asked } = harness({ record: joined({ armed: true, wake: true }) });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("keeps the standing for a host that reports no session id, which has no record to look for", async () => {
		const { session, team, asked } = harness({ record: joined() });
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "" });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("keeps the standing, and the card, when the roster cannot be read", async () => {
		const { session, team, ctx, asked } = harness({
			record: joined(),
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		// The join runs after a card was written, so a bus that will not say is a sentence and
		// not a way to undo the claim it came after.
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("records a join that threw as a failure, the way it records a refused one", async () => {
		const { session, team, ctx, standing } = harness({ fails: true });
		await joinTeam(session, team, ctx, LABEL);
		expect(standing()).toEqual({ ok: false, error: "the bus went away" });
	});

	test("answers with the state a line reads, and records it", async () => {
		const { session, team, ctx, standing } = harness();
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: true });
		expect(standing()).toEqual(joined());
	});

	test("a refusal with no bus names the extension, because the door that renames refuses the same way", async () => {
		const { session, team, ctx } = harness({ refuses: NO_BUS_ERROR });
		// `/team join` is the answer to every other refusal, and here it is the answer to nothing:
		// there is no bus to ask, so the sentence names the switch instead of the verb.
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({
			error: NO_BUS_ERROR,
			fix: "Turn the `session-bus` extension on in `/bytefly`.",
		});
	});

	test("a name a running session holds says what frees it, and what renaming costs", async () => {
		const { session, team, ctx, busDir } = harness({
			refuses: `the label "${LABEL}" is already in use by session s-peer.`,
		});
		writeBusRecord(busDir, { id: "s-peer", label: LABEL, lastSeen: NOW });
		const state = await joinTeam(session, team, ctx, LABEL);
		// The bus says who holds the name and never what to do: only that session stopping frees
		// it, and the other way past it is the door that renames — which a lead pays for.
		expect("error" in state && state.fix).toContain("Only that session stopping frees the name");
		expect("error" in state && state.fix).toContain("a lead that renames loses its signature");
	});

	test("a name a dead record still holds comes back on its own", async () => {
		const { session, team, ctx, busDir } = harness({ refuses: `the label "${LABEL}" is held by session s-peer.` });
		// The bus reserves a name for the heartbeat's TTL, which is the window a stopped session
		// still holds: the record's process is gone, so waiting is a real answer.
		writeBusRecord(busDir, { id: "s-peer", label: LABEL, lastSeen: NOW, pid: 2 ** 22 + 7 });
		const state = await joinTeam(session, team, ctx, LABEL);
		expect("error" in state && state.fix).toContain("The bus forgets that record when its heartbeat ages out");
	});

	test("a reason the roster cannot place is reported with no advice grafted onto it", async () => {
		const { session, team, ctx } = harness({ refuses: "the request was lost" });
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ error: "the request was lost" });
	});
});

describe("joinFailureLine", () => {
	test("says nothing about a join that landed", () => {
		expect(joinFailureLine({ label: LABEL, listening: true })).toBeUndefined();
	});

	test("ends the bus's own clause so the fix reads as its own sentence", () => {
		// The bus writes both shapes — "the session bus is not loaded" and "…is already in use by
		// session s-peer." — and the line is one clause of a result either way.
		expect(joinFailureLine({ error: NO_BUS_ERROR })).toBe(`Not on the team: ${NO_BUS_ERROR}.`);
		expect(joinFailureLine({ error: "the request was lost." })).toBe("Not on the team: the request was lost.");
	});

	test("carries what the caller can do about it, when the join worked that out", () => {
		expect(joinFailureLine({ error: NO_BUS_ERROR, fix: "Turn it on." })).toBe(
			`Not on the team: ${NO_BUS_ERROR}. Turn it on.`,
		);
	});
});

describe("teamStatus", () => {
	test("reads the live record, so a disarm through the bus is not hidden by an old standing", async () => {
		// The standing says the join armed a watch; the record is what a `join({listen: false})`
		// rewrote afterwards, and the record is what a peer resolves.
		const { session, ctx, busDir } = harness({ record: joined({ armed: true, wake: false }) });
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, watching: { armed: false, wake: false } });
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL, listening: false });
	});

	test("does not repeat a join the bus no longer holds", async () => {
		// The record was pruned or the bus stopped: an ok standing is history, and a line that
		// repeated it would name a team no peer resolves.
		const { session, ctx } = harness({ record: joined() });
		expect(await teamStatus(session, ctx)).toBeUndefined();
	});

	test("keeps the standing when the roster cannot be read, which is no answer at all", async () => {
		const { session, ctx } = harness({
			record: joined({ armed: false, wake: false }),
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL, listening: false });
	});

	test("falls back to the standing's failure, which is the reason to report", async () => {
		const { session, ctx } = harness({ record: { ok: false, error: "the session bus is not loaded" } });
		expect(await teamStatus(session, ctx)).toEqual({ error: "the session bus is not loaded" });
	});

	test("says nothing when this session has neither asked nor been recorded", async () => {
		const { session, ctx } = harness();
		expect(await teamStatus(session, ctx)).toBeUndefined();
	});

	test("prints the name alone for a record from before the listening field", async () => {
		// `watching` absent is "the record does not say", not "not listening", and there is no
		// standing to fill it in: the line must not accuse a peer that may be listening.
		const { session, ctx, busDir } = harness();
		recordLive(busDir);
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL });
	});
});

describe("standingOf", () => {
	test("maps a refusal to the error clause, an absence to nothing", () => {
		expect(standingOf(undefined)).toBeUndefined();
		expect(standingOf({ ok: false, error: "no bus" })).toEqual({ error: "no bus" });
		expect(standingOf(joined())).toEqual({ label: LABEL, listening: true });
	});
});
