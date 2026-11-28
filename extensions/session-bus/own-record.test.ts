/**
 * The record this process serves: adopted by any start that has one, and minted when it has none.
 *
 * A record used to belong to a transcript, so the shutdown that ended one removed it and a `/new`
 * dropped the name, the mail cursor, the watch, the claims and the card with it. These cases pin the
 * rule that replaced it — a start whose reason is `"new"` serves the row this process left, and a
 * start whose own session id already has a row adopts that row's name and start time, whatever its
 * reason — and, more importantly, the direction every guard fails in: a start that cannot be sure
 * mints, because a wrong serve hands one peer's mail and work to another.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionRecord } from "./types.ts";
import { type StartFacts, ADOPT_WINDOW_MS, endRecord, startRecord } from "./own-record.ts";
import { createBusStore } from "./store.ts";
import { recordFacts, rosterStateOf, SESSION_TTL_MS } from "../../lib/session-roster.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { sessionRecord } from "../../test/helpers/bus.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000_000;
const PID = 4_242;
/** The process's start time: the one fact a reused pid cannot fake. */
const TOKEN = "started-here";
const HOST = "a1b2c3d4e5f60718";
/** What the previous transcript called itself. */
const LEFT = "left-behind";

/** One bus directory, and the facts of the start that reads it. */
function started(overrides: Partial<StartFacts> = {}) {
	const dir = scratchDir(temps, "pi-own-record-");
	const store = createBusStore({ dir, host: HOST });
	const { pi } = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const { ctx } = fakeCtx({ cwd: "/repo", sessionId: "new-session", sessionName: "jack" });
	const facts: StartFacts = {
		pi,
		store,
		context: ctx as ExtensionContext,
		id: "new-session",
		pid: PID,
		startToken: TOKEN,
		host: HOST,
		reason: "new",
		cwd: "/repo",
		repoRoot: "/repo",
		fromGit: false,
		now: NOW,
		...overrides,
	};
	return { dir, store, facts };
}

/** The row a previous transcript of this process left: the one a `/new` may serve. */
async function leftBehind(store: ReturnType<typeof createBusStore>, fields: Partial<SessionRecord> = {}) {
	const record: SessionRecord = {
		...sessionRecord(LEFT, NOW - 1_000),
		id: "old-session",
		label: "tom",
		pid: PID,
		host: HOST,
		startToken: TOKEN,
		startedAt: 500,
		watching: { armed: true, wake: true },
		seenMail: ["m1"],
		...fields,
	};
	await store.writeSession(record);
	return record;
}

describe("the record a start serves", () => {
	test("a fresh start mints one under its session id", async () => {
		const { facts } = started({ reason: "startup" });
		const { record, served } = await startRecord(facts);
		expect(served).toBe(false);
		expect(record.id).toBe("new-session");
		expect(record.label).toBe("jack");
		expect(record.startedAt).toBe(NOW);
	});

	test("a `/new` start serves the row the previous transcript left, name and watch with it", async () => {
		const { store, facts } = started();
		await leftBehind(store);

		const { record, served } = await startRecord(facts);
		expect(served).toBe(true);
		expect(record.id).toBe("old-session");
		expect(record.label).toBe("tom");
		expect(record.watching).toEqual({ armed: true, wake: true });
		expect(record.seenMail).toEqual(["m1"]);
		// The record began when it began: the Team tab must not draw this peer as new.
		expect(record.startedAt).toBe(500);
		expect(record.lastSeen).toBe(NOW);
	});

	test("a start that cannot name its reason mints, whatever row this process left", async () => {
		const { store, facts } = started({ reason: undefined });
		await leftBehind(store);
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});

	for (const reason of ["startup", "reload", "resume", "fork"] as const) {
		test(`a \`${reason}\` start mints, because only a \`/new\` replaces the transcript in place`, async () => {
			const { store, facts } = started({ reason });
			await leftBehind(store);
			expect((await startRecord(facts)).record.id).toBe("new-session");
		});
	}

	test("a row already under this session id is the one it adopts, and no row it left is served", async () => {
		const { store, facts } = started();
		await leftBehind(store);
		await store.writeSession({ ...sessionRecord("new-session", NOW - 10), label: "own", pid: 999 });

		const { record, served } = await startRecord(facts);
		// Adopted, not served: a reload must not put a session on the bus on the strength of a restart.
		expect(served).toBe(false);
		expect(record.id).toBe("new-session");
		// The name a peer already addresses, and the moment it began: Pi calls this transcript `jack`,
		// and the start must not put that, or this clock, over the row.
		expect(record.label).toBe("own");
		expect(record.startedAt).toBe(50);
		// Only the membership and the age are the row's; the process is this one.
		expect(record.pid).toBe(PID);
		expect(record.host).toBe(HOST);
	});

	for (const reason of ["startup", "reload", "resume", "fork", undefined] as const) {
		test(`a \`${reason}\` start keeps the name and start time of the row its session id already has`, async () => {
			const { store, facts } = started({ reason });
			await store.writeSession({
				...sessionRecord(facts.id, NOW - 10),
				label: "custom",
				startedAt: 500,
				watch: "wake",
				watching: { armed: true, wake: true },
			});

			const { record, served } = await startRecord(facts);
			expect(served).toBe(false);
			expect(record.id).toBe(facts.id);
			expect(record.label).toBe("custom");
			expect(record.startedAt).toBe(500);
			// The row's watch pair goes with the name, so the first save after a start cannot erase it
			// before a join writes the mode again.
			expect(record.watching).toEqual({ armed: true, wake: true });
		});
	}

	test("a row from another process is not served, whatever its name", async () => {
		const { store, facts } = started();
		await leftBehind(store, { pid: PID + 1 });
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});

	test("a row whose start token is not this process's is not served", async () => {
		const { store, facts } = started();
		await leftBehind(store, { startToken: "another-start" });
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});

	test("a start with no start token mints rather than guess, so a reused pid cannot serve", async () => {
		const { store, facts } = started({ startToken: undefined });
		await leftBehind(store);
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});

	test("a row older than the window is not served", async () => {
		const { store, facts } = started();
		await leftBehind(store, { lastSeen: NOW - ADOPT_WINDOW_MS - 1 });
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});

	test("a row another machine wrote is not served, because its pid says nothing here", async () => {
		const { store, facts } = started();
		await leftBehind(store, { host: "elsewhere0000000" });
		expect((await startRecord(facts)).record.id).toBe("new-session");
	});
});

