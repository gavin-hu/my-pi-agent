/**
 * A card's clock: the one moment a write may not move backwards, and the moments that stay the
 * caller's own.
 *
 * `updatedAt` is what the `done` gate reads — `signStale` asks whether the card was written since
 * its sign — and every caller samples its own clock, some of them before work that takes minutes: a
 * spot-check's command has a ten-minute bound. So this field is the store's to keep monotonic, while
 * a note's `at` and the transition log's stay what the caller read.
 *
 * It is its own suite because `lib/board/rules.test.ts` is at its height in `test/suite-sizes.test.ts`,
 * and because the property is the store's rather than one operation's.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { type Actor } from "./rules.ts";
import { createStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const NOW = 10_000;

/** A fresh store over a temp directory, as every suite about the files uses. */
function board() {
	return createStore(temps.track(tempDir("pi-board-")));
}

describe("a card's clock", () => {
	test("never moves backwards, whatever moment a caller brings", async () => {
		const store = board();
		const card = await store.create({ title: "One", paths: [] }, LEAD, NOW);
		// A note from a caller whose clock is ahead, then one from a caller that read its clock before
		// the work it was doing — the shape a spot-check's ten-minute run leaves behind.
		const later = await store.mutate(card.id, { kind: "note", text: "one" }, LEAD, NOW + 5_000);
		const earlier = await store.mutate(card.id, { kind: "note", text: "two" }, LEAD, NOW);
		expect(later.ok && earlier.ok).toBe(true);
		// The write landed — a new rev, the note it carried — and only the field the gate reads held
		// still, so a sign the work has outgrown cannot be made to read as current.
		expect(earlier.card?.rev).toBe((later.card?.rev ?? 0) + 1);
		expect(earlier.card?.updatedAt).toBe(NOW + 5_000);
	});

	test("keeps the caller's own moment on the note and the log", async () => {
		const store = board();
		const card = await store.create({ title: "One", paths: [] }, LEAD, NOW);
		await store.mutate(card.id, { kind: "note", text: "one" }, LEAD, NOW + 5_000);
		const claimed = await store.mutate(card.id, { kind: "claim" }, LEAD, NOW);
		expect(claimed.ok).toBe(true);
		// The record says what each caller read: the note keeps the moment it was made, the log entry the
		// moment the card entered the lane. Only `updatedAt` is the store's promise, and the two must not
		// be confused.
		expect(claimed.card?.notes.at(-1)?.at).toBe(NOW + 5_000);
		expect(claimed.card?.log?.at(-1)?.at).toBe(NOW);
		expect(claimed.card?.updatedAt).toBe(NOW + 5_000);
	});
});
