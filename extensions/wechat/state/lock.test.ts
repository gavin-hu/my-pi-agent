/**
 * The poller lock: who may poll one account, and what happens when two sessions
 * start together.
 *
 * Split out of the peer suite rather than grown there — it is one module's
 * behaviour, and the peer suite is a named height that may only fall.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import type { RepeatTimer } from "../../../lib/timer.ts";
import {
	acquireLock,
	DEFAULT_STALE_MS,
	type LockDeps,
	type LockInfo,
	readLock,
	refreshLock,
	releaseLock,
	startLockHeartbeat,
} from "./lock.ts";

describe("poller lock", () => {
	function newPath(): string {
		return join(tempDir("wechat-lock-"), "poller.lock");
	}

	function lockDeps(overrides: Partial<LockDeps> = {}): LockDeps {
		return { now: () => 1000, pid: 1, isAlive: () => true, staleMs: 100, ...overrides };
	}

	/**
	 * A rival session that lands its own record at the instant before our write.
	 *
	 * That instant is the whole race: a read-then-write cannot tell it happened,
	 * while an exclusive create can. `now` is the last seam ahead of the write.
	 */
	function rivalFirst(path: string, rival: LockInfo): () => number {
		let first = true;
		return () => {
			if (first) {
				first = false;
				writeFileSync(path, JSON.stringify(rival), "utf-8");
			}
			return 1000;
		};
	}

	test("acquires when no lock exists, and refuses the next session", () => {
		const path = newPath();
		expect(acquireLock(path, lockDeps())).toBe(true);
		expect(acquireLock(path, lockDeps({ pid: 2 }))).toBe(false);
		expect(readLock(path)).toEqual({ pid: 1, at: 1000 });
	});

	test("does not block the same pid", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(acquireLock(path, lockDeps())).toBe(true);
	});

	test("takes over when the holder pid is dead", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(acquireLock(path, lockDeps({ pid: 2, isAlive: () => false }))).toBe(true);
		expect(readLock(path)).toEqual({ pid: 2, at: 1000 });
	});

	test("takes over a stale lock", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(acquireLock(path, lockDeps({ pid: 2, now: () => 5000 }))).toBe(true);
		expect(readLock(path)).toEqual({ pid: 2, at: 5000 });
	});

	test("takes over a corrupt lockfile", () => {
		const path = newPath();
		writeFileSync(path, "{ broken", "utf-8");
		expect(acquireLock(path, lockDeps())).toBe(true);
		expect(readLock(path)).toEqual({ pid: 1, at: 1000 });
	});

	test("a rival that creates the file first wins, and its record survives", () => {
		const path = newPath();
		const deps = lockDeps({ now: rivalFirst(path, { pid: 2, at: 990 }) });
		expect(acquireLock(path, deps)).toBe(false);
		expect(readLock(path)).toEqual({ pid: 2, at: 990 });
	});

	test("takes over a stale record that lands just before the write", () => {
		const path = newPath();
		const deps = lockDeps({ now: rivalFirst(path, { pid: 2, at: 0 }) });
		expect(acquireLock(path, deps)).toBe(true);
		expect(readLock(path)).toEqual({ pid: 1, at: 1000 });
	});

	test("a rival that replaces a stale record before the clean-up keeps it", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ pid: 2, at: 0 }), "utf-8");
		let calls = 0;
		const deps = lockDeps({
			now: () => {
				calls += 1;
				// The second question is "is that record stale?": by then a rival has taken
				// the file over, and its record is live, so the stale one is not ours to remove.
				if (calls === 2) writeFileSync(path, JSON.stringify({ pid: 3, at: 990 }), "utf-8");
				return 1000;
			},
		});
		expect(acquireLock(path, deps)).toBe(false);
		expect(readLock(path)).toEqual({ pid: 3, at: 990 });
	});

	test("the last attempt leaves the stale record rather than unowning the account", () => {
		const path = newPath();
		// A rival that puts the same stale record back every time: each attempt finds it,
		// and the final one has no create left to make, so it must not clear the file.
		const deps = lockDeps({
			now: () => {
				writeFileSync(path, JSON.stringify({ pid: 9, at: 0 }), "utf-8");
				return 1000;
			},
		});
		expect(acquireLock(path, deps)).toBe(false);
		expect(readLock(path)).toEqual({ pid: 9, at: 0 });
	});

	test("only the owner's release removes the lock", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		releaseLock(path, 2);
		// pid 2 did not own the lock, so the file is still there for its owner.
		expect(readLock(path)).toEqual({ pid: 1, at: 1000 });
		releaseLock(path, 1);
		expect(readLock(path)).toBeUndefined();
		expect(acquireLock(path, lockDeps({ pid: 3 }))).toBe(true);
	});

	test("refresh re-stamps its own record by rename, leaving no temp file", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(refreshLock(path, lockDeps({ now: () => 1500 }))).toBe(true);
		expect(readLock(path)).toEqual({ pid: 1, at: 1500 });
		expect(readdirSync(dirname(path))).toEqual(["poller.lock"]);
	});

	test("a refresh does not overwrite a record a takeover replaced, and says it lost", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		// pid 2 took the account over while this process was quiet; its record is live
		// (50 ms old against a 100 ms bar, so the staleness branch is not what decides).
		writeFileSync(path, JSON.stringify({ pid: 2, at: 1250 }), "utf-8");
		expect(refreshLock(path, lockDeps({ now: () => 1300 }))).toBe(false);
		expect(readLock(path)).toEqual({ pid: 2, at: 1250 });
	});

	test("a refresh re-acquires a lock that was released under it", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		releaseLock(path, 1);
		expect(refreshLock(path, lockDeps({ now: () => 1400 }))).toBe(true);
		expect(readLock(path)).toEqual({ pid: 1, at: 1400 });
	});

	/**
	 * A repeating timer a test drives by hand, so no case waits for a beat.
	 *
	 * The interval is recorded rather than assumed: the bar has to be wider than it, and
	 * that is the one relation the module cannot restate from inside the fake.
	 */
	function fakeTicker() {
		const timer: { interval: number; beat?: () => void; stopped: boolean } = { interval: 0, stopped: false };
		return {
			timer,
			every: ((ms, tick) => {
				timer.interval = ms;
				timer.beat = tick;
				return () => {
					timer.stopped = true;
				};
			}) satisfies RepeatTimer,
		};
	}

	test("a holder that beats is not taken over, and one that stops beating is", () => {
		// One attempt is longer than the bar — a long-poll hold, then a batch whose media is
		// still downloading — so the record is re-stamped between attempts. What the bar has to
		// survive is a rival that looks a whole interval after the last beat.
		const path = newPath();
		let now = 1000;
		const deps = lockDeps({ now: () => now, staleMs: DEFAULT_STALE_MS });
		const rival = () => acquireLock(path, lockDeps({ pid: 2, now: () => now, staleMs: DEFAULT_STALE_MS }));
		const { timer, every } = fakeTicker();
		const stop = startLockHeartbeat(() => {
			refreshLock(path, deps);
		}, every);
		expect(acquireLock(path, deps)).toBe(true);
		expect(timer.interval).toBeLessThan(DEFAULT_STALE_MS);

		for (let beats = 0; beats < 5; beats += 1) {
			now += timer.interval;
			expect(rival()).toBe(false);
			timer.beat?.();
		}

		stop();
		expect(timer.stopped).toBe(true);
		// A poller that stopped beating is what a crash leaves, so the bar decides again.
		now += DEFAULT_STALE_MS + 1;
		expect(rival()).toBe(true);
	});

	test("a beat that throws is dropped rather than left to the timer", () => {
		// An uncaught throw in a timer's callback takes the process down. A record that could
		// not be stamped then ages out on its own, which is what the bar is for.
		const { timer, every } = fakeTicker();
		const stop = startLockHeartbeat(() => {
			throw new Error("EACCES: the state dir is read-only");
		}, every);
		expect(() => timer.beat?.()).not.toThrow();
		stop();
	});
});
