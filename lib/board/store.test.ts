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
import { basename, join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { type Card, signatureOf } from "./card.ts";
import { type Actor, createCard } from "./rules.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { BOARD_DIR_NAME, boardDirFor, createStore, openBoard } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };
const NOW = 10_000;

/** The two sessions a seeded card needs: its owner, and the one who approves and reviews. */
const SEED = { owner: CORE, reviewer: LEAD };

/** A fresh store over a temp directory. */
function scratchStore(): { dir: string; store: ReturnType<typeof createStore> } {
	const dir = temps.track(tempDir("pi-board-"));
	return { dir, store: createStore(dir) };
}

/** The files actually on disk in a store's cards directory. */
function filesOf(dir: string): string[] {
	return readdirSync(join(dir, "cards")).sort();
}

/** The files actually on disk in a store's archive directory. */
function archivedFilesOf(dir: string): string[] {
	return readdirSync(join(dir, "archive")).sort();
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
		expect(card).toMatchObject({ lane: "backlog", rev: 1, by: LEAD.label });
		expect(card.notes).toEqual([{ by: LEAD.label, at: NOW, text: "from the page" }]);
		expect(await store.read(card.id)).toEqual(card);
	});

	test("writes the priority it was given, and the ordinary one otherwise", async () => {
		const { store } = scratchStore();
		const urgent = await store.create({ title: "now", paths: [], priority: "high" }, LEAD, NOW);
		const ordinary = await store.create({ title: "later", paths: [] }, LEAD, NOW);
		expect(urgent.priority).toBe("high");
		expect(ordinary.priority).toBe("normal");
		expect((await store.read(ordinary.id))?.priority).toBe("normal");
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
		const todo = await store.create({ title: "backlog", paths: [] }, LEAD, NOW);
		const doing = await store.create({ title: "execute", paths: [] }, LEAD, NOW);
		const blocked = await store.create({ title: "blocked", paths: [] }, LEAD, NOW);
		const done = await store.create({ title: "done", paths: [] }, LEAD, NOW);
		await advance(store, doing.id, "execute", SEED, NOW);
		await advance(store, blocked.id, "blocked", SEED, NOW);
		await advance(store, done.id, "done", SEED, NOW);
		expect((await store.list()).map((card) => card.title)).toEqual(["backlog", "execute", "blocked", "done"]);
		expect((await store.list()).map((card) => card.id)).toEqual([todo.id, doing.id, blocked.id, done.id]);
	});

	test("orders a lane by priority before age", async () => {
		const { store } = scratchStore();
		const low = await store.create({ title: "low", paths: [], priority: "low" }, LEAD, NOW);
		const high = await store.create({ title: "high", paths: [], priority: "high" }, LEAD, NOW);
		const ordinary = await store.create({ title: "ordinary", paths: [] }, LEAD, NOW);
		// A done card stays history whatever its priority: the lane decides first.
		const finished = await store.create({ title: "finished", paths: [], priority: "high" }, LEAD, NOW);
		await advance(store, finished.id, "done", SEED, NOW);
		expect((await store.list()).map((card) => card.id)).toEqual([high.id, ordinary.id, low.id, finished.id]);
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
		// Dropping them silently is what makes an unreadable board read as an empty one:
		// each refusal is reported with the file and the reason.
		expect(await store.skipped()).toEqual([
			{ file: "0002.json", id: "2", why: "bad JSON" },
			{ file: "0003.json", id: "3", why: "version 2" },
			{ file: "0004.json", id: "4", why: "names card 9" },
			{ file: "0005.json", id: "5", why: "not a card record" },
		]);
	});

	test("one read answers with both the cards and the files it refused", async () => {
		const { dir, store } = scratchStore();
		const card = await store.create({ title: "good", paths: [] }, LEAD, NOW);
		writeFileSync(join(dir, "cards", "0002.json"), '{"v":1,');
		// The page's snapshot wants both halves, so it must be able to get them from one pass
		// over the pile rather than reading every card twice for one frame.
		expect(await store.scan()).toEqual({
			cards: [card],
			skipped: [{ file: "0002.json", id: "2", why: "bad JSON" }],
		});
		expect((await store.scan()).cards).toEqual(await store.list());
		expect((await store.scan()).skipped).toEqual(await store.skipped());
	});

	test("a card file that is there but unreadable is named in the refusal", async () => {
		const { dir, store } = scratchStore();
		await store.ensure();
		writeFileSync(join(dir, "cards", "0007.json"), JSON.stringify({ ...cardLike("7"), v: 2 }));
		const result = await store.mutate("7", { kind: "claim" }, LEAD, NOW);
		if (result.ok) throw new Error("expected a refusal");
		expect(result.error).toBe("#7 is there and this build cannot read it (0007.json: version 2).");
	});

	test("reads a card written before the lane was called a lane", async () => {
		// A published board holds these: the field was renamed, the files were not. The
		// card reads, and its next write spells the new name.
		const { dir, store } = scratchStore();
		await store.ensure();
		const { lane, ...rest } = cardLike("7");
		writeFileSync(join(dir, "cards", "0007.json"), JSON.stringify({ ...rest, status: lane }));
		expect((await store.list()).map((card) => card.lane)).toEqual(["backlog"]);
		await store.mutate("7", { kind: "note", text: "read me" }, LEAD, NOW);
		expect(JSON.parse(readFileSync(join(dir, "cards", "0007.json"), "utf-8")).lane).toBe("backlog");
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
		expect(result.card).toMatchObject({ lane: "plan", owner: { label: CORE.label }, rev: 2 });
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
		const moved = await second.mutate(card.id, { kind: "move", lane: "blocked" }, OTHER, NOW);
		if (moved.ok) throw new Error("expected the second session's move to be refused");
		expect(moved.error).toBe("#1 is held by billing-core. Only its owner can move it.");
		expect((await second.read(card.id))?.lane).toBe("plan");
	});

	test("the owner's own later move is still applied", async () => {
		const { dir } = scratchStore();
		const first = createStore(dir);
		const second = createStore(dir);
		await first.ensure();
		const card = await first.create({ title: "T", paths: [] }, LEAD, NOW);
		await first.mutate(card.id, { kind: "claim" }, CORE, NOW);
		const moved = await second.mutate(card.id, { kind: "move", lane: "blocked", blocker: "decision" }, CORE, NOW + 1);
		if (!moved.ok) throw new Error(moved.error);
		expect(moved.card).toMatchObject({ lane: "blocked", rev: 3 });
	});

	test("an operation on a dropped card reports it gone", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "drop" }, LEAD, NOW);
		const result = await store.mutate(card.id, { kind: "claim" }, LEAD, NOW);
		if (result.ok) throw new Error("expected a refusal");
		expect(result.error).toBe("#1 does not exist.");
	});

	test("a drop is refused while another card waits on it", async () => {
		const { store } = scratchStore();
		const first = await store.create({ title: "retry branches", paths: [] }, LEAD, NOW);
		const second = await store.create({ title: "billing webhook", paths: [] }, LEAD, NOW);
		const linked = await store.mutate(
			second.id,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [first.id] },
			LEAD,
			NOW,
		);
		if (!linked.ok) throw new Error(linked.error);
		const dropped = await store.mutate(first.id, { kind: "drop" }, LEAD, NOW);
		if (dropped.ok) throw new Error("expected the drop to be refused");
		expect(dropped.error).toBe(`#${first.id} is waited on by #${second.id}; drop that card first.`);
		expect(await store.read(first.id)).toBeDefined();
	});

	test("a claim is refused while the card waits, and goes through once the dependency lands", async () => {
		const { store } = scratchStore();
		const first = await store.create({ title: "retry branches", paths: [] }, LEAD, NOW);
		const second = await store.create({ title: "billing webhook", paths: [] }, LEAD, NOW);
		await store.mutate(
			second.id,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [first.id] },
			LEAD,
			NOW,
		);
		const refused = await store.mutate(second.id, { kind: "claim" }, CORE, NOW);
		if (refused.ok) throw new Error("expected the claim to be refused");
		expect(refused.error).toBe(`#${second.id} waits on #${first.id} (backlog).`);
		await advance(store, first.id, "done", SEED, NOW);
		const claimed = await store.mutate(second.id, { kind: "claim" }, CORE, NOW);
		if (!claimed.ok) throw new Error(claimed.error);
		expect(claimed.card.lane).toBe("plan");
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

	test("records what ended, so the id does not come back", async () => {
		const { dir, store } = scratchStore();
		const first = await store.create({ title: "A card that ended", paths: [] }, LEAD, NOW);
		await store.mutate(first.id, { kind: "drop" }, LEAD, NOW + 5);

		const ended = JSON.parse(readFileSync(join(dir, "ended", "0001.json"), "utf-8"));
		expect(ended).toEqual({
			v: 1,
			id: "1",
			title: "A card that ended",
			lane: "backlog",
			by: LEAD.label,
			at: NOW + 5,
			why: "dropped",
		});

		// The next add takes a new number: a note or a handoff that names #1 cannot come
		// to mean a different feature tomorrow.
		const second = await store.create({ title: "The next feature", paths: [] }, LEAD, NOW);
		expect(second.id).toBe("2");
	});

	test("keeps the owner in the record when the card had one", async () => {
		const { dir, store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "claim" }, CORE, NOW);
		await store.mutate(card.id, { kind: "drop" }, CORE, NOW);
		const ended = JSON.parse(readFileSync(join(dir, "ended", "0001.json"), "utf-8"));
		expect(ended.lane).toBe("plan");
		expect(ended.owner).toEqual({ id: CORE.id, label: CORE.label });
	});
});

