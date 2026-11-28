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
import { busMessage, busStoreFixture, sessionRecord, untoldOf } from "../../test/helpers/bus.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle } from "../../test/helpers/process.ts";
import { createSessionBus } from "./runtime.ts";
import { type BusStore, createBusStore } from "./store.ts";
import { storedName } from "../../lib/session-files.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the store's two halves", () => {
	test("removes stale sessions, their claims, and expired messages", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1", 100));
		await store.writeMessage("s2", busMessage("100-a", "s2", 100));
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		// Both halves, in the order a heartbeat runs them.
		const { claims } = await store.pruneRecords({
			now: 1_000,
			activeIds: new Set(["s1", "s2"]),
			sessionTtlMs: 500,
		});
		await store.pruneMail({ now: 1_000, messageTtlMs: 500, own: "s1" });
		expect(claims.map((claim) => claim.path)).toEqual(["src/a.ts"]);
		expect(await store.sessions()).toEqual([]);
		expect(await store.claims()).toEqual([]);
		expect(await store.inbox("s2", 10)).toEqual({ messages: [], unreadable: [] });
	});

	test("answers only the claims it removed", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1", 100));
		await store.writeSession(sessionRecord("s2", 900));
		await store.claimAll(["src/old.ts"], "s1", "one", 100);
		await store.claimAll(["src/new.ts"], "s2", "peer", 900);
		const { claims } = await store.pruneRecords({ now: 1_000, activeIds: new Set(["s2"]), sessionTtlMs: 500 });
		// The answer is what an owner is owed a sentence about, so a claim that survived is not in it.
		expect(claims.map((claim) => claim.owner)).toEqual(["s1"]);
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
		await store.pruneMail({ now: 1_000, messageTtlMs: 500, own: "s1" });
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
		await store.pruneMail({ now: 1_000, messageTtlMs: 500, own: "s1" });
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
		expect(await store.claims()).toHaveLength(1);
	});

	test("sweeps its own inbox and the ones nobody holds, and leaves a peer's to that peer", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1", 900));
		await store.writeSession(sessionRecord("s3", 900));
		await store.writeMessage("s1", busMessage("1-old", "s1", 0));
		await store.writeMessage("s3", busMessage("3-old", "s3", 0));
		// No record holds this one, so it is mail nobody owns and any sweep may end it.
		await store.writeMessage("s2", busMessage("2-old", "s2", 0));
		await store.pruneMail({ now: 1_000, messageTtlMs: 500, own: "s1" });
		expect(await untoldOf(dir, "s1")).toBe(0);
		expect(await untoldOf(dir, "s3")).toBe(1);
		expect(await untoldOf(dir, "s2")).toBe(0);
	});

	test("clean takes one inbox and the cutoff a person chose, and answers both counts", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeMessage("s1", busMessage("1-old", "s1", 0));
		await store.writeMessage("s1", busMessage("1-new", "s1", 900));
		await store.writeMessage("s3", busMessage("3-old", "s3", 0));
		// Two facts the TTL sweep does not have: the cutoff is the person's, and the walk is this
		// session's inbox alone — a peer's mail is that peer's to end, held or not.
		const cleared = await store.cleanInbox({ now: 1_000, olderThanMs: 500, own: "s1" });
		expect(cleared).toEqual({ removed: 1, left: 1 });
		expect(await untoldOf(dir, "s1")).toBe(1);
		expect(await untoldOf(dir, "s3")).toBe(1);
	});

	test("clean ends a file it cannot read on the only clock that file has", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeMessage("s1", busMessage("1-old", "s1", 0));
		const inbox = join(dir, "inbox", storedName("s1"));
		await writeFile(join(inbox, "100-junk.json"), "{");
		// No readable `at`, so the mtime is the clock: a file this build cannot parse is still
		// ended by a cutoff instead of sitting in the inbox forever.
		await utimes(join(inbox, "100-junk.json"), 1, 1);
		const cleared = await store.cleanInbox({ now: 1_000_000, olderThanMs: 500, own: "s1" });
		expect(cleared).toEqual({ removed: 2, left: 0 });
		expect(await readdir(join(dir, "inbox"))).toEqual([]);
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
		expect(await untoldOf(dir, "h1")).toBe(1);

		for (const tick of ticks) tick();
		for (let attempt = 0; attempt < 100 && (await untoldOf(dir, "h1")) > 0; attempt += 1) await settle(2);
		expect(await untoldOf(dir, "h1")).toBe(0);
		await session.stop();
	});

	test("a record that cannot be written says so once, and once when the beat returns", async () => {
		const dir = temps.track(tempDir("pi-session-bus-"));
		const ticks: Array<() => void> = [];
		const lines: string[] = [];
		const base = createBusStore({ dir });
		// The store fails whole ticks while this holds, so the streak is the test's to end.
		const broken = { on: false };
		const store: BusStore = {
			...base,
			async writeSession(target) {
				if (broken.on) throw new Error("disk full");
				await base.writeSession(target);
			},
		};
		const session = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 10,
			watchMs: 0,
			alive: () => true,
			startTokenFn: () => "started-here",
			store,
			stderr: (line) => lines.push(line),
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		await session.start(
			fakeCtx({ cwd: "/repo", sessionId: "h1", sessionName: "live", mode: "tui", hasUI: true }).ctx as ExtensionContext,
		);
		await session.join({ listen: false });
		broken.on = true;
		const tick = ticks[0] as () => void;

		// Two failing ticks are one line: the streak is the fact, never the tick.
		tick();
		await settle(20);
		expect(lines).toEqual(["session-bus: heartbeat failed: disk full\n"]);
		tick();
		await settle(20);
		expect(lines).toHaveLength(1);

		// The third writes, so the whole tick finishes and the beat says it is back.
		broken.on = false;
		tick();
		await settle(20);
		expect(lines).toEqual(["session-bus: heartbeat failed: disk full\n", "session-bus: heartbeat recovered\n"]);

		// And a healthy tick after that is ordinary: one line per transition, not per tick.
		tick();
		await settle(20);
		expect(lines).toHaveLength(2);
		await session.stop();
	});
});

