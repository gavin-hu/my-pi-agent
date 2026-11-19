/**
 * The gate's queue: one lock per repository, and the behaviours a pane depends on.
 *
 * These cases never run the gate they guard — the lock is the subject, so it is driven directly
 * with a temp root as its scope and a fake clock. A second gate is represented by another live
 * process's pid in the file, because two `acquireGate` calls in *this* process are a nested run by
 * definition and correctly do not queue.
 *
 * What they pin is what a waiting pane relies on: it says who holds the box and for how long, it
 * keeps saying it while it waits, it refuses at the cap rather than hanging, it takes back a lock a
 * killed run left, and it never waits on itself.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquireGate, GATE_PREFIX, gateLockPath, type GateHolder } from "./gate-lock.ts";

const roots: string[] = [];

/** Another live process, standing in for the pane that holds the box. */
const OTHER = process.ppid;

beforeEach(() => {
	// A gate that runs these suites sets the marker for its children, and these cases are about
	// acquiring: inheriting it would turn every one of them into the nested run they also pin.
	delete process.env.PI_GATE_HELD;
});

afterEach(() => {
	// A case that took the lock leaves the marker on the process; the next case must not inherit it.
	delete process.env.PI_GATE_HELD;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A directory that is its own lock scope: not a repository, so `cwd` decides the path. */
function root(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-gate-lock-"));
	roots.push(dir);
	return dir;
}

/** Leave a lock behind, as a holder that is still running would. */
function heldByOther(cwd: string): string {
	const path = gateLockPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const holder: GateHolder = { pid: OTHER, startedAt: new Date(0).toISOString() };
	writeFileSync(path, JSON.stringify(holder));
	return path;
}

/** A process that has certainly exited, so the lock it "left" names a dead pid. */
function deadPid(): number {
	const finished = spawnSync(process.execPath, ["-e", ""]);
	return finished.pid ?? 999_999;
}

describe("the gate's lock", () => {
	test("records who holds it, and gives it back", () => {
		const cwd = root();
		const lock = acquireGate({ cwd, log: () => {} });
		expect(lock).toBeDefined();
		const path = gateLockPath(cwd);
		const held = JSON.parse(readFileSync(path, "utf-8")) as GateHolder;
		expect(held.pid).toBe(process.pid);
		expect(Number.isNaN(Date.parse(held.startedAt))).toBe(false);
		lock?.release();
		lock?.release();
		expect(() => readFileSync(path, "utf-8")).toThrow();
	});

	test("waits for the holder and lands once it is given back", () => {
		const cwd = root();
		const path = heldByOther(cwd);
		const lines: string[] = [];
		let ticks = 0;
		const lock = acquireGate({
			cwd,
			waitMs: 60_000,
			log: (line) => lines.push(line),
			// The wait's own tick is where the other pane finishes, so nothing sleeps for real.
			sleep: () => {
				if (ticks++ === 0) rmSync(path, { force: true });
			},
		});
		expect(lock).toBeDefined();
		expect(lock?.holder.pid).toBe(process.pid);
		expect(lines.some((line) => line.includes("waiting for pid " + OTHER))).toBe(true);
		lock?.release();
	});

	test("says who holds it and refuses at the cap instead of hanging", () => {
		const cwd = root();
		const path = heldByOther(cwd);
		const lines: string[] = [];
		expect(() => acquireGate({ cwd, waitMs: 0, log: (line) => lines.push(line), pollMs: 0 })).toThrow(
			/is still held by pid .*nothing ran.*Delete that file/i,
		);
		// The refusal names the file a person has to clear, and it leaves the holder's lock alone.
		expect(lines[0]).toContain(GATE_PREFIX);
		expect(lines[0]).toContain(path);
		expect((JSON.parse(readFileSync(path, "utf-8")) as GateHolder).pid).toBe(OTHER);
	});

	test("takes back the lock a killed run left, and says so", () => {
		const cwd = root();
		const path = gateLockPath(cwd);
		mkdirSync(dirname(path), { recursive: true });
		const left: GateHolder = { pid: deadPid(), startedAt: new Date(0).toISOString() };
		writeFileSync(path, JSON.stringify(left));
		const lines: string[] = [];
		const lock = acquireGate({ cwd, log: (line) => lines.push(line) });
		expect(lock).toBeDefined();
		expect(lines.some((line) => line.includes("reclaiming the lock pid " + left.pid + " left"))).toBe(true);
		expect((JSON.parse(readFileSync(path, "utf-8")) as GateHolder).pid).toBe(process.pid);
		lock?.release();
	});

	test("keeps saying it is waiting, with the cap in the line", () => {
		const cwd = root();
		const path = heldByOther(cwd);
		let clock = 1_000_000;
		const lines: string[] = [];
		let ticks = 0;
		const lock = acquireGate({
			cwd,
			now: () => clock,
			reportMs: 1_000,
			waitMs: 600_000,
			pollMs: 250,
			log: (line) => lines.push(line),
			sleep: (ms) => {
				clock += ms;
				if (++ticks === 6) rmSync(path, { force: true });
			},
		});
		expect(lock).toBeDefined();
		const waiting = lines.filter((line) => line.includes("waiting for pid"));
		// One line and then silence is the hang this lock exists to prevent, so it repeats.
		expect(waiting.length).toBeGreaterThanOrEqual(2);
		expect(waiting[0]).toContain("left before this gives up on");
		lock?.release();
	});

	test("gives every root its own lock", () => {
		expect(gateLockPath(root())).not.toBe(gateLockPath(root()));
	});

	test("does not queue a run nested in the one that holds the gate", () => {
		const cwd = root();
		process.env.PI_GATE_HELD = "1";
		expect(acquireGate({ cwd, log: () => {} })).toBeUndefined();
		expect(() => readFileSync(gateLockPath(cwd), "utf-8")).toThrow();
	});
});
