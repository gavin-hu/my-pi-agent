/**
 * Membership: who is on the team, and the tool list that follows from it.
 *
 * The join rule is one sentence and three answers — ask while the standing says nothing good,
 * keep a standing the roster still backs under the name asked for, ask again while it does
 * not — and the cases here are its boundaries: the record that aged out, the process that is
 * gone, the host with no session id, the roster that will not read, and the record that holds
 * another name. `onTeam` is the same roster read reduced to the one answer the doors and the
 * tool list need, and `createMemberTools` is that answer spent. What the record says about its
 * own watch is `join-record.test.ts`; the fixture both suites seed is `test/helpers/join-fixture.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { removeBusRecord, writeBusRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { ID, joinedStanding, joinHarness, LABEL, liveRecord, NOW } from "../../test/helpers/join-fixture.ts";
import { type RosterSession, SESSION_TTL_MS } from "../session-roster.ts";
import { NO_BUS_ERROR } from "../session-tool.ts";
import { startTokenOf } from "../spawn.ts";
import { createMemberTools, joinTeam, onTeam, standingOf, teamStatus } from "./join.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One live record as the roster seam hands it back, with the facts a case varies. */
function liveRow(extra: Partial<RosterSession>): RosterSession {
	return { id: ID, label: LABEL, mode: "tui", lastSeen: NOW, mail: 0, ...extra };
}

