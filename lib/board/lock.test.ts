/**
 * One board's write lock: the exclusive create, the wait for a live holder, and the takeover
 * that keeps a process killed inside its window from shutting the board.
 *
 * Every case runs against a real directory: an exclusive create, a file's mtime, and a
 * removal are properties of the filesystem, and the rule that matters here — that only one
 * writer holds the board at a time — is exactly what a mock would answer for.
 *
 * The last case is the one the unit changed for: a card's lock let two writers on two cards
 * answer the same board-wide question from two snapshots, which is a rule passed twice rather
 * than a file overwritten. It is pinned there, in `concurrency.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { type Actor } from "./rules.ts";
import { createStore } from "./store.ts";
import { BOARD_LOCK_NAME, lockBoard, lockPathFor } from "./lock.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const NOW = 10_000;

/** A fresh board, since a lock is one name inside one directory. */
function board(): string {
	return temps.track(tempDir("pi-lock-"));
}

/** The errno a platform answers, as a thrown value carries it. */
function errno(code: string): Error {
	return Object.assign(new Error(`${code}: the lock's name was not this call's to take`), { code });
}

/** A create that refuses the first `refusals` attempts with `code`, then delegates to the real one. */
function refusing(refusals: number, code: string): (path: string, text: string) => Promise<void> {
	let left = refusals;
	return async (path, text) => {
		if (left > 0) {
			left -= 1;
			throw errno(code);
		}
		await writeFile(path, text, { flag: "wx" });
	};
}

