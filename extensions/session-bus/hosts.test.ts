/**
 * The machines in one bus: what a claim names, and how a claim from another one ends.
 *
 * Two hosts sharing a bus directory through a sync client is the shape these cases hold: this
 * machine judges its own claims by the owner's record, and the other machine's by that machine's
 * heartbeat, because a local pid says nothing about a session on another disk.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker, type TempTracker } from "../../test/helpers/git.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { settle } from "../../test/helpers/process.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSessionBus, type SessionBusOptions } from "./runtime.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const STUDIO = { id: "aaaaaaaaaaaaaaa1", name: "studio" };

/** A bus in a temp directory, as `runtime.test.ts` builds one: a fixed clock and no heartbeat tick. */
function busAt(dir: string, now: () => number, options: Partial<SessionBusOptions> = {}) {
	return createSessionBus({} as never, {
		dir,
		now,
		heartbeatMs: 0,
		watchMs: 0,
		alive: () => true,
		startTokenFn: () => "started-here",
		repo: { root: "/repo", key: "shared" },
		...options,
	});
}

/** One joined session on a bus, under its own name and not listening. */
async function joined(bus: ReturnType<typeof busAt>, id: string): Promise<ExtensionContext> {
	const ctx = fakeCtx({ cwd: "/repo", sessionId: id, sessionName: id, mode: "tui", hasUI: true })
		.ctx as ExtensionContext;
	await bus.start(ctx);
	await bus.join({ listen: false });
	return ctx;
}

describe("the machine a claim names", () => {
	/** A store that writes as one machine, on a bus directory of its own. */
	function machine(temps: TempTracker, host: string) {
		const dir = temps.track(tempDir("pi-session-bus-"));
		return { dir, store: createBusStore({ dir, host }) };
	}

	test("stamps its own host on every claim it publishes", async () => {
		const { store } = machine(temps, "aaaaaaaaaaaaaaa1");
		await store.ensure();
		await store.claimAll(["src/api"], "s1", "billing-core", 100);
		expect((await store.claims()).map((claim) => [claim.path, claim.host])).toEqual([["src/api", "aaaaaaaaaaaaaaa1"]]);
	});

	test("keeps another machine's claim while that machine beats, and releases it once it stops", async () => {
		// The other machine's claim arrives here through a client, and this machine owns no pid for
		// it: its liveness is the row that machine writes to `hosts/`.
		const other = machine(temps, "bbbbbbbbbbbbbbb2");
		await other.store.ensure();
		await other.store.writeHost({ id: "bbbbbbbbbbbbbbb2", name: "studio" }, 900);
		await other.store.claimAll(["src/api"], "s-other", "billing-api", 900);

		const here = createBusStore({ dir: other.dir, host: "aaaaaaaaaaaaaaa1" });
		// Nothing of this machine's is live, and the owner's record is not here at all.
		await here.pruneRecords({ now: 1_000, activeIds: new Set(), sessionTtlMs: 600_000 });
		expect((await here.claims()).map((claim) => claim.path)).toEqual(["src/api"]);
		// The same claim, on a clock past the TTL its machine last beat at.
		await here.pruneRecords({ now: 900 + 600_001, activeIds: new Set(), sessionTtlMs: 600_000 });
		expect(await here.claims()).toEqual([]);
	});

	test("still releases this machine's claim with its owner's gone record", async () => {
		// The local half of the same rule: a claim this machine made is its owner's, and an owner
		// whose record is not live owns nothing — the foreign branch must not swallow it.
		const mine = machine(temps, "aaaaaaaaaaaaaaa1");
		await mine.store.ensure();
		await mine.store.claimAll(["src/api"], "s1", "billing-core", 100);
		await mine.store.pruneRecords({ now: 1_000, activeIds: new Set(), sessionTtlMs: 600_000 });
		expect(await mine.store.claims()).toEqual([]);
	});

	test("writes its machine's row once, and refreshes the beat without renaming it", async () => {
		const { store } = machine(temps, "aaaaaaaaaaaaaaa1");
		await store.ensure();
		const identity = { id: "aaaaaaaaaaaaaaa1", name: "studio" };
		await store.writeHost(identity, 100);
		await store.writeHost(identity, 200);
		expect(await store.hosts()).toEqual([{ host: "aaaaaaaaaaaaaaa1", name: "studio", lastSeen: 200 }]);
	});

	test("skips a file in hosts/ that is not a machine: a client's copy is not a peer", async () => {
		const { dir, store } = machine(temps, "aaaaaaaaaaaaaaa1");
		await store.ensure();
		await store.writeHost({ id: "aaaaaaaaaaaaaaa1", name: "studio" }, 100);
		const copy = join(dir, "hosts", "aaaaaaaaaaaaaaa1 (conflicted copy).json");
		await writeFile(copy, JSON.stringify({ host: "aaaaaaaaaaaaaaa1", name: "studio", lastSeen: 999 }));
		expect((await store.hosts()).map((entry) => entry.lastSeen)).toEqual([100]);
	});
});

describe("the bus's own machine", () => {
	test("names the host on every record, and writes its row once", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const bus = busAt(dir, () => 1_000, { host: STUDIO });
		await joined(bus, "s1");
		const store = createBusStore({ dir, host: STUDIO.id });
		expect((await store.session("s1"))?.host).toBe(STUDIO.id);
		// The row is the machine's, not the session's: one file, named for the identity, with the
		// name it was created under.
		expect(await store.hosts()).toEqual([{ host: STUDIO.id, name: "studio", lastSeen: 1_000 }]);
	});

	test("beats its row with the session, so a claim from here lapses on the machine too", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		let now = 1_000;
		const ticks: Array<() => void> = [];
		const bus = busAt(dir, () => now, {
			host: STUDIO,
			heartbeatMs: 10,
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		await joined(bus, "s1");
		now = 11_000;
		for (const tick of ticks) tick();
		const store = createBusStore({ dir, host: STUDIO.id });
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if ((await store.hosts())[0]?.lastSeen === 11_000) return;
			await settle(2);
		}
		throw new Error("the heartbeat did not reach the machine's row");
	});

	test("writes no host at all when it was given no identity, as an older build did", async () => {
		// The seam's meaning: a suite's bus names no machine, so its records stay the shape a build
		// without hosts wrote.
		const dir = scratchDir(temps, "pi-session-bus-");
		const bus = busAt(dir, () => 1_000);
		await joined(bus, "s1");
		const store = createBusStore({ dir });
		expect((await store.session("s1"))?.host).toBeUndefined();
		expect(await store.hosts()).toEqual([]);
	});
});