describe("joinTeam", () => {
	test("asks when this session has not asked yet, under the label the card was written as", async () => {
		const { session, team, ctx, asked } = joinHarness(temps);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("asks again when the bus holds another name, which is what the page's seat does", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		// A session the bus holds live under the name it joined as, now serving the page as the
		// seat: the record is live but says another name, so the open renames it.
		liveRecord(busDir);
		await joinTeam(session, team, ctx, "team-lead");
		expect(asked).toEqual([{ label: "team-lead", wake: true }]);
	});

	test("a rename repeats a disarmed join, so the page cannot turn mail back on", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
		});
		writeBusRecord(busDir, { id: ID, label: "core-claims", lastSeen: NOW });
		await joinTeam(session, team, ctx, "team-lead");
		expect(asked).toEqual([{ label: "team-lead", listen: false }]);
	});

	test("asks again when the bus stopped and took its record with it", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		// Armed and waking, so the first join has nothing to ask — the case is about the removal.
		const file = writeBusRecord(busDir, {
			id: ID,
			label: LABEL,
			lastSeen: NOW,
			watching: { armed: true, wake: true },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
		// A stop removes the record, and the standing is no evidence that peers resolve the
		// name any more: without this the next claim writes a card under a dead label.
		removeBusRecord(file);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("asks again when the record aged out of the bus's TTL", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		liveRecord(busDir, NOW - SESSION_TTL_MS - 1);
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("asks again when the only record is another session's", async () => {
		const { session, team, ctx, asked, busDir } = joinHarness(temps, { record: joinedStanding() });
		writeBusRecord(busDir, { id: "s-peer", label: "billing-web", lastSeen: NOW });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("asks again after a failure, which a later attempt replaces", async () => {
		const { session, team, ctx, asked, standing } = joinHarness(temps, {
			record: { ok: false, error: "the session bus is not loaded" },
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
		expect(standing()?.ok).toBe(true);
	});

	test("repeats a disarmed join, so asking again cannot arm mail the user turned off", async () => {
		const { session, team, ctx, asked } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("repeats an armed watch with the wake it had", async () => {
		const { session, team, ctx, asked } = joinHarness(temps, { record: joinedStanding({ armed: true, wake: true }) });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("keeps the standing for a host that reports no session id, which has no record to look for", async () => {
		const { session, team, asked } = joinHarness(temps, { record: joinedStanding() });
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "" });
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("spends the join when the roster cannot be read under the name asked for", async () => {
		// The door exists to make this session reachable, and a standing cannot promise the watch:
		// armed without wake is the state this join upgrades, and an unreadable roster is the one
		// case where asking cannot rename anything — the label is the one already asked for.
		const { session, team, ctx, asked } = joinHarness(temps, {
			record: joinedStanding({ armed: true, wake: false }),
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("repeats a disarmed standing as disarmed when the roster cannot be read", async () => {
		const { session, team, ctx, asked } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("keeps a standing under another name when the roster cannot be read, so a guess cannot rename", async () => {
		// The rename risk the old early return guarded against is real, and it is the only half of
		// it that survives: a join spent here would rename a session the bus may still hold.
		const { session, team, ctx, asked } = joinHarness(temps, {
			record: { ok: true, label: "core-claims", watching: { armed: true, wake: true } },
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("records a join that threw as a failure, the way it records a refused one", async () => {
		const { session, team, ctx, standing } = joinHarness(temps, { fails: true });
		await joinTeam(session, team, ctx, LABEL);
		expect(standing()).toEqual({ ok: false, error: "the bus went away" });
	});

	test("answers with the state a line reads, and records it", async () => {
		const { session, team, ctx, standing } = joinHarness(temps);
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ label: LABEL, listening: true });
		expect(standing()).toEqual(joinedStanding());
	});

	test("a refusal with no bus names the extension, because the door that renames refuses the same way", async () => {
		const { session, team, ctx } = joinHarness(temps, { refuses: NO_BUS_ERROR });
		// `/team join` is the answer to every other refusal, and here it is the answer to nothing:
		// there is no bus to ask, so the sentence names the switch instead of the verb.
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({
			error: NO_BUS_ERROR,
			fix: "Turn the `session-bus` extension on in `/bytefly`.",
		});
	});

	test("a name a running session holds says what frees it, and what renaming costs", async () => {
		const { session, team, ctx, busDir } = joinHarness(temps, {
			refuses: `the label "${LABEL}" is already in use by session s-peer.`,
		});
		writeBusRecord(busDir, { id: "s-peer", label: LABEL, lastSeen: NOW });
		const state = await joinTeam(session, team, ctx, LABEL);
		// The bus says who holds the name and never what to do: only that session stopping frees
		// it, and the other way past it is the door that renames — which a lead pays for.
		expect("error" in state && state.fix).toContain("Only that session stopping frees the name");
		expect("error" in state && state.fix).toContain("a lead that renames loses its signature");
	});

	test("a name a dead record still holds names the door, and comes back on its own if nobody runs it", async () => {
		const { session, team, ctx, busDir } = joinHarness(temps, {
			refuses: `the label "${LABEL}" is held by session s-peer.`,
		});
		// The bus reserves a name for the heartbeat's TTL, which is the window a stopped session
		// still holds: the record's process is gone, so waiting is a real answer — and the sentence
		// names the person's door, because waiting is no longer the only one.
		writeBusRecord(busDir, { id: "s-peer", label: LABEL, lastSeen: NOW, pid: 2 ** 22 + 7 });
		const state = await joinTeam(session, team, ctx, LABEL);
		expect("error" in state && state.fix).toContain("/sessions forget");
	});

	test("a reason the roster cannot place is reported with no advice grafted onto it", async () => {
		const { session, team, ctx } = joinHarness(temps, { refuses: "the request was lost" });
		expect(await joinTeam(session, team, ctx, LABEL)).toEqual({ error: "the request was lost" });
	});
	test("holds the record this process wrote, so the door asks nothing", async () => {
		const { session, team, ctx, asked } = joinHarness(temps, {
			roster: async () => [liveRow({ pid: process.pid, watching: { armed: true, wake: true } })],
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks when the record names another live process", async () => {
		// `process.ppid` is alive for the length of the run, so the ask is the identity rule rather
		// than a record the read called gone.
		const { session, team, ctx, asked } = joinHarness(temps, {
			roster: async () => [liveRow({ pid: process.ppid, watching: { armed: true, wake: true } })],
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("asks when the pid is this process's but its start token is another process's", async () => {
		// A pid the machine reused belongs to another process now, and a live record never reaches
		// the read's own token check: this is the case that has to ask.
		const { session, team, ctx, asked } = joinHarness(temps, {
			roster: async () => [liveRow({ pid: process.pid, startToken: "0", watching: { armed: true, wake: true } })],
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("holds the record whose start token is this process's", async () => {
		const token = startTokenOf(process.pid);
		const { session, team, ctx, asked } = joinHarness(temps, {
			roster: async () => [
				liveRow({
					pid: process.pid,
					...(token === undefined ? {} : { startToken: token }),
					watching: { armed: true, wake: true },
				}),
			],
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks for a record from another machine, whose pid names a local process by coincidence", async () => {
		const { session, team, ctx, asked } = joinHarness(temps, {
			roster: async () => [liveRow({ pid: process.pid, foreign: true, watching: { armed: true, wake: true } })],
		});
		await joinTeam(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});
});

describe("onTeam", () => {
	test("is true for a live record of this session, and asks the bus nothing", async () => {
		const { session, ctx, busDir, asked } = joinHarness(temps);
		liveRecord(busDir);
		expect(await onTeam(session, ctx)).toBe(true);
		// The rule is a read of the files, so a turn-start question costs no request.
		expect(asked).toEqual([]);
	});

	test("is false for a session the bus has no record of", async () => {
		const { session, ctx, asked } = joinHarness(temps);
		expect(await onTeam(session, ctx)).toBe(false);
		expect(asked).toEqual([]);
	});

	test("is false for a record whose heartbeat aged out, which the bus still remembers", async () => {
		const { session, ctx, busDir } = joinHarness(temps);
		liveRecord(busDir, NOW - SESSION_TTL_MS - 1);
		expect(await onTeam(session, ctx)).toBe(false);
	});

	test("is false for a host with no session id, which has no record to look for", async () => {
		const { session, busDir } = joinHarness(temps);
		liveRecord(busDir);
		const { ctx } = fakeCtx({ cwd: "/repo/billing" });
		expect(await onTeam(session, ctx)).toBe(false);
	});

	test("is false when the roster cannot be read, never a throw", async () => {
		const { session, ctx } = joinHarness(temps, {
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		expect(await onTeam(session, ctx)).toBe(false);
	});
});

describe("createMemberTools", () => {
	/** A host whose bus is loaded or not, and whose active set the case reads back. */
	function host(bus: boolean): { pi: ReturnType<typeof createFakePi>["pi"]; active: () => string[] } {
		const fake = createFakePi({ active: ["read"], ...(bus ? { allTools: [{ name: "session" }] } : {}) });
		return { pi: fake.pi, active: () => fake.pi.getActiveTools() };
	}

	test("offers the names while this session is on the team, and withdraws them when it is not", async () => {
		const { session, ctx, busDir } = joinHarness(temps);
		const { pi, active } = host(true);
		const tools = createMemberTools(pi, session, ["board"], { solo: false });
		await tools.sync(ctx);
		expect(active()).toEqual(["read"]);
		const file = liveRecord(busDir);
		await tools.sync(ctx);
		expect(active()).toEqual(["read", "board"]);
		removeBusRecord(file);
		await tools.sync(ctx);
		expect(active()).toEqual(["read"]);
	});

	test("offers a solo surface with no bus loaded, and never one that needs the bus", async () => {
		const { session, ctx } = joinHarness(temps);
		const solo = host(false);
		const needsBus = host(false);
		await createMemberTools(solo.pi, session, ["board"], { solo: true }).sync(ctx);
		await createMemberTools(needsBus.pi, session, ["board"], { solo: false }).sync(ctx);
		expect(solo.active()).toEqual(["read", "board"]);
		expect(needsBus.active()).toEqual(["read"]);
	});

	test("does not put a tool back that the user removed while the team did not change", async () => {
		const { session, ctx, busDir } = joinHarness(temps);
		const { pi, active } = host(true);
		liveRecord(busDir);
		const tools = createMemberTools(pi, session, ["board"], { solo: false });
		await tools.sync(ctx);
		// `/tools` is the user's own answer, and a level-triggered sync would spend every turn undoing it.
		pi.setActiveTools(["read"]);
		await tools.sync(ctx);
		expect(active()).toEqual(["read"]);
	});
});

describe("teamStatus", () => {
	test("reads the live record, so a disarm through the bus is not hidden by an old standing", async () => {
		// The standing says the join armed a watch; the record is what a `join({listen: false})`
		// rewrote afterwards, and the record is what a peer resolves.
		const { session, ctx, busDir } = joinHarness(temps, { record: joinedStanding({ armed: true, wake: false }) });
		writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen: NOW, watching: { armed: false, wake: false } });
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL, listening: false });
	});

	test("does not repeat a join the bus no longer holds", async () => {
		// The record was pruned or the bus stopped: an ok standing is history, and a line that
		// repeated it would name a team no peer resolves.
		const { session, ctx } = joinHarness(temps, { record: joinedStanding() });
		expect(await teamStatus(session, ctx)).toBeUndefined();
	});

	test("keeps the standing when the roster cannot be read, which is no answer at all", async () => {
		const { session, ctx } = joinHarness(temps, {
			record: joinedStanding({ armed: false, wake: false }),
			roster: async () => {
				throw new Error("no agent directory");
			},
		});
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL, listening: false });
	});

	test("falls back to the standing's failure, which is the reason to report", async () => {
		const { session, ctx } = joinHarness(temps, { record: { ok: false, error: "the session bus is not loaded" } });
		expect(await teamStatus(session, ctx)).toEqual({ error: "the session bus is not loaded" });
	});

	test("says nothing when this session has neither asked nor been recorded", async () => {
		const { session, ctx } = joinHarness(temps);
		expect(await teamStatus(session, ctx)).toBeUndefined();
	});

	test("prints the name alone for a record from before the listening field", async () => {
		// `watching` absent is "the record does not say", not "not listening", and there is no
		// standing to fill it in: the line must not accuse a peer that may be listening.
		const { session, ctx, busDir } = joinHarness(temps);
		liveRecord(busDir);
		expect(await teamStatus(session, ctx)).toEqual({ label: LABEL });
	});
});

describe("standingOf", () => {
	test("maps a refusal to the error clause, an absence to nothing", () => {
		expect(standingOf(undefined)).toBeUndefined();
		expect(standingOf({ ok: false, error: "no bus" })).toEqual({ error: "no bus" });
		expect(standingOf(joinedStanding())).toEqual({ label: LABEL, listening: true });
	});
});
