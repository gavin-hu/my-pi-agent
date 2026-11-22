/**
 * Two machines, one board: what the store promises when a sync client can replace a card.
 *
 * The local cases next door (`store.test.ts`) pin the layout, the lock and the revision a write
 * moves. These pin the one writer a lock cannot order — the other machine's copy, which lands
 * between the read and the rename — and the two things that keep such a store usable: the id
 * counter beside the cards, and a write lock kept outside the directory a client replicates.
 *
 * The seam is `afterWrite`, which runs once the card has been written back: a case stands there
 * and writes the rival, which is the exact window a single process cannot reach.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { permissiveStore } from "../../test/helpers/board-flow.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { Card } from "./card.ts";
import { type Actor } from "./rules.ts";
import { createStore, NEXT_ID_FILE } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const NOW = 10_000;

/** A fresh store over a temp directory, with optional seams. */
function scratch(options: Parameters<typeof createStore>[1] = {}): {
	dir: string;
	store: ReturnType<typeof createStore>;
} {
	const dir = temps.track(tempDir("pi-board-sync-"));
	return { dir, store: permissiveStore(dir, options) };
}

describe("the write guard", () => {
	/** The one card file in a scratch store. */
	function cardPath(dir: string): string {
		const [name] = readdirSync(join(dir, "cards"));
		if (name === undefined) throw new Error("no card file");
		return join(dir, "cards", name);
	}

	test("replays the operation onto a card the client replaced after the rename", async () => {
		let rivalLanded = false;
		const { dir, store } = scratch({
			afterWrite: () => {
				if (rivalLanded) return;
				rivalLanded = true;
				// The other machine's copy, delivered after this pass wrote: one revision on, with a
				// title only that machine has. Nothing about it is possible to infer from `rev` or `by`.
				const file = cardPath(dir);
				const written = JSON.parse(readFileSync(file, "utf-8")) as Card;
				writeFileSync(file, `${JSON.stringify({ ...written, rev: written.rev + 1, title: "theirs" }, null, "\t")}\n`);
			},
		});
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		const claimed = await store.mutate(card.id, { kind: "claim" }, LEAD, NOW + 1);
		expect(claimed.ok).toBe(true);
		if (!claimed.ok) return;
		// Neither write was lost: the op landed on the rival and the rival's own change survived.
		expect(claimed.card.owner?.id).toBe(LEAD.id);
		expect(claimed.card.title).toBe("theirs");
		expect((await store.read(card.id))?.title).toBe("theirs");
	});

	test("refuses, naming both revisions, when the rival keeps coming back", async () => {
		const { dir, store } = scratch({
			afterWrite: () => {
				const file = cardPath(dir);
				const written = JSON.parse(readFileSync(file, "utf-8")) as Card;
				writeFileSync(file, `${JSON.stringify({ ...written, rev: written.rev + 1 }, null, "\t")}\n`);
			},
		});
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		// A note always changes the card, so every attempt writes and every write is replaced: the
		// loop can only end in the refusal.
		const noted = await store.mutate(card.id, { kind: "note", text: "mine" }, LEAD, NOW + 1);
		expect(noted.ok).toBe(false);
		if (noted.ok) return;
		expect(noted.error).toContain(`#${card.id}`);
		expect(noted.error).toMatch(/wrote revision \d+ and found revision \d+/);
		// The card is left as the rival last wrote it, so a reader sees the file that won.
		expect((await store.read(card.id))?.rev).toBeGreaterThan(1);
	});
});

describe("the id counter", () => {
	/** Write the counter the way another machine's copy would arrive. */
	function seedCounter(dir: string, value: unknown): void {
		writeFileSync(join(dir, NEXT_ID_FILE), typeof value === "string" ? value : JSON.stringify({ value }));
	}

	test("honours a counter a machine already advanced", async () => {
		const { dir, store } = scratch();
		seedCounter(dir, 7);
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		// Seven was issued elsewhere: this host does not reuse an id it cannot see a card for.
		expect(card.id).toBe("8");
	});

	test("takes the maximum of the counter and the piles, so a smaller write cannot unspend an id", async () => {
		const { dir, store } = scratch();
		await store.create({ title: "one", paths: [] }, LEAD, NOW);
		await store.create({ title: "two", paths: [] }, LEAD, NOW);
		seedCounter(dir, 9);
		expect((await store.create({ title: "three", paths: [] }, LEAD, NOW)).id).toBe("10");
		// A stale counter — another machine's older copy — must not hand out an id the piles hold.
		seedCounter(dir, 2);
		expect((await store.create({ title: "four", paths: [] }, LEAD, NOW)).id).toBe("11");
	});

	test("treats a counter it cannot read as a fresh start rather than a failure", async () => {
		const { dir, store } = scratch();
		seedCounter(dir, "{ not json");
		expect((await store.create({ title: "mine", paths: [] }, LEAD, NOW)).id).toBe("1");
	});

	test("records the id it issued, so the next machine starts above it", async () => {
		const { dir, store } = scratch();
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		expect(JSON.parse(readFileSync(join(dir, NEXT_ID_FILE), "utf-8"))).toEqual({ value: Number(card.id) });
	});
});

describe("the write lock's home", () => {
	test("sits outside the board when a lock directory is given, and never inside it", async () => {
		const lockDir = temps.track(tempDir("pi-board-lock-"));
		let insideBoard: boolean | undefined;
		let insideLockDir: boolean | undefined;
		const { dir, store } = scratch({
			lockDir,
			afterWrite: () => {
				// The seam runs while the pass holds the lock, which is the only moment it exists.
				insideBoard = existsSync(join(dir, ".lock-board"));
				insideLockDir = existsSync(join(lockDir, ".lock-board"));
			},
		});
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		// A create takes no lock; a mutation does, which is the pass this case is about.
		expect((await store.mutate(card.id, { kind: "claim" }, LEAD, NOW + 1)).ok).toBe(true);
		expect(insideBoard).toBe(false);
		expect(insideLockDir).toBe(true);
		// And it is given back: a lock is a record of a process, not a file the board keeps.
		expect(existsSync(join(lockDir, ".lock-board"))).toBe(false);
	});

	test("ignores a lock file a client replicated into the board", async () => {
		const lockDir = temps.track(tempDir("pi-board-lock-"));
		const { dir, store } = scratch({ lockDir });
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		// Another machine's lock, delivered with the cards: fresh, and naming a process here that
		// does not exist. It must not be respected, and it must not be taken over either.
		const replicated = join(dir, ".lock-board");
		writeFileSync(replicated, JSON.stringify({ pid: process.pid, token: "another-machine" }));
		const claimed = await store.mutate(card.id, { kind: "claim" }, LEAD, NOW + 1);
		expect(claimed.ok).toBe(true);
		expect(readFileSync(replicated, "utf-8")).toContain("another-machine");
	});
	test("reports a client's conflicted copy as a file it cannot read, and leaves the card beside it", async () => {
		const { dir, store } = scratch();
		const card = await store.create({ title: "mine", paths: [] }, LEAD, NOW);
		// What a sync client leaves when both machines wrote: a name that is not a card id, so it is
		// never opened as one — the reason is the reader's, and the card beside it is untouched.
		writeFileSync(join(dir, "cards", "0042 (conflicted copy).json"), JSON.stringify({ ...card, title: "theirs" }));
		const skipped = await store.skipped();
		expect(skipped.map((entry) => entry.file)).toContain("0042 (conflicted copy).json");
		expect(skipped.find((entry) => entry.file.startsWith("0042"))?.why).toBe("not a card id");
		expect((await store.read(card.id))?.title).toBe("mine");
	});
});
