/**
 * A card's clock: the one moment a write may not move backwards, and the moments that stay the
 * caller's own.
 *
 * `updatedAt` is what the `done` gate reads — `signStale` asks whether the card was written since
 * its sign — and every caller samples its own clock, some of them before work that takes minutes: a
 * spot-check's command has a ten-minute bound. So this field is the store's to keep monotonic, while
 * a note's `at` and the transition log's stay what the caller read. A sign is the third kind: its
 * moment is its caller's, floored at the card's own, because a stamp the card has already passed can
 * never speak for it and the gate's own remedy would ask for the same sign again.
 *
 * It is its own suite because `lib/board/rules.test.ts` is at its height in `test/suite-sizes.test.ts`,
 * and because the property is the store's rather than one operation's.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { advance } from "../../test/helpers/board-flow.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { personActor } from "./lead.ts";
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

	test("signs a card its reviewer's clock is behind, so `done` opens", async () => {
		const store = board();
		const card = await store.create({ title: "Ahead", paths: [] }, LEAD, NOW);
		// A peer whose clock runs five seconds ahead writes the card after it was created, which is the
		// only way this field gets ahead of a reviewer signing later on a clock that is right.
		await store.mutate(card.id, { kind: "note", text: "from a machine ahead" }, LEAD, NOW + 5_000);
		await advance(store, card.id, "execute", { owner: LEAD }, NOW);
		// The spot-check is signed at this session's own moment, which the card has already passed. The
		// stamp takes the card's, because a sign older than the card it signs refuses `done` for good —
		// and the remedy that refusal prints is this same sign, made again at the same clock.
		const signed = await store.mutate(
			card.id,
			{ kind: "review", verified: { cmd: "bun run check", exit: 0, at: NOW } },
			personActor(),
			NOW,
		);
		expect(signed.ok && signed.card?.review?.at).toBe(NOW + 5_000);
		const done = await store.mutate(
			card.id,
			{ kind: "move", lane: "done", artifact: { path: `${card.id}.md` } },
			LEAD,
			NOW,
		);
		expect(done.ok ? done.card?.lane : done.error).toBe("done");
	});
});
