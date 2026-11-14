/**
 * The bus's prune, split where its cost splits.
 *
 * An action prunes records and claims, which is two small directory reads, because a peer that
 * died must free the paths it held the moment a claimant looks. The inbox sweep — the one walk
 * whose cost is every message on the bus — belongs to the heartbeat instead, where a day-long
 * message TTL does not care about ten seconds. Both layers are here because the split is one
 * decision: the store cases hold that neither half does the other's work, and the last case
 * holds that the heartbeat is what actually runs the mail half.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakeCtx } from "../../test/helpers/context.ts";
import { busMessage, busStoreFixture, sessionRecord } from "../../test/helpers/bus.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle } from "../../test/helpers/process.ts";
import { createSessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the store's two halves", () => {
	test("removes stale sessions, their claims, and expired messages", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1", 100));
		await store.writeMessage("s2", busMessage("100-a", "s2", 100));
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		// Both halves, in the order a heartbeat runs them.
		await store.pruneRecords({ now: 1_000, activeIds: new Set(["s1", "s2"]), sessionTtlMs: 500 });
		await store.pruneMail({ now: 1_000, messageTtlMs: 500 });
		expect(await store.sessions()).toEqual([]);
		expect(await store.claims()).toEqual([]);
		expect(await store.inbox("s2", 10)).toEqual({ messages: [], unreadable: [] });
	});

	test("keeps fresh sessions and claims", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1", 900));
		await store.claimAll(["src/a.ts"], "s1", "one", 900);
		await store.pruneRecords({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500 });
		expect(await store.sessions()).toHaveLength(1);
		expect(await store.claims()).toHaveLength(1);
	});

	test("keeps a gone session's row and frees the path it held", async () => {
		const { store } = busStoreFixture(temps);
		// The process is gone but the heartbeat is fresh: the caller knows that, the file
		// cannot, so the caller says which ids own nothing.
		await store.writeSession(sessionRecord("s1", 900));
		await store.claimAll(["src/a.ts"], "s1", "one", 900);
		await store.pruneRecords({
			now: 1_000,
			activeIds: new Set(),
			goneIds: new Set(["s1"]),
			sessionTtlMs: 500,
		});
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
		expect(await store.claims()).toEqual([]);
	});

	test("keeps a live peer's claim that the caller's active set had not seen yet", async () => {
		const { store } = busStoreFixture(temps);
		// A peer joined and claimed after the caller read the session list, so its id is
		// missing from the set the caller passes; its claim is still its own.
		await store.writeSession(sessionRecord("s2", 900));
		await store.claimAll(["src/api"], "s2", "peer", 900);
		await store.pruneRecords({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500 });
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/api"]);
	});

	test("drops the inbox directory whose mail expired and keeps one that is still fresh", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2", 100));
		await store.writeMessage("s3", busMessage("900-b", "s3", 900));
		await store.pruneMail({ now: 1_000, messageTtlMs: 500 });
		expect(await readdir(join(dir, "inbox"))).toHaveLength(1);
		expect((await store.peek("s3", { limit: 10 })).mail).toHaveLength(1);
	});

	test("collects the temp file a crashed writer left, and leaves a live one alone", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		const sessions = join(dir, "sessions");
		const stale = join(sessions, "abcd.json.123.9999.tmp");
		const live = join(sessions, "abcd.json.456.8888.tmp");
		await writeFile(stale, "{}");
		await writeFile(live, "{}");
		// The temp file of a write still in flight is milliseconds old; a crashed writer's
		// sits until the next prune, where the filesystem's own timestamp decides.
		await utimes(stale, 1_000_000, 1_000_000);
		await store.pruneRecords({ now: 1_000, activeIds: new Set(), sessionTtlMs: 500 });
		expect(await readdir(sessions)).toEqual(["abcd.json.456.8888.tmp"]);
	});

	test("each half leaves the other's work alone", async () => {
		const { dir, store } = busStoreFixture(temps);
		// A record that is still fresh, holding a claim, beside mail nobody ever read.
		await store.writeSession(sessionRecord("s1", 900));
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		await store.writeMessage("s2", busMessage("100-a", "s2", 100));

		// The records half runs before every action, so it must not pay for the mail: an expired
		// message is still there until a heartbeat sweeps it.
		await store.pruneRecords({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500 });
		expect(await readdir(join(dir, "inbox"))).toHaveLength(1);

		// And the mail half is the heartbeat's alone, so it must not expire a record or a claim
		// the action path has not judged: only `pruneRecords` knows which ids are still live.
		await store.pruneMail({ now: 1_000, messageTtlMs: 500 });
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
		expect(await store.claims()).toHaveLength(1);
	});
});

describe("the heartbeat's sweep", () => {
	test("an action leaves expired mail alone and the next tick sweeps it", async () => {
		const dir = temps.track(tempDir("pi-session-bus-"));
		let now = 1_000;
		const ticks: Array<() => void> = [];
		const session = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => now,
			heartbeatMs: 10,
			watchMs: 0,
			messageTtlMs: 500,
			alive: () => true,
			startTokenFn: () => "started-here",
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		await session.start(
			fakeCtx({ cwd: "/repo", sessionId: "h1", sessionName: "live", mode: "tui", hasUI: true }).ctx as ExtensionContext,
		);
		await session.join({ listen: false });

		// Mail addressed to this session and already past the TTL when the next call runs.
		const store = createBusStore({ dir });
		await store.writeMessage("h1", busMessage("1-old", "h1", 0));

		// An addressable action still prunes the records — a dead peer's claim frees there — but
		// the inbox sweep is the heartbeat's, so nothing on disk moves yet.
		now += 1_000;
		expect((await session.claim(["src/a.ts"])).claimed).toEqual(["src/a.ts"]);
		expect(await store.unread("h1")).toBe(1);

		for (const tick of ticks) tick();
		for (let attempt = 0; attempt < 100 && (await store.unread("h1")) > 0; attempt += 1) await settle(2);
		expect(await store.unread("h1")).toBe(0);
		await session.stop();
	});
});
