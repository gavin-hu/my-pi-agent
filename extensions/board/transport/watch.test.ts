/**
 * The directory seam: one change per burst, a window that a close cancels, and a directory
 * that cannot be watched named by its absence rather than by a throw.
 *
 * The writes are real — a card is a file, and the point of the seam is the platform event —
 * but the window is injected, so a case fires it instead of waiting 100 ms and hoping the
 * event beat the assertion.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArmTimer } from "../../../lib/timer.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { settle } from "../../../test/helpers/process.ts";
import { COALESCE_MS, defaultWatchDirs } from "./watch.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A pile of cards under a temp root the suite removes. */
function pile(): string {
	const dir = join(temps.track(tempDir("pi-board-watch-")), "cards");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** A coalescing window the case fires by hand: the event is real, the timer is not. */
function windows() {
	const arms: { fire: () => void; cancelled: boolean; ms: number }[] = [];
	const timer: ArmTimer = (ms, fn) => {
		const arm = { ms, fire: fn, cancelled: false };
		arms.push(arm);
		return () => {
			arm.cancelled = true;
		};
	};
	return { timer, arms };
}

/**
 * Keep saving into the pile until the watch hears one.
 *
 * FSEvents starts its stream asynchronously, so a write that lands in the first
 * milliseconds after `watch()` on a loaded machine can be missed by the platform rather
 * than by the seam — which is also what a second save does. The case is that a write
 * reaches the seam; the platform's promise about the very first one is not the subject.
 */
async function writeUntilHeard(dir: string, arms: readonly unknown[]): Promise<void> {
	for (let attempt = 0; attempt < 200 && arms.length === 0; attempt++) {
		writeFileSync(join(dir, `${attempt}.json`), "{}");
		if (arms.length === 0) await settle(25);
	}
	if (arms.length === 0) throw new Error("the platform reported no write within five seconds");
}

describe("the cards directory watch", () => {
	test("folds a burst of writes into one change", async () => {
		const dir = pile();
		const { timer, arms } = windows();
		const changes: number[] = [];
		const handle = defaultWatchDirs([dir], () => changes.push(1), { timer });
		expect(handle).toBeDefined();
		// One write is several events — a temp file, a rename, an unlink — and the first one
		// opens the window that the rest join.
		await writeUntilHeard(dir, arms);
		writeFileSync(join(dir, "next.json"), "{}");
		writeFileSync(join(dir, "after.json"), "{}");
		expect(arms.length).toBe(1);
		expect(arms[0]?.ms).toBe(COALESCE_MS);
		arms[0]?.fire();
		expect(changes.length).toBe(1);
		handle?.stop();
	});

	test("closes the watchers and cancels a window already armed", async () => {
		const dir = pile();
		const { timer, arms } = windows();
		const changes: number[] = [];
		const handle = defaultWatchDirs([dir], () => changes.push(1), { timer });
		await writeUntilHeard(dir, arms);
		handle?.stop();
		expect(arms[0]?.cancelled).toBe(true);
		// Fired anyway, the window has nothing to say: the page it belonged to has closed.
		arms[0]?.fire();
		expect(changes).toEqual([]);
	});

	test("says nothing when not one directory could be watched", () => {
		const missing = join(temps.track(tempDir("pi-board-watch-")), "no-such-pile");
		expect(defaultWatchDirs([missing], () => {})).toBeUndefined();
	});

	test("watches the directory it can open and skips the one it cannot", async () => {
		const dir = pile();
		const gone = join(temps.track(tempDir("pi-board-watch-")), "gone");
		const { timer, arms } = windows();
		const changes: number[] = [];
		const handle = defaultWatchDirs([gone, dir], () => changes.push(1), { timer });
		expect(handle).toBeDefined();
		await writeUntilHeard(dir, arms);
		arms[0]?.fire();
		expect(changes.length).toBe(1);
		handle?.stop();
	});
});
