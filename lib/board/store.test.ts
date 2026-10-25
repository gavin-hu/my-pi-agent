/**
 * The board store: file layout, id allocation, the compare-and-set an update
 * takes, and the reader that drops a file it cannot trust.
 *
 * Every case runs against a real directory, because the properties that matter —
 * an exclusive create, a rename over a live file, a temp file that is invisible to
 * the reader — are properties of the filesystem, not of a mock. The directory is a
 * temp dir under the OS temp root, removed at teardown.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { type Card, signatureOf } from "./card.ts";
import { type Actor, createCard } from "./rules.ts";
import { BOARD_DIR_NAME, boardDirFor, createStore, openBoard } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };
const NOW = 10_000;

/** A fresh store over a temp directory. */
function scratchStore(): { dir: string; store: ReturnType<typeof createStore> } {
	const dir = temps.track(tempDir("pi-board-"));
	return { dir, store: createStore(dir) };
}

/** The files actually on disk in a store's cards directory. */
function filesOf(dir: string): string[] {
	return readdirSync(join(dir, "cards")).sort();
}

describe("create", () => {
	test("allocates ids from 1 and pads the file name, not the id", async () => {
		const { dir, store } = scratchStore();
		const first = await store.create({ title: "One", paths: [] }, LEAD, NOW);
		const second = await store.create({ title: "Two", paths: [] }, LEAD, NOW);
		expect([first.id, second.id]).toEqual(["1", "2"]);
		expect(filesOf(dir)).toEqual(["0001.json", "0002.json"]);
		expect(JSON.parse(readFileSync(join(dir, "cards", "0001.json"), "utf-8")).id).toBe("1");
	});

	test("writes a card this build's reader accepts, with the first note", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: ["src/billing"], note: "from the page" }, LEAD, NOW);
		expect(card).toMatchObject({ status: "todo", rev: 1, by: LEAD.label });
		expect(card.notes).toEqual([{ by: LEAD.label, at: NOW, text: "from the page" }]);
		expect(await store.read(card.id)).toEqual(card);
	});

	test("gives a card file the user's eyes only", async () => {
		if (process.platform === "win32") return;
		const { dir, store } = scratchStore();
		await store.create({ title: "T", paths: [] }, LEAD, NOW);
		expect(statSync(join(dir, "cards", "0001.json")).mode & 0o777).toBe(0o600);
	});

	test("two adds racing on one board get different ids", async () => {
		const { store } = scratchStore();
		await store.ensure();
		const [a, b] = await Promise.all([
			store.create({ title: "A", paths: [] }, LEAD, NOW),
			store.create({ title: "B", paths: [] }, LEAD, NOW),
		]);
		expect(new Set([a.id, b.id]).size).toBe(2);
		expect(await store.list()).toHaveLength(2);
	});
});

describe("list and read", () => {
	test("returns lane order, oldest first, with the id as the tie-break", async () => {
		const { store } = scratchStore();
		const todo = await store.create({ title: "todo", paths: [] }, LEAD, NOW);
		const doing = await store.create({ title: "doing", paths: [] }, LEAD, NOW);
		const blocked = await store.create({ title: "blocked", paths: [] }, LEAD, NOW);
		const done = await store.create({ title: "done", paths: [] }, LEAD, NOW);
		await store.mutate(doing.id, { kind: "claim" }, CORE, NOW);
		await store.mutate(blocked.id, { kind: "claim" }, CORE, NOW);
		await store.mutate(blocked.id, { kind: "move", status: "blocked" }, CORE, NOW);
		await store.mutate(done.id, { kind: "claim" }, CORE, NOW);
		await store.mutate(done.id, { kind: "move", status: "done" }, CORE, NOW);
		expect((await store.list()).map((card) => card.title)).toEqual(["todo", "doing", "blocked", "done"]);
		expect((await store.list()).map((card) => card.id)).toEqual([todo.id, doing.id, blocked.id, done.id]);
	});

	test("reads one card, and reports nothing for an id that is not there", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		expect(await store.read(card.id)).toEqual(card);
		expect(await store.read("99")).toBeUndefined();
	});

	test("drops a file the reader cannot trust instead of repairing it", async () => {
		const { dir, store } = scratchStore();
		await store.create({ title: "good", paths: [] }, LEAD, NOW);
		const cards = join(dir, "cards");
		// Half-written, another schema version, an id that disagrees with its file
		// name, a file that is not a card at all, and one that is not a card file.
		writeFileSync(join(cards, "0002.json"), '{"v":1,');
		writeFileSync(join(cards, "0003.json"), JSON.stringify({ ...cardLike("3"), v: 2 }));
		writeFileSync(join(cards, "0004.json"), JSON.stringify(cardLike("9")));
		writeFileSync(join(cards, "0005.json"), JSON.stringify({ hello: "world" }));
		writeFileSync(join(cards, "notes.txt"), "ignored");
		writeFileSync(join(cards, ".tmp-123-abc"), "in flight");
		expect((await store.list()).map((card) => card.id)).toEqual(["1"]);
	});

	test("a padded id inside the record is a disagreement, not a card", async () => {
		const { dir, store } = scratchStore();
		const cards = join(dir, "cards");
		await store.ensure();
		writeFileSync(join(cards, "0007.json"), JSON.stringify({ ...cardLike("7"), id: "0007" }));
		expect(await store.list()).toEqual([]);
	});
});

