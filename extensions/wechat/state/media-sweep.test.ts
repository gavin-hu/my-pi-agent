/**
 * The inbound media directory's retention: the files a turn no longer holds are
 * taken away by age, once at a bridge start and again on the tick behind it.
 *
 * The clock and the timer are injected, so nothing here waits on a real interval
 * or a real day; the files are real, written into a temp directory.
 */

import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { emit } from "../../../test/helpers/fakes.ts";
import { startWechat, writeAccount } from "../../../test/helpers/fixtures/wechat.ts";
import type { RepeatTimer } from "../../../lib/timer.ts";
import { pruneMedia } from "../transport/media.ts";
import { createMediaSweep, MEDIA_SWEEP_MS } from "./media-sweep.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The clock a sweep is driven by, so an age in days is a number and not a wait. */
const NOW = Date.UTC(2026, 0, 8);

/** Write `name` in `dir` and stamp its mtime `ageDays` before {@link NOW}. */
function fileIn(dir: string, name: string, ageDays: number): string {
	const path = join(dir, name);
	writeFileSync(path, "bytes");
	const seconds = (NOW - ageDays * DAY_MS) / 1000;
	utimesSync(path, seconds, seconds);
	return path;
}

/** An interval a test ticks by hand, recording the period it was armed with. */
function fakeInterval(): { arm: RepeatTimer; tick: () => void; armed: () => number; periods: number[] } {
	const ticks = new Set<() => void>();
	const periods: number[] = [];
	const arm: RepeatTimer = (ms, tick) => {
		periods.push(ms);
		ticks.add(tick);
		return () => {
			ticks.delete(tick);
		};
	};
	const tick = (): void => {
		for (const run of [...ticks]) run();
	};
	return { arm, tick, armed: () => ticks.size, periods };
}

describe("the age rule", () => {
	test("removes the files past the window and keeps the rest", () => {
		const dir = tempDir("wechat-prune-");
		const old = fileIn(dir, "old.jpg", 8);
		const edge = fileIn(dir, "edge.jpg", 2);
		const fresh = fileIn(dir, "fresh.jpg", 0);

		expect(pruneMedia(dir, 7 * DAY_MS, NOW)).toBe(1);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(edge)).toBe(true);
		expect(existsSync(fresh)).toBe(true);
	});

	test("a window of 0 keeps every file", () => {
		const dir = tempDir("wechat-prune-");
		const old = fileIn(dir, "old.jpg", 400);

		expect(pruneMedia(dir, 0, NOW)).toBe(0);
		expect(existsSync(old)).toBe(true);
	});

	test("a directory that does not exist is not an error, and a subdirectory is not a file", () => {
		const missing = join(tempDir("wechat-prune-"), "media");
		expect(pruneMedia(missing, 7 * DAY_MS, NOW)).toBe(0);

		const dir = tempDir("wechat-prune-");
		const nested = join(dir, "nested");
		mkdirSync(nested);
		const seconds = (NOW - 30 * DAY_MS) / 1000;
		utimesSync(nested, seconds, seconds);
		expect(pruneMedia(dir, 7 * DAY_MS, NOW)).toBe(0);
		expect(existsSync(nested)).toBe(true);
	});
});

describe("the sweep a connection runs", () => {
	/** A sweep over `dir`, with the tick a test drives. */
	function sweepOver(dir: string, options: { days?: number; notices?: string[] } = {}) {
		const timer = fakeInterval();
		const notices = options.notices ?? [];
		const sweep = createMediaSweep({
			mediaDir: () => dir,
			retentionDays: () => options.days ?? 7,
			now: () => NOW,
			notify: (line) => notices.push(line),
			interval: timer.arm,
		});
		return { sweep, timer, notices };
	}

	test("sweeps at the start and again on each tick", () => {
		const dir = tempDir("wechat-prune-");
		const first = fileIn(dir, "first.jpg", 9);
		const { sweep, timer } = sweepOver(dir);

		sweep.start();
		expect(existsSync(first)).toBe(false);
		expect(timer.armed()).toBe(1);
		expect(timer.periods).toEqual([MEDIA_SWEEP_MS]);

		// A file that ages past the window after the start is the tick's to take.
		const later = fileIn(dir, "later.jpg", 9);
		timer.tick();
		expect(existsSync(later)).toBe(false);
		sweep.stop();
	});

	test("stop ends the tick, and a second start does not stack one", () => {
		const dir = tempDir("wechat-prune-");
		const { sweep, timer } = sweepOver(dir);

		sweep.start();
		sweep.start();
		expect(timer.armed()).toBe(1);
		sweep.stop();
		expect(timer.armed()).toBe(0);
	});

	test("says how many went, and says nothing when the window took nothing", () => {
		const dir = tempDir("wechat-prune-");
		fileIn(dir, "a.jpg", 9);
		fileIn(dir, "b.jpg", 9);
		fileIn(dir, "kept.jpg", 1);
		const { sweep, notices } = sweepOver(dir);

		sweep.start();
		expect(notices).toEqual(["Pruned 2 WeChat media files older than 7 days."]);

		// A tick that finds nothing to take leaves the terminal alone.
		const quiet = tempDir("wechat-prune-");
		fileIn(quiet, "kept.jpg", 1);
		const second = sweepOver(quiet);
		second.sweep.start();
		expect(second.notices).toEqual([]);
		second.sweep.stop();
		sweep.stop();
	});

	test("one file reads as one file", () => {
		const dir = tempDir("wechat-prune-");
		fileIn(dir, "only.jpg", 9);
		const { sweep, notices } = sweepOver(dir, { days: 1 });

		sweep.start();
		expect(notices).toEqual(["Pruned 1 WeChat media file older than 1 day."]);
		sweep.stop();
	});
});

describe("a bridge start", () => {
	test("prunes what the last connection left", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const media = join(dir, "wechat", "media");
			mkdirSync(media, { recursive: true });
			const old = fileIn(media, "old.jpg", 30);

			const { fake, ctx, notifications } = await startWechat(dir);
			expect(existsSync(old)).toBe(false);
			expect(notifications.join("\n")).toContain("Pruned 1 WeChat media file older than 7 days.");

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});
});
