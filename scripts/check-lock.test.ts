/**
 * What the gate's machine lock must get right.
 *
 * The lock exists because two gates on one machine starve each other's spawns, so the cases here
 * are the ways it can be wrong: a second gate that does not wait, a dead holder that wedges the
 * machine, a live holder whose file a waiting gate deletes, and a release that removes someone
 * else's claim after a takeover. Every seam is injected, so a case costs no second process and no
 * wall clock.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	type GateHolder,
	acquireGateLock,
	giveUpLine,
	lockPath,
	processAlive,
	readGateLock,
	takeOverLine,
	waitingLine,
	withGateLock,
} from "./check-lock.ts";

const dirs: string[] = [];

/** A temp directory this case owns, removed after it. */
function tempLockDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-check-lock-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A holder as a previous gate would have written it. */
function holder(pid: number, since = 1_000): GateHolder {
	return { pid, path: "/main/.pi/worktrees/other", since };
}

/** A clock and a sleep that costs nothing, so a wait of minutes is asserted in microseconds. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
	let time = 0;
	return {
		now: () => time,
		sleep: async (ms: number) => {
			time += ms;
		},
	};
}

/** The holder a lock file names, or `undefined` when it names none. */
function holderAt(file: string): GateHolder | undefined {
	const reading = readGateLock(file);
	return reading.kind === "holder" ? reading.holder : undefined;
}

describe("the lock file", () => {
	test("lives in the temp directory by default, and in a named one on request", () => {
		expect(lockPath("/tmp/x")).toBe("/tmp/x/my-pi-agent-check.lock");
		expect(lockPath()).toContain("my-pi-agent-check.lock");
	});

	test("reads back what a gate wrote, and tells absent from unreadable", () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		// The distinction matters: an absent lock is a holder that finished, while a file no
		// gate wrote is one nobody can release.
		expect(readGateLock(file)).toEqual({ kind: "absent" });
		writeFileSync(file, `${JSON.stringify(holder(42))}\n`);
		expect(holderAt(file)).toEqual(holder(42));
		writeFileSync(file, "not a lock\n");
		expect(readGateLock(file)).toEqual({ kind: "unreadable" });
		writeFileSync(file, JSON.stringify({ pid: "42", path: "/x", since: 1 }));
		expect(readGateLock(file)).toEqual({ kind: "unreadable" });
	});

	test("counts a process that exists but refuses a signal as alive", () => {
		// The OS answers EPERM for a live process owned by someone else; the seam keeps that
		// reading true without needing a second user on the machine.
		expect(processAlive(process.pid)).toBe(true);
		expect(processAlive(process.pid + 1_000_000)).toBe(false);
	});
});

