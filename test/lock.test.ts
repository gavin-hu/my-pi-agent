/**
 * The machine's one test-run lock, driven through its seams.
 *
 * No case starts a second process: `dir`, `pid`, `alive`, `now` and `sleep` are injected, so a
 * waiting run, a dead holder and a give-up are all answerable here. The preload holds the real lock
 * while this suite runs, which is why every case passes its own directory.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	acquireTestLock,
	LOCK_STALE_AFTER_MS,
	LOCK_WAIT_MS,
	lockPath,
	processAlive,
	readLock,
	giveUpLine,
	takeOverLine,
	waitingLine,
} from "./helpers/lock.ts";

/** A private directory, cleaned up by the caller. */
function directory(): string {
	return mkdtempSync(join(tmpdir(), "test-lock-"));
}

/** A clock and a sleep that advance together, so a bounded wait costs no wall time. */
function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
	let at = 0;
	return { now: () => at, sleep: async (ms: number) => void (at += ms) };
}

describe("the claim", () => {
	test("is taken, recorded, and released", async () => {
		const dir = directory();
		const lock = await acquireTestLock({ dir, pid: 111, path: "/repo", env: {} });
		expect(lock.held).toBe(true);
		expect(readLock(lockPath(dir))).toEqual({
			kind: "holder",
			holder: { pid: 111, path: "/repo", since: expect.any(Number), root: expect.any(Number) },
		});
		lock.release();
		expect(readLock(lockPath(dir))).toEqual({ kind: "absent" });
		lock.release();
		rmSync(dir, { recursive: true, force: true });
	});

	test("removes only its own file, so a later holder keeps the machine", async () => {
		const dir = directory();
		const first = await acquireTestLock({ dir, pid: 111, env: {} });
		// A second run sees a live holder it cannot take; the first's release must not unlink a file
		// that a third process has since claimed.
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 222, path: "/other", since: 1 })}\n`);
		first.release();
		expect(readLock(lockPath(dir))).toEqual({ kind: "holder", holder: { pid: 222, path: "/other", since: 1 } });
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("a run that is not the first", () => {
	test("a `--parallel` worker shares the machine its own run already holds", async () => {
		const dir = directory();
		// The holder is this run's sibling: `bun test --parallel` spawns its workers itself, so the
		// process that claimed the file and this one share a parent and nothing else.
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 999, path: "/run", since: 5, root: 500 })}\n`);
		const waited: number[] = [];
		// A bounded wait over an advancing clock, so a regression reddens in a millisecond rather than
		// queueing behind the fixture for the real ten minutes.
		const { now, sleep } = clock();
		const lock = await acquireTestLock({
			dir,
			pid: 111,
			env: {},
			root: 500,
			worker: true,
			// A live sibling: without this the fixture's pid is a dead process, and the case would be
			// testing the takeover path instead of the shared-run path. The clock starts inside the
			// staleness window for the same reason.
			alive: () => true,
			now: () => 1_000 + now(),
			sleep,
			waitMs: 2_000,
			onWait: (holder) => waited.push(holder.pid),
		});
		// Not held, because the invocation's machine is already ours: waiting here would queue the run
		// behind itself for the whole LOCK_WAIT_MS.
		expect(lock.held).toBe(false);
		expect(waited).toEqual([]);
		// A skip releases nothing, so the sibling's record is left exactly as it was.
		lock.release();
		expect(readLock(lockPath(dir))).toEqual({
			kind: "holder",
			holder: { pid: 999, path: "/run", since: 5, root: 500 },
		});
		rmSync(dir, { recursive: true, force: true });
	});

	test("a worker of another run still queues, and so does a same-root caller that is no worker", async () => {
		const dir = directory();
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 999, path: "/other", since: 5, root: 700 })}\n`);
		const waited: string[] = [];
		// One clock for both callers: `now` and `sleep` must advance together or the bound is never
		// reached, and a hot poll loop is what an inconsistent pair buys.
		const { now, sleep } = clock();
		// Another invocation's worker: a different parent, so it waits out the bound like any pane.
		const other = await acquireTestLock({
			dir,
			pid: 111,
			env: {},
			root: 600,
			worker: true,
			now,
			sleep,
			waitMs: 2_000,
			alive: () => true,
			onWait: (holder) => waited.push(`worker:${holder.pid}`),
			onGiveUp: (holder) => waited.push(`give-up:${holder.pid}`),
		});
		expect(other.held).toBe(false);
		expect(waited).toEqual(["worker:999", "give-up:999"]);
		// A shell that launches two runs shares their parent, and the second is still a second run.
		const sibling = await acquireTestLock({
			dir,
			pid: 112,
			env: {},
			root: 700,
			worker: false,
			now,
			sleep,
			waitMs: 2_000,
			alive: () => true,
			onWait: (holder) => waited.push(`sibling:${holder.pid}`),
		});
		expect(sibling.held).toBe(false);
		expect(waited).toContain("sibling:999");
		rmSync(dir, { recursive: true, force: true });
	});
	test("announces a live holder once, then takes over when it dies", async () => {
		const dir = directory();
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 999, path: "/other", since: 5 })}\n`);
		const waited: number[] = [];
		const takenOver: number[] = [];
		const { now, sleep } = clock();
		let polls = 0;
		const lock = await acquireTestLock({
			dir,
			pid: 111,
			env: {},
			now,
			sleep,
			alive: () => ++polls < 3,
			onWait: (holder) => waited.push(holder.pid),
			onTakeOver: () => takenOver.push(1),
		});
		expect(lock.held).toBe(true);
		// One announcement however many polls it waited through.
		expect(waited).toEqual([999]);
		// A dead holder is the ordinary path — the record a finished run leaves behind — so the takeover
		// is silent; only a file no run wrote earns a line.
		expect(takenOver).toEqual([]);
		lock.release();
		rmSync(dir, { recursive: true, force: true });
	});

	test("waits out the bound and then runs beside the holder, saying so", async () => {
		const dir = directory();
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 999, path: "/other", since: 0 })}\n`);
		const { now, sleep } = clock();
		let gaveUpAt = -1;
		const lock = await acquireTestLock({
			dir,
			pid: 111,
			env: {},
			now,
			sleep,
			alive: () => true,
			waitMs: 3_000,
			pollMs: 1_000,
			onGiveUp: (_holder, waitedMs) => (gaveUpAt = waitedMs),
		});
		expect(lock.held).toBe(false);
		expect(gaveUpAt).toBeGreaterThanOrEqual(3_000);
		// The file is the holder's, not ours, so our release leaves it alone.
		lock.release();
		expect(readLock(lockPath(dir)).kind).toBe("holder");
		rmSync(dir, { recursive: true, force: true });
	});

	test("calls a record stale when its pid outlives it, which is what pid reuse looks like", async () => {
		const dir = directory();
		const { now, sleep } = clock();
		// Alive by pid, but the holder has not refreshed its record in longer than the heartbeat allows.
		writeFileSync(lockPath(dir), `${JSON.stringify({ pid: 999, path: "/other", since: -LOCK_STALE_AFTER_MS - 1 })}\n`);
		const lock = await acquireTestLock({ dir, pid: 111, env: {}, now, sleep, alive: () => true });
		expect(lock.held).toBe(true);
		lock.release();
		rmSync(dir, { recursive: true, force: true });
	});

	test("replaces a file no run wrote rather than waiting on something that cannot release", async () => {
		const dir = directory();
		writeFileSync(lockPath(dir), "not a lock\n");
		let takenOver = 0;
		const lock = await acquireTestLock({ dir, pid: 111, env: {}, onTakeOver: () => takenOver++ });
		expect(lock.held).toBe(true);
		expect(takenOver).toBe(1);
		lock.release();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("the escapes", () => {
	test("PI_NO_LOCK skips the lock and writes nothing", async () => {
		const dir = directory();
		const lock = await acquireTestLock({ dir, env: { PI_NO_LOCK: "1" } });
		expect(lock.held).toBe(false);
		expect(readLock(lockPath(dir))).toEqual({ kind: "absent" });
		rmSync(dir, { recursive: true, force: true });
	});

	test("a holder marks its children, so a worker does not wait on its own parent", async () => {
		const parent = directory();
		const held = await acquireTestLock({ dir: parent, pid: 111, env: {} });
		expect(held.held).toBe(true);
		// The child inherits the environment the holder wrote to.
		const child = await acquireTestLock({ dir: parent, pid: 222, env: process.env });
		expect(child.held).toBe(false);
		held.release();
		rmSync(parent, { recursive: true, force: true });
	});
});

describe("the lines a run prints", () => {
	test("name the holder, the wait, and what to do about it", () => {
		const holder = { pid: 41207, path: "/repo", since: 1_000 };
		expect(waitingLine(holder, 35_000)).toBe(
			"test lock: waiting for pid 41207 (/repo, 34s) — a second run on this machine starves the first one's spawns",
		);
		expect(takeOverLine()).toContain("no run wrote");
		// The give-up is the one outcome where two runs believe they are alone, so it names the lapse
		// and the two things a reader can do rather than reporting a wait.
		const lapsed = giveUpLine(holder, 600_000);
		expect(lapsed).toContain("the one-run guarantee has lapsed");
		expect(lapsed).toContain("PI_NO_LOCK=1");
	});

	test("a bound is generous enough for a gated run and short enough to notice", () => {
		expect(LOCK_WAIT_MS).toBe(10 * 60_000);
	});
});

describe("process liveness", () => {
	test("answers for this process and for a pid that cannot be running", () => {
		expect(processAlive(process.pid)).toBe(true);
		// 2**22 is above macOS's default maximum pid, so the OS answers ESRCH.
		expect(processAlive(4_194_304)).toBe(false);
	});

	test("reads a holder it wrote, and nothing else", () => {
		const dir = directory();
		const file = lockPath(dir);
		expect(readLock(file)).toEqual({ kind: "absent" });
		writeFileSync(file, `${JSON.stringify({ pid: 1, path: "/x", since: 2 })}\n`);
		expect(readLock(file)).toEqual({ kind: "holder", holder: { pid: 1, path: "/x", since: 2 } });
		writeFileSync(file, `${JSON.stringify({ pid: "1" })}\n`);
		expect(readLock(file)).toEqual({ kind: "unreadable" });
		expect(readFileSync(file, "utf-8")).toContain('"1"');
		rmSync(dir, { recursive: true, force: true });
	});
});