describe("archive", () => {
	/** A card that finished, which is the only kind the store will set aside. */
	async function finished(store: ReturnType<typeof createStore>, title = "T"): Promise<string> {
		const card = await store.create({ title, paths: [], note: "kept" }, LEAD, NOW);
		await advance(store, card.id, "done", SEED, NOW);
		return card.id;
	}

	test("moves the file out of the board, unchanged, and off every listing", async () => {
		const { dir, store } = scratchStore();
		const id = await finished(store, "Finished one");
		const before = readFileSync(join(dir, "cards", "0001.json"), "utf-8");
		const result = await store.mutate(id, { kind: "archive" }, LEAD, NOW + 5);
		if (!result.ok) throw new Error(result.error);
		expect(result.archived).toBe(true);
		expect(result.dropped).toBe(false);
		// A move, not a write: the bytes are the same file, so nothing about the record
		// changed and no revision was spent on leaving.
		expect(readFileSync(join(dir, "archive", "0001.json"), "utf-8")).toBe(before);
		expect(existsSync(join(dir, "cards", "0001.json"))).toBe(false);
		expect(filesOf(dir)).toEqual([]);
		expect(archivedFilesOf(dir)).toEqual(["0001.json"]);
		expect(await store.list()).toEqual([]);
		expect(await store.read(id)).toEqual(result.card);
	});

	test("is read only when the pile is asked for, in lane order", async () => {
		const { store } = scratchStore();
		const first = await finished(store, "First");
		const second = await finished(store, "Second");
		expect((await store.archived()).cards).toEqual([]);
		expect(await store.archivedCount()).toBe(0);
		await store.mutate(first, { kind: "archive" }, LEAD, NOW);
		await store.mutate(second, { kind: "archive" }, LEAD, NOW);
		expect((await store.archived()).cards.map((card) => card.title)).toEqual(["First", "Second"]);
		expect(await store.archivedCount()).toBe(2);
	});

	test("a card that is already aside is a no-op, not a second move", async () => {
		const { store } = scratchStore();
		const id = await finished(store);
		await store.mutate(id, { kind: "archive" }, LEAD, NOW);
		const again = await store.mutate(id, { kind: "archive" }, LEAD, NOW + 1);
		if (!again.ok) throw new Error(again.error);
		expect(again.changed).toBe(false);
		expect(again.archived).toBe(false);
	});

	test("refuses a card that has not finished", async () => {
		const { store } = scratchStore();
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const result = await store.mutate(card.id, { kind: "archive" }, LEAD, NOW);
		if (result.ok) throw new Error("expected a refusal");
		expect(result.error).toBe("#1 is in backlog; only a finished card can be archived.");
		expect(await store.list()).toHaveLength(1);
	});

	test("keeps the number spent, so the next add takes a new one", async () => {
		const { store } = scratchStore();
		const id = await finished(store);
		await store.mutate(id, { kind: "archive" }, LEAD, NOW);
		const next = await store.create({ title: "The next feature", paths: [] }, LEAD, NOW);
		expect(next.id).toBe("2");
	});

	test("writes an edit back to the pile the card was read from", async () => {
		const { dir, store } = scratchStore();
		const id = await finished(store);
		await store.mutate(id, { kind: "archive" }, LEAD, NOW);
		const edited = await store.mutate(
			id,
			{ kind: "edit", title: "Finished one, restated", paths: undefined, priority: undefined, dependsOn: undefined },
			CORE,
			NOW + 1,
		);
		if (!edited.ok) throw new Error(edited.error);
		expect(edited.card.title).toBe("Finished one, restated");
		expect(existsSync(join(dir, "cards", "0001.json"))).toBe(false);
		expect(JSON.parse(readFileSync(join(dir, "archive", "0001.json"), "utf-8")).title).toBe("Finished one, restated");
	});

	test("a drop takes an archived card, leaving the record that ended it", async () => {
		const { dir, store } = scratchStore();
		const id = await finished(store);
		await store.mutate(id, { kind: "archive" }, LEAD, NOW);
		const dropped = await store.mutate(id, { kind: "drop" }, LEAD, NOW + 2);
		if (!dropped.ok) throw new Error(dropped.error);
		expect(dropped.dropped).toBe(true);
		expect(existsSync(join(dir, "archive", "0001.json"))).toBe(false);
		expect(JSON.parse(readFileSync(join(dir, "ended", "0001.json"), "utf-8")).why).toBe("dropped");
	});

	test("does not strand a card that waits on it, so its drop is still refused", async () => {
		const { store } = scratchStore();
		const id = await finished(store);
		const waiter = await store.create({ title: "Waits on it", paths: [] }, LEAD, NOW);
		const linked = await store.mutate(
			waiter.id,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [id] },
			LEAD,
			NOW,
		);
		if (!linked.ok) throw new Error(linked.error);
		await store.mutate(id, { kind: "archive" }, LEAD, NOW);
		const dropped = await store.mutate(id, { kind: "drop" }, LEAD, NOW);
		if (dropped.ok) throw new Error("expected the drop to be refused");
		expect(dropped.error).toBe(`#${id} is waited on by #${waiter.id}; drop that card first.`);
	});
});