describe("mutate", () => {
	test("applies an operation and moves the revision", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const result = await store.mutate(card.id, { kind: "claim" }, CORE, NOW + 1);
		if (!result.ok) throw new Error(result.error);
		expect(result.card).toMatchObject({ status: "doing", owner: { label: CORE.label }, rev: 2 });
		expect(result.dropped).toBe(false);
		expect(await store.read(card.id)).toEqual(result.card);
	});

	test("a refusal reports the reason and the card as it was", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "claim" }, CORE, NOW);
		const result = await store.mutate(card.id, { kind: "claim" }, OTHER, NOW);
		if (result.ok) throw new Error("expected a refusal");
		expect(result.error).toBe("#1 is held by billing-core.");
		expect(result.card?.rev).toBe(2);
	});

	test("a no-op writes nothing", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "claim" }, CORE, NOW);
		const before = statSync(join(store.dir, "cards", "0001.json")).mtimeMs;
		const result = await store.mutate(card.id, { kind: "claim" }, CORE, NOW + 5);
		if (!result.ok) throw new Error(result.error);
		expect(result.changed).toBe(false);
		expect(statSync(join(store.dir, "cards", "0001.json")).mtimeMs).toBe(before);
	});

	test("re-checks the operation when the card changed under a second store", async () => {
		// Two stores over one directory is two sessions on one repository.
		const { dir } = scratchStore();
		const first = createStore(dir);
		const second = createStore(dir);
		await first.ensure();
		const card = await first.create({ title: "T", paths: [] }, LEAD, NOW);
		// The lead claims it in one session…
		await first.mutate(card.id, { kind: "claim" }, CORE, NOW);
		// …and the other session's "move done" is re-checked against that card rather
		// than forced onto the copy it read.
		const moved = await second.mutate(card.id, { kind: "move", status: "done" }, OTHER, NOW);
		if (moved.ok) throw new Error("expected the second session's move to be refused");
		expect(moved.error).toBe("#1 is held by billing-core. Only its owner can move it.");
		expect((await second.read(card.id))?.status).toBe("doing");
	});

	test("the owner's own later move is still applied", async () => {
		const { dir } = scratchStore();
		const first = createStore(dir);
		const second = createStore(dir);
		await first.ensure();
		const card = await first.create({ title: "T", paths: [] }, LEAD, NOW);
		await first.mutate(card.id, { kind: "claim" }, CORE, NOW);
		const moved = await second.mutate(card.id, { kind: "move", status: "blocked" }, CORE, NOW + 1);
		if (!moved.ok) throw new Error(moved.error);
		expect(moved.card).toMatchObject({ status: "blocked", rev: 3 });
	});

	test("an operation on a dropped card reports it gone", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "drop" }, LEAD, NOW);
		const result = await store.mutate(card.id, { kind: "claim" }, LEAD, NOW);
		if (result.ok) throw new Error("expected a refusal");
		expect(result.error).toBe("#1 does not exist.");
	});

	test("drop removes the file and its notes", async () => {
		const { dir, store } = scratchStore();
		const card = await store.create({ title: "T", paths: [], note: "gone with it" }, LEAD, NOW);
		const result = await store.mutate(card.id, { kind: "drop" }, LEAD, NOW);
		if (!result.ok) throw new Error(result.error);
		expect(result.dropped).toBe(true);
		expect(existsSync(join(dir, "cards", "0001.json"))).toBe(false);
		expect(await store.list()).toEqual([]);
	});
});

describe("bytes, where, and the signature", () => {
	test("counts the card files and ignores a temp file", async () => {
		const { dir, store } = scratchStore();
		await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const before = await store.bytes();
		expect(before).toBeGreaterThan(0);
		expect(before).toBe(statSync(join(dir, "cards", "0001.json")).size);
		writeFileSync(join(dir, "cards", ".tmp-1-x"), "x".repeat(500));
		expect(await store.bytes()).toBe(before);
	});

	test("names the directory it writes to", async () => {
		const { dir, store } = scratchStore();
		expect(store.where()).toContain("board");
		expect(store.where().length).toBeLessThan(dir.length + 1);
	});

	test("the signature moves with a revision, an add, and a drop", async () => {
		const { store } = scratchStore();
		const empty = signatureOf(await store.list());
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const added = signatureOf(await store.list());
		expect(added).not.toBe(empty);
		const claimed = await store.mutate(card.id, { kind: "claim" }, CORE, NOW);
		if (!claimed.ok) throw new Error(claimed.error);
		const bumped = signatureOf(await store.list());
		expect(bumped).not.toBe(added);
		await store.mutate(card.id, { kind: "drop" }, CORE, NOW);
		expect(signatureOf(await store.list())).toBe(empty);
	});
});

describe("ensure", () => {
	test("sweeps a temp file a dead process left, and keeps a fresh one", async () => {
		const { dir, store } = scratchStore();
		await store.ensure();
		const stale = join(dir, "cards", ".tmp-999-old");
		const fresh = join(dir, "cards", ".tmp-999-new");
		writeFileSync(stale, "x");
		writeFileSync(fresh, "x");
		utimesSync(stale, 0, 0);
		await store.ensure();
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
	});
});

describe("openBoard", () => {
	test("files a repository-less directory under its own key", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		// No git answers, so the directory keys on itself: the fallback every
		// non-repository session takes.
		const pi = { exec: async () => ({ stdout: "", stderr: "", code: 1 }) } as unknown as Parameters<
			typeof openBoard
		>[0];
		const store = await openBoard(pi, cwd, { agentDir });
		expect(store.dir.startsWith(boardDirFor(agentDir, ""))).toBe(true);
		expect(store.dir).toContain(join(agentDir, BOARD_DIR_NAME));
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		expect(await store.read(card.id)).toEqual(card);
	});
});

/** A card-shaped record, for the reader's refusal cases. */
function cardLike(id: string): Card {
	return createCard(id, { title: "T", paths: [] }, LEAD, NOW);
}
