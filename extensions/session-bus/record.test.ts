/**
 * The record and the one writer over it.
 *
 * Two things are held here: the turn (both edges of a run, which used to be `presence.ts`) and
 * the write itself — the chain that keeps two changes from landing in the order they were made
 * rather than the order they happened. The cases below are the two failures the chain exists for:
 * a write already in flight must not carry a snapshot of the record from before a later change,
 * and a removal must not be undone by a write still queued behind it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readRoster } from "../../lib/session-roster.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createRecordWriter } from "./record.ts";
import { type BusStore, createBusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
	id: "s1",
	label: "billing-core",
	pid: process.pid,
	cwd: "/repo",
	repoRoot: "/repo",
	mode: "tui",
	startedAt: 1_000,
	lastSeen: 1_000,
	...over,
});

/** One bus directory, its store, and a writer over a record the caller can flip. */
async function harness(over: Partial<SessionRecord> = {}, joined = true) {
	const dir = scratchDir(temps, "pi-record-");
	const store = createBusStore({ dir });
	await store.ensure();
	const me = record(over);
	await store.writeSession(me);
	const writer = createRecordWriter({ store: () => store, record: () => me, joined: () => joined });
	const read = async () => (await readRoster(dir))?.find((session) => session.id === me.id);
	return { dir, store, me, writer, read };
}

/**
 * A store whose writes a case holds open, one at a time.
 *
 * The real store is wrapped rather than replaced: the writer's contract is about the three calls
 * it makes on a `BusStore`, and a hand-written double could pass while the real one still ran.
 * Each write takes a snapshot at the moment it is issued — what a reader would see on disk — so a
 * write that carried a stale record shows up as a missing field rather than as a timing theory.
 */
async function heldWrites() {
	const dir = scratchDir(temps, "pi-record-");
	const base = createBusStore({ dir });
	await base.ensure();
	const snapshots: SessionRecord[] = [];
	const open: Array<() => void> = [];
	const store: BusStore = {
		...base,
		async writeSession(record) {
			snapshots.push(structuredClone(record));
			await new Promise<void>((done) => open.push(done));
			await base.writeSession(record);
		},
	};
	/** Wait until `count` writes have been issued, which is a microtask, never a clock. */
	const issued = async (count: number): Promise<void> => {
		while (snapshots.length < count) await Promise.resolve();
	};
	/** Let the next open write finish, waiting for one that has not been issued yet. */
	const finishOne = async (): Promise<void> => {
		while (open.length === 0) await Promise.resolve();
		open.shift()?.();
	};
	return { dir, store, snapshots, issued, finishOne };
}

describe("the record's turn", () => {
	test("stamps the record when a run begins, written at once", async () => {
		const { writer, read } = await harness();
		await writer.writeTurn(5_000);
		expect((await read())?.turnAt).toBe(5_000);
	});

	test("takes the stamp off when the run settles", async () => {
		const { writer, read } = await harness({ turnAt: 4_000 });
		await writer.writeTurn(undefined);
		expect((await read())?.turnAt).toBeUndefined();
	});

	test("settles an aborted run the same way: the stamp is about the run, not its outcome", async () => {
		const { me, writer, read } = await harness();
		await writer.writeTurn(5_000);
		// `agent_settled` fires with `aborted: true` for a cancelled turn, and the record's own
		// state is asserted both before and after so a settle that wrote nothing is caught.
		expect((await read())?.turnAt).toBe(5_000);
		me.turnAt = 5_000;
		await writer.writeTurn(undefined);
		const after = await read();
		expect(after?.turnAt).toBeUndefined();
		expect(after?.label).toBe("billing-core");
	});

	test("writes nothing before a session has joined", async () => {
		const dir = scratchDir(temps, "pi-record-");
		const store = createBusStore({ dir });
		await store.ensure();
		const writer = createRecordWriter({ store: () => store, record: () => record(), joined: () => false });
		await writer.writeTurn(5_000);
		// The record is nobody's until a join writes it: a turn is a field on that record.
		expect(await readRoster(dir)).toEqual([]);
	});

	test("is a no-op when the bus never started", async () => {
		const writer = createRecordWriter({ store: () => undefined, record: () => undefined, joined: () => true });
		await writer.writeTurn(1);
		await writer.writeTurn(undefined);
	});

	test("a second turn stamps the clock it began at, not the first one's", async () => {
		const { writer, read } = await harness();
		await writer.writeTurn(7_000);
		await writer.writeTurn(8_000);
		expect((await read())?.turnAt).toBe(8_000);
	});
});

describe("the record's one write", () => {
	test("a turn that lands while a write is open waits for it instead of reordering it", async () => {
		const { store, snapshots, issued, finishOne } = await heldWrites();
		const me = record();
		const writer = createRecordWriter({ store: () => store, record: () => me, joined: () => true });

		// The heartbeat's write is issued and held open, so the turn arrives with a write in flight.
		const heartbeat = writer.save();
		await issued(1);
		me.lastSeen = 2_000;
		const turn = writer.writeTurn(5_000);
		// Two writes in flight is the defect: the second could land before the first and carry the
		// older record. One writer means the turn's write is not even issued yet.
		for (let i = 0; i < 4; i += 1) await Promise.resolve();
		expect(snapshots.length).toBe(1);

		await finishOne();
		await heartbeat;
		await finishOne();
		await turn;

		// The write that lands last is the record as it stands, carrying both changes.
		const last = snapshots.at(-1);
		expect(last?.turnAt).toBe(5_000);
		expect(last?.lastSeen).toBe(2_000);
	});

	test("drains before the row can be removed, so a queued write cannot recreate it", async () => {
		const { store, me, writer } = await harness();
		writer.told(["m1"]);
		// The row goes the moment a leave or a quit asks; a write still queued would put it back,
		// and an atomic write even makes the directory it needs.
		await writer.close();
		expect((await store.session(me.id))?.seenMail).toEqual(["m1"]);
		await store.removeSession(me.id);
		expect(await store.session(me.id)).toBeUndefined();

		// A write after the row is gone is the resurrect this door closes: nothing lands.
		await writer.save();
		expect(await store.session(me.id)).toBeUndefined();
	});

	test("takes no writes while closed, and writes again once opened", async () => {
		const { store, me, writer } = await harness();
		await writer.close();
		me.lastSeen = 9_000;
		await writer.save();
		expect((await store.session(me.id))?.lastSeen).toBe(1_000);

		// A `leave` closes the writer and keeps the start, so a later join serves the same id.
		writer.open();
		await writer.save();
		expect((await store.session(me.id))?.lastSeen).toBe(9_000);
	});
});
