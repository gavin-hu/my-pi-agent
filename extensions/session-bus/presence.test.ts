import { afterAll, describe, expect, test } from "bun:test";
import { createTurn } from "./presence.ts";
import { createBusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { readRoster } from "../../lib/session-roster.ts";

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

/** One bus directory, its store, and a turn over a record the caller can flip. */
async function harness(over: Parameters<typeof record>[0] = {}) {
	const dir = scratchDir(temps, "pi-presence-");
	const store = createBusStore({ dir });
	await store.ensure();
	const me = record(over);
	await store.writeSession(me);
	const turn = createTurn({ store: () => store, record: () => me, joined: () => true, now: () => 5_000 });
	const read = async () => (await readRoster(dir))?.find((session) => session.id === me.id);
	return { dir, store, me, turn, read };
}

describe("the turn", () => {
	test("stamps the record when a run begins, written at once", async () => {
		const { turn, read } = await harness();
		await turn.start();
		expect((await read())?.turnAt).toBe(5_000);
	});

	test("takes the stamp off when the run settles", async () => {
		const { turn, read } = await harness({ turnAt: 4_000 });
		await turn.settle();
		expect((await read())?.turnAt).toBeUndefined();
	});

	test("settles an aborted run the same way: the stamp is about the run, not its outcome", async () => {
		const { me, turn, read } = await harness();
		await turn.start();
		// `agent_settled` fires with `aborted: true` for a cancelled turn, and the record's own
		// state is asserted both before and after so a settle that wrote nothing is caught.
		expect((await read())?.turnAt).toBe(5_000);
		me.turnAt = 5_000;
		await turn.settle();
		const after = await read();
		expect(after?.turnAt).toBeUndefined();
		expect(after?.label).toBe("billing-core");
	});

	test("writes nothing before a session has joined", async () => {
		const dir = scratchDir(temps, "pi-presence-");
		const store = createBusStore({ dir });
		await store.ensure();
		let now = 0;
		const turn = createTurn({ store: () => store, record: () => record(), joined: () => false, now: () => now++ });
		await turn.start();
		// The record is nobody's until a join writes it: a turn is a field on that record.
		expect(await readRoster(dir)).toEqual([]);
	});

	test("is a no-op when the bus never started", async () => {
		const turn = createTurn({ store: () => undefined, record: () => undefined, joined: () => true, now: () => 1 });
		await turn.start();
		await turn.settle();
	});

	test("a second turn stamps the clock it began at, not the first one's", async () => {
		const dir = scratchDir(temps, "pi-presence-");
		const store = createBusStore({ dir });
		await store.ensure();
		const me = record();
		await store.writeSession(me);
		let now = 7_000;
		const turn = createTurn({ store: () => store, record: () => me, joined: () => true, now: () => now });
		await turn.start();
		now = 8_000;
		await turn.start();
		expect((await readRoster(dir))?.find((session) => session.id === me.id)?.turnAt).toBe(8_000);
	});
});
