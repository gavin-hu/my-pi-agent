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
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUS_DIR_NAME, INBOX_DIR_NAME, SESSIONS_DIR_NAME } from "../../lib/session-files.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { settle } from "../../test/helpers/process.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import { UNWRITTEN_MS } from "../../lib/workflow/round.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { drawnOf } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSnapshot, PILE_RESYNC_FRAMES, stampBus } from "./snapshot.ts";

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
		bus: async () => ({ roster: undefined, waiting: { messages: [], dropped: 0 } }),
		host: async () => undefined,
		planDir: () => board.runtime.planDir(board.cwd),
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

	test("carries the dependencies a pool card has met, and yields to a shelf or an offer", async () => {
		const next = await page();
		const finished = await next.store.create({ title: "First", paths: [] }, ME, NOW);
		await advance(next.store, finished.id, "done", { owner: ME }, NOW);
		const met = await next.store.create({ title: "Second", paths: [] }, ME, NOW);
		await next.store.mutate(met.id, { kind: "edit", dependsOn: [finished.id] }, ME, NOW);
		const open = await next.store.create({ title: "Third", paths: [] }, ME, NOW);
		await next.store.mutate(open.id, { kind: "edit", dependsOn: [met.id] }, ME, NOW);
		const bare = await next.store.create({ title: "Fourth", paths: [] }, ME, NOW);
		const ready = async (id: string) => drawnOf(await next.snapshot.view(), id)?.ready;

		// The finished dependency is named the way the card's own refusal names a card.
		expect(await ready(met.id)).toBe(`#${finished.id}`);
		// A dependency still in the pool blocks it, and a card that recorded none says nothing:
		// it was always takeable, so there is no transition to announce.
		expect(await ready(open.id)).toBeUndefined();
		expect(await ready(bare.id)).toBeUndefined();

		// The pool's precedence is the record's: a shelf and an offer are decisions the card is
		// under, and neither is displaced by its being takeable.
		await next.store.mutate(met.id, { kind: "shelve", note: "after the release" }, ME, NOW);
		expect(await ready(met.id)).toBeUndefined();
		await next.store.mutate(met.id, { kind: "unshelve" }, ME, NOW);
		expect(await ready(met.id)).toBe(`#${finished.id}`);
		await next.store.mutate(met.id, { kind: "offer" }, ME, NOW);
		expect(await ready(met.id)).toBeUndefined();

		// And it is the pool's fact: the same card one lane along owes its contract, not a headline.
		await next.store.mutate(met.id, { kind: "claim" }, ME, NOW);
		expect(drawnOf(await next.snapshot.view(), met.id)?.lane).toBe("plan");
		expect(await ready(met.id)).toBeUndefined();
	});
});

/** A bus directory under the suite's temp root, with the `sessions/` a record lands in. */
function busDir(): string {
	const dir = temps.track(tempDir("pi-bus-stamp-"));
	mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
	return dir;
}

/** One message file in an inbox the case names, so a landing moves the inbox's own entries. */
function mailIn(dir: string, inbox: string, id: string): void {
	mkdirSync(join(dir, INBOX_DIR_NAME, inbox), { recursive: true });
	writeFileSync(join(dir, INBOX_DIR_NAME, inbox, `${id}.json`), JSON.stringify({ id }), "utf-8");
}

describe("stampBus", () => {
	test("a bus that is not there answers a stamp, and one that appears moves it", async () => {
		const dir = join(temps.track(tempDir("pi-bus-stamp-absent-")), BUS_DIR_NAME);
		// Every path an absent bus lacks reads `-`, so the answer is a value a later stamp moves.
		expect(await stampBus(dir)).toBe("-|-|-|-");
		mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
		expect(await stampBus(dir)).not.toBe("-|-|-|-");
	});

	test("nothing written keeps the stamp identical", async () => {
		const dir = busDir();
		writeBusRecord(dir, { id: "s-1", label: "billing-core", lastSeen: NOW });
		const once = await stampBus(dir);
		// The page compares two of these: an answer that drifted on its own would be a read per tick.
		expect(await stampBus(dir)).toBe(once);
	});

	test("a session joining moves it", async () => {
		const dir = busDir();
		const before = await stampBus(dir);
		writeBusRecord(dir, { id: "s-1", label: "billing-core", lastSeen: NOW });
		expect(await stampBus(dir)).not.toBe(before);
	});

	test("a machine appearing moves it", async () => {
		// The hosts directory is drawn on the Team tab, so a machine that arrives is news whether or
		// not it has written a session yet.
		const dir = busDir();
		const before = await stampBus(dir);
		mkdirSync(join(dir, "hosts"), { recursive: true });
		expect(await stampBus(dir)).not.toBe(before);
	});

	test("a message landing moves it, in a new inbox and in one already there", async () => {
		const dir = busDir();
		writeBusRecord(dir, { id: "s-1", label: "billing-core", lastSeen: NOW });
		// A message lands one level below `inbox/`, so the listing of its dirs is what makes it news.
		const before = await stampBus(dir);
		mailIn(dir, "one", "1");
		const one = await stampBus(dir);
		expect(one).not.toBe(before);
		await settle(2);
		mailIn(dir, "one", "2");
		expect(await stampBus(dir)).not.toBe(one);
	});

	test("moves for a join, and for a message, with the directory's own clock held still", async () => {
		// Windows updates a directory's mtime lazily, so an entry can land beside it and leave the
		// parent's clock exactly where it was: the two windows-latest reds printed the same `sessions/`
		// part either side of a join. A whole second is a value `utimesSync` can put back to the
		// millisecond, which is that state on any platform — the entry name is the fact that moved.
		const dir = busDir();
		writeBusRecord(dir, { id: "s-1", label: "billing-core", lastSeen: NOW });
		const sessions = join(dir, SESSIONS_DIR_NAME);
		utimesSync(sessions, 1_000, 1_000);
		const before = await stampBus(dir);
		writeBusRecord(dir, { id: "s-2", label: "billing-web", lastSeen: NOW });
		utimesSync(sessions, 1_000, 1_000);
		// The premise, so a pass cannot come from the clock having moved after all.
		expect(statSync(sessions).mtimeMs).toBe(1_000_000);
		expect(await stampBus(dir)).not.toBe(before);
		// The same trust ran through the inbox parts: `inbox/<id>` was stamped by its own clock too, so
		// a message landing in an inbox that already existed had the same exposure.
		mailIn(dir, "one", "1");
		const inbox = join(dir, INBOX_DIR_NAME, "one");
		utimesSync(inbox, 1_000, 1_000);
		const one = await stampBus(dir);
		mailIn(dir, "one", "2");
		utimesSync(inbox, 1_000, 1_000);
		expect(statSync(inbox).mtimeMs).toBe(1_000_000);
		expect(await stampBus(dir)).not.toBe(one);
	});
});