describe("lockBoard", () => {
	test("takes the lock by creating its file, and gives it back", async () => {
		const dir = board();
		const lock = await lockBoard(dir);
		if (lock === undefined) throw new Error("expected the first acquisition to take the lock");
		expect(existsSync(lockPathFor(dir))).toBe(true);
		await lock.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a second acquisition waits for the first and then takes it", async () => {
		const dir = board();
		const first = await lockBoard(dir);
		if (first === undefined) throw new Error("expected the first acquisition to take the lock");
		// The wait is what makes a concurrent write land rather than be refused: the
		// second caller is already polling when the first one gives the lock back.
		const second = lockBoard(dir);
		await first.release();
		const taken = await second;
		if (taken === undefined) throw new Error("expected the waiting acquisition to take the lock");
		await taken.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a lock a live holder keeps is not taken inside the wait", async () => {
		const dir = board();
		const held = await lockBoard(dir);
		if (held === undefined) throw new Error("expected the first acquisition to take the lock");
		expect(await lockBoard(dir, { waitMs: 20 })).toBeUndefined();
		// Nothing was taken from the holder, so its own release still works.
		await held.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a lock older than the bar is taken over, and its victim cannot release the new one", async () => {
		const dir = board();
		const dead = await lockBoard(dir);
		if (dead === undefined) throw new Error("expected the first acquisition to take the lock");
		// A process killed inside the window leaves this file behind with nothing beating.
		utimesSync(lockPathFor(dir), 0, 0);
		const taken = await lockBoard(dir);
		if (taken === undefined) throw new Error("expected the abandoned lock to be taken over");
		// The old holder's token is gone from the file, so its release — the one its own
		// `finally` makes — leaves the takeover alone instead of opening the board to a third.
		await dead.release();
		expect(existsSync(lockPathFor(dir))).toBe(true);
		await taken.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("holds the whole board, so one card's write waits behind another's", async () => {
		const dir = board();
		expect(lockPathFor(dir)).toBe(join(dir, BOARD_LOCK_NAME));
		const first = await lockBoard(dir);
		if (first === undefined) throw new Error("expected the first acquisition to take the lock");
		// The limit a claim is counted against and the loop an edit would close are the board's
		// facts, so a writer on one card is held behind a writer on any other: a card's own name
		// was the window that let both answer from two snapshots.
		expect(await lockBoard(dir, { waitMs: 20 })).toBeUndefined();
		await first.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a create Windows refuses while a rival deletes its lock is waited out, then taken", async () => {
		const dir = board();
		// Windows answers the create with access-denied rather than exists while a rival's create
		// and `rm` overlap: the name is delete-pending, and the create is refused for it. One poll
		// later the deletion has landed and the name is free — which is the whole fix, since the
		// refusal used to escape the loop as a failed write.
		const lock = await lockBoard(dir, { create: refusing(2, "EPERM") });
		if (lock === undefined) throw new Error("expected the refused create to be retried, not thrown");
		expect(JSON.parse(readFileSync(lockPathFor(dir), "utf-8"))).toMatchObject({ pid: process.pid });
		await lock.release();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a create refused for the whole wait answers nothing, so the caller still owns the write", async () => {
		const dir = board();
		// A refusal that outlives the window is not told from a directory this process may not
		// write to, so the acquisition ends the way a live holder's does: nothing taken, and no
		// file of this call's own left behind for a later reader to take over.
		expect(await lockBoard(dir, { waitMs: 0, create: refusing(Infinity, "EPERM") })).toBeUndefined();
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("a create that fails for any other reason still throws on the first attempt", async () => {
		const dir = board();
		// The tolerance is two codes and not "whatever a create answers": a full disk is the
		// caller's to hear about, and asking again would hide it for the length of the wait.
		const failure = refusing(Infinity, "ENOSPC");
		await expect(lockBoard(dir, { create: failure })).rejects.toThrow("ENOSPC");
	});

	test("a file that is not this build's lock record is cleared once it is old", async () => {
		const dir = board();
		writeFileSync(lockPathFor(dir), "half a record");
		utimesSync(lockPathFor(dir), 0, 0);
		const taken = await lockBoard(dir);
		if (taken === undefined) throw new Error("expected the unreadable lock to be taken over");
		expect(JSON.parse(readFileSync(lockPathFor(dir), "utf-8"))).toMatchObject({ pid: process.pid });
		await taken.release();
	});
});

describe("the window the store holds it for", () => {
	test("six notes fired at one card at once all land", async () => {
		// Three stores over one directory are three sessions on one repository, and every note
		// reads, checks, and renames the same file: without the lock the last rename wins, and
		// every call still reports success at the revision it wrote.
		const dir = board();
		const stores = [createStore(dir), createStore(dir), createStore(dir)];
		const [first] = stores;
		if (first === undefined) throw new Error("expected a store");
		await first.ensure();
		const card = await first.create({ title: "T", paths: [] }, LEAD, NOW);
		const sessions = [0, 1, 2];
		const notes = sessions.flatMap((session) => [0, 1].map((index) => `note ${session}.${index}`));
		const results = await Promise.all(
			stores.flatMap((store, session) =>
				[0, 1].map((index) =>
					store.mutate(card.id, { kind: "note", text: `note ${session}.${index}` }, LEAD, NOW + index),
				),
			),
		);
		expect(results.filter((result) => !result.ok)).toEqual([]);
		const written = await first.read(card.id);
		// One revision per write, and none spent waiting: six writes, six notes.
		expect(written?.rev).toBe(7);
		expect(written?.notes.map((note) => note.text).sort()).toEqual(notes.sort());
		// Every lock is given back, so the board holds card files and nothing a reader must skip.
		expect(existsSync(lockPathFor(dir))).toBe(false);
	});

	test("names the board, not the card, when a write never got the lock", async () => {
		const dir = board();
		const store = createStore(dir);
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		// A live holder for the whole wait: every attempt loses the board, and none of them learns
		// anything about the card — which is why the sentence names what kept it out.
		const held = await lockBoard(dir, { waitMs: 0 });
		if (held === undefined) throw new Error("expected the lock");
		const result = await store.mutate(card.id, { kind: "note", text: "late" }, LEAD, NOW);
		await held.release();
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.error).toBe(`#${card.id} was being written by another session; read it again.`);
		expect((await store.read(card.id))?.notes).toEqual([]);
	});

	test("a lock file beside the cards is neither a card nor a skip", async () => {
		const dir = board();
		const store = createStore(dir);
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const before = (await store.scan()).bytes;
		writeFileSync(lockPathFor(dir), "half a record");
		// A reader reports the card files it cannot read and what they cost; a lock is neither,
		// and it sits at the board's root rather than in either pile.
		expect(await store.skipped()).toEqual([]);
		expect((await store.scan()).bytes).toBe(before);
		expect((await store.list()).map((entry) => entry.id)).toEqual([card.id]);
	});
});
