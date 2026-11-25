/**
 * The watch a record carries, adopted at start.
 *
 * The loss this covers is silent: a fresh runtime used to arm from its own silence, so a session
 * the user had set to `wake` came back as `on` with nothing said, and no peer could tell the two
 * apart — the seat's round and the team line read `armed` only. Each case seeds the record a
 * previous run of the same session left behind and starts a new bus on that id, which is exactly
 * what a restart is.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sessionRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus, type SessionBus, type SessionBusOptions } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function context(cwd: string, sessionId: string): ExtensionContext {
	return fakeCtx({ cwd, sessionId, sessionName: "frontend", mode: "tui", hasUI: true }).ctx as ExtensionContext;
}

/** A bus with no tickers and an injected clock: the watch is read, never waited on. */
function bus(dir: string, options: Partial<SessionBusOptions> = {}): SessionBus {
	return createSessionBus({} as ExtensionAPI, {
		dir,
		now: () => 1_000,
		heartbeatMs: 0,
		watchMs: 0,
		alive: () => true,
		startTokenFn: () => "started-here",
		repo: { root: "/repo/frontend", key: "shared" },
		...options,
	});
}

/** A record on disk for `id`, as a previous run of that session would have left it. */
async function stored(dir: string, id: string, fields: Partial<SessionRecord>): Promise<void> {
	const store = createBusStore({ dir });
	await store.ensure();
	await store.writeSession({ ...sessionRecord(id), ...fields });
}

describe("the watch a record restores", () => {
	test("a record's wake is adopted with no join in this run", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "s1", { watch: "wake", watching: { armed: true, wake: true } });
		const session = bus(dir);
		await session.start(context("/repo/frontend", "s1"));
		// No join: the record already said this session listens, and that is the whole point.
		expect((await session.status()).watching).toEqual({ armed: true, wake: true });
		expect(session.wantsWake()).toBe(true);
		await session.stop();
	});

	test("an on record restores armed without wake", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "s1", { watch: "on", watching: { armed: true, wake: false } });
		const session = bus(dir);
		await session.start(context("/repo/frontend", "s1"));
		expect((await session.status()).watching).toEqual({ armed: true, wake: false });
		expect(session.wantsWake()).toBe(false);
	});

	test("off stays off, and a record that says nothing arms nothing", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "off", { watch: "off", watching: { armed: false, wake: false } });
		await stored(dir, "never", {});
		const off = bus(dir);
		await off.start(context("/repo/frontend", "off"));
		expect((await off.status()).watching).toBeUndefined();
		const never = bus(dir);
		await never.start(context("/repo/frontend", "never"));
		expect((await never.status()).watching).toBeUndefined();
	});

	test("reads an older build's pair, including the one the mode cannot spell", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "on", { watching: { armed: true, wake: false } });
		await stored(dir, "wake", { watching: { armed: true, wake: true } });
		await stored(dir, "broken", { watching: { armed: false, wake: true } });
		const on = bus(dir);
		await on.start(context("/repo/frontend", "on"));
		expect((await on.status()).watching).toEqual({ armed: true, wake: false });
		const waking = bus(dir);
		await waking.start(context("/repo/frontend", "wake"));
		expect((await waking.status()).watching).toEqual({ armed: true, wake: true });
		// A watch that is not armed delivers nothing, whatever its wake flag says.
		const broken = bus(dir);
		await broken.start(context("/repo/frontend", "broken"));
		expect((await broken.status()).watching).toBeUndefined();
	});

	test("a plain join after the restore keeps the mode the record asked for", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "s1", { watch: "wake", watching: { armed: true, wake: true } });
		const session = bus(dir);
		await session.start(context("/repo/frontend", "s1"));
		await session.join({});
		expect((await session.status()).watching).toEqual({ armed: true, wake: true });
		const record = await createBusStore({ dir }).session("s1");
		expect(record?.watch).toBe("wake");
		// The pair a peer reads is derived from the mode on the same write, so the two cannot disagree.
		expect(record?.watching).toEqual({ armed: true, wake: true });
	});

	test("a door's own mode is what the record says afterwards, for each of the three", async () => {
		const dir = scratchDir(temps, "pi-watch-restore-");
		await stored(dir, "s1", { watch: "wake", watching: { armed: true, wake: true } });
		const session = bus(dir);
		await session.start(context("/repo/frontend", "s1"));
		// The projection is written with the mode on every join, so the pair a peer reads is never
		// a second fact that can drift from the statement this session adopts.
		await session.join({ listen: false });
		expect((await session.status()).watching).toBeUndefined();
		const off = await createBusStore({ dir }).session("s1");
		expect([off?.watch, off?.watching]).toEqual(["off", { armed: false, wake: false }]);
		await session.join({ wake: false });
		const on = await createBusStore({ dir }).session("s1");
		expect([on?.watch, on?.watching]).toEqual(["on", { armed: true, wake: false }]);
		await session.join({ wake: true });
		const waking = await createBusStore({ dir }).session("s1");
		expect([waking?.watch, waking?.watching]).toEqual(["wake", { armed: true, wake: true }]);
	});
});
