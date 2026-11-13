import { describe, expect, test } from "bun:test";
import { ACTIVITY_KINDS, ACTIVITY_LABEL, ACTIVITY_LABEL_JS, ACTIVITY_LIMIT, activityOf } from "./activity.ts";
import type { Card } from "./card.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";

const NOW = 1_000_000;

/** One card in the pool, with whatever the case needs changed. */
function card(overrides: Partial<Card> = {}): Card {
	return cardFixture("4", { title: "feature", createdAt: NOW - 9_000, updatedAt: NOW - 8_000, ...overrides });
}

describe("activityOf", () => {
	test("reads a move, a block, a note, an approval, a review and an offer off the cards", () => {
		const feed = activityOf([
			card({
				log: [
					{ lane: "plan", at: NOW - 5_000, by: "team-lead" },
					{ lane: "blocked", at: NOW - 4_000, by: "team-lead", block: { kind: "decision", note: "ask" } },
				],
				notes: [{ by: "team-lead", at: NOW - 3_000, text: "start here" }],
				contract: {
					goal: "g",
					acceptance: "a",
					scopeOut: "s",
					verify: "bun run check",
					approved: { by: "gavin", at: NOW - 2_000 },
				},
				review: { by: "gavin", at: NOW - 1_000 },
				offeredAt: NOW,
			}),
		]);
		expect(feed.events.map((event) => event.kind)).toEqual([
			"offered",
			"reviewed",
			"approved",
			"noted",
			"blocked",
			"moved",
		]);
		// A move names the lane it went to; a block names the one it is in, which is `blocked`.
		expect(feed.events[5]).toMatchObject({ kind: "moved", lane: "plan", card: "4" });
		expect(feed.events[4]).toMatchObject({ kind: "blocked", lane: "blocked" });
		// Only the two lane events carry a lane: the rest are about the card.
		expect(feed.events[0]?.lane).toBeUndefined();
		expect(feed.dropped).toBe(0);
	});

	test("is newest first, and settles a tie by card id so a frame cannot reorder it", () => {
		const feed = activityOf([
			cardFixture("9", { notes: [{ by: "a", at: NOW, text: "x" }] }),
			cardFixture("2", { notes: [{ by: "a", at: NOW, text: "x" }] }),
			cardFixture("5", { notes: [{ by: "a", at: NOW + 1, text: "x" }] }),
		]);
		expect(feed.events.map((event) => event.card)).toEqual(["5", "2", "9"]);
	});

	test("caps the rail and counts what the cap left out", () => {
		const notes = Array.from({ length: ACTIVITY_LIMIT + 4 }, (_, index) => ({
			by: "team-lead",
			at: NOW + index,
			text: `note ${String(index)}`,
		}));
		const feed = activityOf([card({ notes })]);
		expect(feed.events).toHaveLength(ACTIVITY_LIMIT);
		expect(feed.dropped).toBe(4);
		// The cap keeps the newest, so the newest note is the one at the front.
		expect(feed.events[0]?.at).toBe(NOW + ACTIVITY_LIMIT + 3);
		expect(activityOf([card({ notes })], 2).events).toHaveLength(2);
		expect(activityOf([card({ notes })], 0).events).toEqual([]);
	});

	test("invents nothing for a card whose own history was elided", () => {
		// The card's log and notes are bounded, and their dropped counts are the card's bound:
		// fabricating an event for each would put words in a record that does not hold them.
		const feed = activityOf([
			card({ log: [{ lane: "execute", at: NOW - 1, by: "x" }], logDropped: 3, notesDropped: 5 }),
		]);
		expect(feed.events).toHaveLength(1);
		expect(feed.events[0]?.kind).toBe("moved");
	});

	test("reads an empty board as an empty rail, not as an error", () => {
		expect(activityOf([])).toEqual({ events: [], dropped: 0 });
	});
});

describe("the label table", () => {
	test("covers every kind, and only the kinds a card can prove", () => {
		expect(Object.keys(ACTIVITY_LABEL).sort()).toEqual([...ACTIVITY_KINDS].sort());
		// One word per kind, and a move is the only one the page completes.
		expect(ACTIVITY_LABEL.moved).toContain("{lane}");
		expect(ACTIVITY_LABEL_JS).toBe(JSON.stringify(ACTIVITY_LABEL));
	});
});
