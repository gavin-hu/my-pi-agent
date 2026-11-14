/**
 * The page's snapshot between frames: the pile is read again only when the cards directory moved.
 *
 * A frame is asked for on every watch event, on the sweep, and — with no watch to arm — every
 * second, and each one used to read and parse every card file. Most of a sweep's facts do change
 * without a card write (the roster, the mail queue, a plan removed, the clock), which is why the
 * cache is over the pile and nothing else. These cases are the whole of that rule: what is reused,
 * what is not, and that a reused pile still draws a frame that moves.
 *
 * It is its own suite because the capability is the snapshot's: `plan-gone.test.ts` covers one
 * uncached fact through the same frame, and `page.test.ts` the lifecycle above it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardStore } from "../../lib/board/store.ts";
import { UNWRITTEN_MS } from "../../lib/board/round.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { drawnOf } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSnapshot, PILE_RESYNC_FRAMES } from "./snapshot.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;
const ME = { id: "s-lead", label: "billing-lead" };

/** A store that says how many times the pile was read, which is what this suite is about. */
function counted(store: BoardStore): { store: BoardStore; reads: () => number } {
	let reads = 0;
	return {
		store: {
			...store,
			scan: async () => {
				reads += 1;
				return store.scan();
			},
		},
		reads: () => reads,
	};
}

/** One page's snapshot over a real board, with a clock the case moves. */
async function page() {
	const board = boardHarness({ now: NOW, track: temps.track });
	const store = await board.runtime.store(board.cwd);
	const { store: watched, reads } = counted(store);
	const clock = { at: NOW };
	const snapshot = createSnapshot({
		store: watched,
		actor: () => ME,
		now: () => clock.at,
		roster: async () => undefined,
		busDir: async () => join(board.cwd, "no-bus"),
	});
	return { board, store, snapshot, reads, clock };
}

describe("the page's snapshot", () => {
	test("reads the pile once while nothing is written", async () => {
		const next = await page();
		const card = await next.store.create({ title: "One", paths: [] }, ME, NOW);
		const first = await next.snapshot.view();
		const second = await next.snapshot.view();
		// One read for the first frame, and none for the second: a frame with nothing written asks the
		// directory, not the pile.
		expect(next.reads()).toBe(1);
		expect(drawnOf(first, card.id)?.title).toBe("One");
		expect(drawnOf(second, card.id)?.title).toBe("One");
	});

	test("reads it again when a card is written", async () => {
		const next = await page();
		await next.store.create({ title: "One", paths: [] }, ME, NOW);
		await next.snapshot.view();
		const second = await next.store.create({ title: "Two", paths: [] }, ME, NOW);
		const after = await next.snapshot.view();
		// A write lands as a temp file renamed inside `cards/`, so the directory moved and the frame
		// reads the pile it now holds.
		expect(drawnOf(after, second.id)?.title).toBe("Two");
	});

	test("reads it again once a run of frames has passed, whatever the directory says", async () => {
		const next = await page();
		await next.store.create({ title: "One", paths: [] }, ME, NOW);
		await next.snapshot.view();
		const reads = next.reads();
		// Nothing is written, so the stamp holds still — the state a filesystem whose mtime is coarser
		// than a write leaves the page in, with every later frame asking the same question. The bound is
		// what ends it: one frame past the run, the pile is read again.
		for (let frame = 0; frame < PILE_RESYNC_FRAMES + 1; frame += 1) await next.snapshot.view();
		expect(next.reads()).toBe(reads + 1);
	});

	test("draws a plan that was removed, on a pile it did not re-read", async () => {
		const next = await page();
		const planDir = await next.board.runtime.planDir(next.board.cwd);
		mkdirSync(planDir, { recursive: true });
		const path = join(planDir, "webhook.md");
		writeFileSync(path, "# Plan\n");
		const card = await next.store.create({ title: "Planned", paths: [] }, ME, NOW);
		await advance(next.store, card.id, "execute", { owner: ME, planPath: path }, NOW);
		const before = await next.snapshot.view();
		expect(drawnOf(before, card.id)?.planGone).toBeUndefined();
		const reads = next.reads();

		// A plan is a file outside the pile: removing it writes no card, so the stamp holds still.
		rmSync(path, { force: true });
		const after = await next.snapshot.view();
		expect(next.reads()).toBe(reads);
		expect(drawnOf(after, card.id)?.planGone).toBe(true);
		expect(after.sig).not.toBe(before.sig);
	});

	test("still ages the cards it did not re-read", async () => {
		const next = await page();
		const planDir = await next.board.runtime.planDir(next.board.cwd);
		mkdirSync(planDir, { recursive: true });
		const path = join(planDir, "age.md");
		writeFileSync(path, "# Plan\n");
		const card = await next.store.create({ title: "Quiet", paths: [] }, ME, NOW);
		// `execute` is the lane the rollup's clock speaks about, and it is entered with no spot-check.
		await advance(next.store, card.id, "execute", { owner: ME, planPath: path }, NOW);
		const before = await next.snapshot.view();
		expect(before.round.unwritten).toEqual([]);
		const reads = next.reads();

		// The clock is the snapshot's own, and `buildView` takes it separately from the pile — so the
		// frame moves on the same cards, and the rollup's `unwritten` is where a reader sees it.
		next.clock.at = NOW + UNWRITTEN_MS + 1;
		const after = await next.snapshot.view();
		expect(next.reads()).toBe(reads);
		// The rollup names its cards, so the wire entry is the id itself.
		expect(after.round.unwritten).toEqual([card.id]);
		expect(after.sig).not.toBe(before.sig);
	});
});
