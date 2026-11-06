/**
 * One card's write lock: the exclusive create, the wait for a live holder, and the
 * takeover that keeps a process killed inside its window from shutting the card.
 *
 * Every case runs against a real directory: an exclusive create, a file's mtime, and a
 * removal are properties of the filesystem, and the rule that matters here — that only
 * one holder writes at a time — is exactly what a mock would answer for.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { type Actor } from "./rules.ts";
import { CARDS_DIR_NAME, createStore } from "./store.ts";
import { lockCard, lockPathFor } from "./lock.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const NOW = 10_000;

/** A fresh pile, since a lock is one name inside one directory. */
function pile(): string {
	return temps.track(tempDir("pi-lock-"));
}

describe("lockCard", () => {
	test("takes the lock by creating its file, and gives it back", async () => {
		const dir = pile();
		const lock = await lockCard(dir, "7");
		if (lock === undefined) throw new Error("expected the first acquisition to take the lock");
		expect(existsSync(lockPathFor(dir, "7"))).toBe(true);
		await lock.release();
		expect(existsSync(lockPathFor(dir, "7"))).toBe(false);
	});

	test("a second acquisition waits for the first and then takes it", async () => {
		const dir = pile();
		const first = await lockCard(dir, "7");
		if (first === undefined) throw new Error("expected the first acquisition to take the lock");
		// The wait is what makes a concurrent write land rather than be refused: the
		// second caller is already polling when the first one gives the lock back.
		const second = lockCard(dir, "7");
		await first.release();
		const taken = await second;
		if (taken === undefined) throw new Error("expected the waiting acquisition to take the lock");
		await taken.release();
		expect(existsSync(lockPathFor(dir, "7"))).toBe(false);
	});

	test("a lock a live holder keeps is not taken inside the wait", async () => {
		const dir = pile();
		const held = await lockCard(dir, "7");
		if (held === undefined) throw new Error("expected the first acquisition to take the lock");
		expect(await lockCard(dir, "7", { waitMs: 20 })).toBeUndefined();
		// Nothing was taken from the holder, so its own release still works.
		await held.release();
		expect(existsSync(lockPathFor(dir, "7"))).toBe(false);
	});

	test("a lock older than the bar is taken over, and its victim cannot release the new one", async () => {
		const dir = pile();
		const dead = await lockCard(dir, "7");
		if (dead === undefined) throw new Error("expected the first acquisition to take the lock");
		// A process killed inside the window leaves this file behind with nothing beating.
		utimesSync(lockPathFor(dir, "7"), 0, 0);
		const taken = await lockCard(dir, "7");
		if (taken === undefined) throw new Error("expected the abandoned lock to be taken over");
		// The old holder's token is gone from the file, so its release — the one its own
		// `finally` makes — leaves the takeover alone instead of opening the card to a third.
		await dead.release();
		expect(existsSync(lockPathFor(dir, "7"))).toBe(true);
		await taken.release();
		expect(existsSync(lockPathFor(dir, "7"))).toBe(false);
	});

	test("locks one card, so another card's write is not held up by it", async () => {
		const dir = pile();
		expect(lockPathFor(dir, "12")).toBe(join(dir, ".lock-12"));
		const first = await lockCard(dir, "7");
		if (first === undefined) throw new Error("expected the first acquisition to take the lock");
		const other = await lockCard(dir, "8", { waitMs: 20 });
		if (other === undefined) throw new Error("a different card must not wait on this one");
		await other.release();
		await first.release();
	});

	test("a file that is not this build's lock record is cleared once it is old", async () => {
		const dir = pile();
		writeFileSync(lockPathFor(dir, "7"), "half a record");
		utimesSync(lockPathFor(dir, "7"), 0, 0);
		const taken = await lockCard(dir, "7");
		if (taken === undefined) throw new Error("expected the unreadable lock to be taken over");
		expect(JSON.parse(readFileSync(lockPathFor(dir, "7"), "utf-8"))).toMatchObject({ pid: process.pid });
		await taken.release();
	});
});

describe("the window the store holds it for", () => {
	test("six notes fired at one card at once all land", async () => {
		// Three stores over one directory are three sessions on one repository, and every note
		// reads, checks, and renames the same file: without the lock the last rename wins, and
		// every call still reports success at the revision it wrote.
		const dir = pile();
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
		// Every lock is given back, so the pile holds card files and nothing a reader must skip.
		expect(existsSync(lockPathFor(join(dir, CARDS_DIR_NAME), card.id))).toBe(false);
	});

	test("a lock file in the pile is neither a card nor a skip", async () => {
		const dir = pile();
		const store = createStore(dir);
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const before = (await store.scan()).bytes;
		writeFileSync(lockPathFor(join(dir, CARDS_DIR_NAME), card.id), "half a record");
		// A reader reports the card files it cannot read and what they cost; a lock is neither.
		expect(await store.skipped()).toEqual([]);
		expect((await store.scan()).bytes).toBe(before);
	});
});