describe("taking the lock", () => {
	test("takes a free lock immediately and releases it", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		const lock = await acquireGateLock({ dir, pid: 11, path: "/main" });
		expect(lock.held).toBe(true);
		expect(lock.waitedMs).toBe(0);
		expect(holderAt(file)).toMatchObject({ pid: 11, path: "/main" });
		lock.release();
		expect(existsSync(file)).toBe(false);
	});

	test("waits for a live holder, announces it once, and gives up at the bound", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		writeFileSync(file, JSON.stringify(holder(22)));
		const clock = fakeClock();
		const announced: GateHolder[] = [];
		const gaveUp: Array<[GateHolder, number]> = [];
		const lock = await acquireGateLock({
			dir,
			pid: 11,
			waitMs: 2_000,
			pollMs: 500,
			alive: () => true,
			...clock,
			onWait: (waited) => announced.push(waited),
			onGiveUp: (waited, waitedMs) => gaveUp.push([waited, waitedMs]),
		});
		expect(lock.held).toBe(false);
		expect(lock.holder).toEqual(holder(22));
		expect(lock.waitedMs).toBe(2_000);
		expect(announced).toEqual([holder(22)]);
		expect(gaveUp).toEqual([[holder(22), 2_000]]);
		expect(holderAt(file)).toEqual(holder(22));
		lock.release();
		expect(holderAt(file)).toEqual(holder(22));
	});

	test("starts silently when the holder finished while this gate waited", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		writeFileSync(file, JSON.stringify(holder(23)));
		const clock = fakeClock();
		const tookOver: Array<GateHolder | undefined> = [];
		const lock = await acquireGateLock({
			dir,
			pid: 12,
			waitMs: 10_000,
			pollMs: 500,
			alive: () => true,
			now: clock.now,
			// The holder releases the lock between this gate's first look and its second.
			sleep: async (ms) => {
				await clock.sleep(ms);
				rmSync(file, { force: true });
			},
			onTakeOver: (stale) => tookOver.push(stale),
		});
		expect(lock.held).toBe(true);
		expect(lock.tookOver).toBeUndefined();
		expect(tookOver).toEqual([]);
		expect(holderAt(file)).toMatchObject({ pid: 12 });
	});

	test("replaces a lock left by a process that is gone", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		writeFileSync(file, JSON.stringify(holder(33)));
		const tookOver: Array<GateHolder | undefined> = [];
		const lock = await acquireGateLock({
			dir,
			pid: 44,
			alive: () => false,
			onTakeOver: (stale) => tookOver.push(stale),
		});
		expect(lock.held).toBe(true);
		expect(lock.tookOver).toEqual(holder(33));
		expect(tookOver).toEqual([holder(33)]);
		expect(holderAt(file)).toMatchObject({ pid: 44 });
	});

	test("replaces a file it cannot read, because no holder can release that", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		writeFileSync(file, "half-written");
		const tookOver: Array<GateHolder | undefined> = [];
		const lock = await acquireGateLock({ dir, pid: 55, onTakeOver: (stale) => tookOver.push(stale) });
		expect(lock.held).toBe(true);
		expect(tookOver).toEqual([undefined]);
		expect(holderAt(file)).toMatchObject({ pid: 55 });
	});

	test("does not delete a claim that a takeover handed to someone else", async () => {
		const dir = tempLockDir();
		const file = lockPath(dir);
		const lock = await acquireGateLock({ dir, pid: 66 });
		// Another gate took the file over while this one was still running.
		writeFileSync(file, JSON.stringify(holder(77, 5_000)));
		lock.release();
		expect(holderAt(file)).toEqual(holder(77, 5_000));
	});
});

describe("running under the lock", () => {
	test("releases it when the work throws, so a red gate does not wedge the machine", async () => {
		const dir = tempLockDir();
		await expect(
			withGateLock({ dir, pid: 88 }, async () => {
				throw new Error("a phase failed");
			}),
		).rejects.toThrow("a phase failed");
		expect(existsSync(lockPath(dir))).toBe(false);
	});

	test("touches no file when it is skipped", async () => {
		const dir = tempLockDir();
		await withGateLock({ dir, pid: 99, skip: true }, async () => {
			expect(existsSync(lockPath(dir))).toBe(false);
		});
		expect(existsSync(lockPath(dir))).toBe(false);
	});
});

describe("what a gate says while it waits", () => {
	test("names the holder, its checkout, and how long it has had the machine", () => {
		expect(waitingLine(holder(1234, 1_000), 13_000)).toBe(
			"check: another check is running (pid 1234, /main/.pi/worktrees/other, 12s); waiting",
		);
	});

	test("says which pid it replaced, or that the file was unreadable", () => {
		expect(takeOverLine(holder(1234))).toContain("pid 1234");
		expect(takeOverLine(undefined)).toContain("unreadable");
	});

	test("warns that a spawn may be starved once the wait ran out", () => {
		expect(giveUpLine(holder(1234), 600_000)).toContain("waited 600s");
		expect(giveUpLine(holder(1234), 600_000)).toContain("starved");
	});
});