describe("bytes, where, and the signature", () => {
	test("counts the card files and ignores a temp file, and never the archive", async () => {
		const { dir, store } = scratchStore();
		await store.create({ title: "T", paths: [] }, LEAD, NOW);
		const before = await store.bytes();
		expect(before).toBeGreaterThan(0);
		expect(before).toBe(statSync(join(dir, "cards", "0001.json")).size);
		writeFileSync(join(dir, "cards", ".tmp-1-x"), "x".repeat(500));
		expect(await store.bytes()).toBe(before);
		// The page's size belongs to the cards it lists, so a card set aside lowers it.
		await advance(store, "1", "done", SEED, NOW);
		await store.mutate("1", { kind: "archive" }, LEAD, NOW);
		expect(await store.bytes()).toBe(0);
	});

	test("names the directory it writes to", async () => {
		const { dir, store } = scratchStore();
		expect(store.where()).toContain("board");
		expect(store.where().length).toBeLessThan(dir.length + 1);
		// A store built over a directory by hand has no repository behind it, so it names the
		// one directory it has rather than saying nothing.
		expect(store.root()).toBe(dir);
		expect(store.name()).toBe(basename(dir));
	});

	test("names the repository it was opened for, not the hash it is filed under", () => {
		const dir = temps.track(tempDir("pi-board-"));
		const root = join(dir, "my-pi-agent");
		expect(createStore(join(dir, "8872d3adda0e"), { root }).name()).toBe("my-pi-agent");
		expect(createStore(join(dir, "8872d3adda0e"), { root }).root()).toBe(root);
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
		// Outside git the working directory is the identity, so it is also the name.
		expect(store.root()).toBe(cwd);
		expect(store.name()).toBe(basename(cwd));
		const card = await store.create({ title: "T", paths: [] }, LEAD, NOW);
		expect(await store.read(card.id)).toEqual(card);
	});
});

/** A card-shaped record, for the reader's refusal cases. */
function cardLike(id: string): Card {
	return createCard(id, { title: "T", paths: [] }, LEAD, NOW);
}