/**
 * The one message the bus sends without being asked.
 *
 * A lapsed claim is the only loss a prune leaves behind that its owner cannot see: the row and the
 * mail come back, and the path is a peer's to take. Both cases drive a real session's action, because
 * the notice is written by whatever pruned — the sentence a session wakes up to is this call.
 */
describe("the lapse's notice", () => {
	async function runningSession(
		dir: string,
		clock: { now: number },
	): Promise<Awaited<ReturnType<typeof createSessionBus>>> {
		const session = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => clock.now,
			heartbeatMs: 0,
			watchMs: 0,
			sessionTtlMs: 500,
			alive: () => true,
			startTokenFn: () => "started-here",
		});
		await session.start(
			fakeCtx({ cwd: "/repo", sessionId: "h1", sessionName: "live", mode: "tui", hasUI: true }).ctx as ExtensionContext,
		);
		await session.join({ listen: false });
		return session;
	}

	test("mails the session whose claim lapsed, and only it", async () => {
		const dir = temps.track(tempDir("pi-session-bus-"));
		const clock = { now: 1_000 };
		const session = await runningSession(dir, clock);
		const store = createBusStore({ dir });
		// A peer that stopped beating holds a path; a live one holds another across the same prune.
		await store.writeSession(sessionRecord("s2", 100));
		await store.claimAll(["src/lapsed.ts"], "s2", "peer", 100);
		clock.now += 1_000;
		await store.writeSession(sessionRecord("s3", clock.now));
		await store.claimAll(["src/kept.ts"], "s3", "other", clock.now);

		await session.claim(["src/mine.ts"]);

		const notice = await store.inbox("s2", 10);
		expect(notice.messages).toHaveLength(1);
		expect(notice.messages[0].from).toBe("h1");
		expect(notice.messages[0].to).toBe("s2");
		expect(notice.messages[0].text).toContain("src/lapsed.ts");
		expect(notice.messages[0].text).not.toContain("src/kept.ts");
		expect(await store.inbox("s3", 10)).toEqual({ messages: [], unreadable: [] });
		await session.stop();
	});

	test("leaves another machine's claim to that machine's mail", async () => {
		const dir = temps.track(tempDir("pi-session-bus-"));
		const clock = { now: 1_000 };
		const session = await runningSession(dir, clock);
		const elsewhere = createBusStore({ dir, host: "elsewhere" });
		await elsewhere.writeSession(sessionRecord("s9", 100));
		await elsewhere.claimAll(["src/remote.ts"], "s9", "far", 100);

		clock.now += 1_000;
		await session.claim(["src/mine.ts"]);

		// The claim lapsed on that machine's heartbeat, so nothing here may announce it.
		const store = createBusStore({ dir });
		expect((await store.claims()).map((claim) => claim.path)).not.toContain("src/remote.ts");
		expect(await store.inbox("s9", 10)).toEqual({ messages: [], unreadable: [] });
		await session.stop();
	});
});