describe("the record a shutdown keeps or ends", () => {
	test("a `/new` keeps the record, refreshed to the shutdown, and the claims a card is worked under", async () => {
		const { store } = started();
		const record = await leftBehind(store);
		await store.claimAll(["src/a.ts"], record.id, record.label, NOW);

		await endRecord({ store, record: record, pid: PID, reason: "new", now: NOW + 5 });

		expect((await store.session(record.id))?.lastSeen).toBe(NOW + 5);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/a.ts"]);
	});

	test("a `/reload` keeps the record and its claims, without stamping a heartbeat it did not earn", async () => {
		const { store } = started();
		const record = await leftBehind(store);
		await store.claimAll(["src/a.ts"], record.id, record.label, NOW);

		await endRecord({ store, record: record, pid: PID, reason: "reload", now: NOW + 5 });

		const kept = await store.session(record.id);
		// The row is the one the shutdown found: a reload writes no fresh `lastSeen`, so a reload that
		// never reaches its start ages on the heartbeat the process last gave, not on a new one.
		expect(kept?.lastSeen).toBe(record.lastSeen);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/a.ts"]);

		// How that reads between the reload's two edges: `live` while the last heartbeat is inside its
		// window, `quiet` once it closes. A row past the TTL is the prune's — so a kept row cannot read
		// non-live and still survive — and `gone` is the process's answer, not the reload's.
		const seams = { alive: () => true };
		expect(rosterStateOf(recordFacts(kept as SessionRecord, HOST), NOW + 5, SESSION_TTL_MS, seams)).toBe("live");
		expect(
			rosterStateOf(
				recordFacts(kept as SessionRecord, HOST),
				record.lastSeen + SESSION_TTL_MS + 1,
				SESSION_TTL_MS,
				seams,
			),
		).toBe("quiet");
	});

	for (const reason of ["quit", "resume", "fork", undefined] as const) {
		test(`\`${reason}\` removes the record and releases its claims`, async () => {
			const { store } = started();
			const record = await leftBehind(store);
			await store.claimAll(["src/a.ts"], record.id, record.label, NOW);

			await endRecord({ store, record: record, pid: PID, reason, now: NOW + 5 });

			expect(await store.session(record.id)).toBeUndefined();
			expect(await store.claims()).toEqual([]);
		});
	}

	test("a stop whose record another process owns leaves it alone", async () => {
		const { store } = started();
		const record = await leftBehind(store, { pid: PID + 1 });

		await endRecord({ store, record: record, pid: PID, reason: "quit", now: NOW + 5 });

		expect(await store.session(record.id)).toBeDefined();
	});
});
