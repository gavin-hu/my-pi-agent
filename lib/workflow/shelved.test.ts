/**
 * The shelf: its reason boundary, the shape a read is held to, and the two operations that
 * write it.
 *
 * Its own suite rather than more cases in `card.test.ts` or `rules.test.ts`, which both sit on
 * a size bar: the shelf is one capability — a pool card set aside — and the record's shape and
 * the lane matrix are the other suites'. The same split `kind.test.ts` took.
 */

import { describe, expect, test } from "bun:test";
import {
	accepted,
	applyOp,
	boardOf,
	CORE,
	claimed,
	created,
	doneOf,
	LEAD,
	mayOp,
	NOW,
	refusal,
	reviewed,
	stepOf,
} from "../../test/helpers/fixtures/board-rules.ts";
import { type CardShelved, isCard, isShelved, normalizeShelfNote } from "./card.ts";
import { MAX_BLOCKED } from "./lanes.ts";
import { sortForLane } from "./read.ts";

const SHELF: CardShelved = { at: 5_000, by: "tom", note: "waiting on pi 1.7 to publish" };

describe("normalizeShelfNote", () => {
	test("keeps one sanitized line, so a row can hold it", () => {
		expect(normalizeShelfNote("  waiting on pi 1.7\npublish  ")).toEqual({ note: "waiting on pi 1.7 publish" });
	});

	test("refuses an absent or empty reason, because a shelf with no why is a lost card", () => {
		for (const raw of [undefined, null, 7, "", "   "]) {
			expect(normalizeShelfNote(raw)).toHaveProperty("error");
		}
	});

	test("holds the one-line cap a block's sentence already has", () => {
		const long = "x".repeat(MAX_BLOCKED + 3);
		expect(normalizeShelfNote(long)).toEqual({
			error: `note is ${MAX_BLOCKED + 3} characters; the limit is ${MAX_BLOCKED} — trim 3.`,
		});
		expect(normalizeShelfNote("x".repeat(MAX_BLOCKED))).toEqual({ note: "x".repeat(MAX_BLOCKED) });
	});
});

describe("isShelved", () => {
	test("reads a shelf with a bound and one without", () => {
		expect(isShelved(SHELF)).toBe(true);
		expect(isShelved({ ...SHELF, until: 9_000 })).toBe(true);
	});

	test("refuses a shelf that lost its moment, its author, or its why", () => {
		for (const bad of [
			{ by: SHELF.by, note: SHELF.note },
			{ at: SHELF.at, note: SHELF.note },
			{ at: SHELF.at, by: SHELF.by },
			{ ...SHELF, note: "" },
			{ ...SHELF, by: "" },
			{ ...SHELF, at: 1.5 },
			{ ...SHELF, note: "x".repeat(MAX_BLOCKED + 1) },
			{ ...SHELF, until: "30d" },
			{ ...SHELF, until: 1.5 },
		]) {
			expect(isShelved(bad)).toBe(false);
		}
		for (const bad of [undefined, null, "shelved", 5]) expect(isShelved(bad)).toBe(false);
	});
});

describe("a shelf on the card", () => {
	test("a pool card carrying one is a card, and a card without one is unchanged", () => {
		expect(isCard({ ...created(), shelved: SHELF })).toBe(true);
		expect(isCard(created())).toBe(true);
	});

	test("a shelf this build cannot read is not a card", () => {
		// A hand-edited file is where this bites: the record is dropped rather than guessing which
		// half of the shelf was meant.
		for (const bad of [{ ...SHELF, note: "" }, { ...SHELF, at: "yesterday" }, true]) {
			expect(isCard({ ...created(), shelved: bad })).toBe(false);
		}
	});
});

describe("shelve and unshelve", () => {
	/** A card in the pool, set aside by the seat. */
	const aside = (note = "waiting on pi 1.7", until?: number) =>
		stepOf(created(), { kind: "shelve", note, ...(until === undefined ? {} : { until }) }, LEAD);

	test("sets a pool card aside with its one line, and marks who and when", () => {
		const card = aside();
		expect(card.lane).toBe("backlog");
		expect(card.shelved).toEqual({ at: NOW, by: LEAD.label, note: "waiting on pi 1.7" });
		expect("owner" in card).toBe(false);
	});

	test("needs no claim, which is the whole reason the seat can use it", () => {
		// The seat cannot hold a card, and a shelf asks it to hold nothing: the actor holds no card
		// here, and the operation still answers yes.
		const pool = created();
		expect(mayOp(pool, { kind: "shelve", note: "not now" }, LEAD, boardOf(pool))).toBeUndefined();
	});

	test("refuses a card somebody holds, and names the route back", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "shelve", note: "later" }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is in plan; only a pool card can be shelved — `board release 4` puts it back.",
		);
	});

	test("refuses a finished card", () => {
		const done = stepOf(reviewed(), doneOf(reviewed()), CORE);
		expect(refusal(applyOp(done, { kind: "shelve", note: "later" }, LEAD, NOW, boardOf(done)))).toBe(
			"#4 is done; it cannot be shelved.",
		);
	});

	test("fixes the reason on a repeat, and keeps the moment it went aside", () => {
		const first = aside();
		const again = accepted(
			applyOp(first, { kind: "shelve", note: "waiting on the release" }, LEAD, NOW + 5_000, boardOf(first)),
		);
		expect(again.changed).toBe(true);
		expect(again.card.shelved).toEqual({ at: NOW, by: LEAD.label, note: "waiting on the release" });
	});

	test("repeating the same sentence is the same shelf, so the revision does not move", () => {
		const first = aside();
		const again = applyOp(first, { kind: "shelve", note: "waiting on pi 1.7" }, LEAD, NOW + 5_000, boardOf(first));
		expect(accepted(again).changed).toBe(false);
	});

	test("bounds the shelf to a moment, from the width the door read", () => {
		expect(aside("until the release", 86_400_000).shelved?.until).toBe(NOW + 86_400_000);
	});

	test("refuses a width that is not one, and a reason a row cannot hold", () => {
		const pool = created();
		const refused = (op: Parameters<typeof applyOp>[1]) => refusal(applyOp(pool, op, LEAD, NOW, boardOf(pool)));
		expect(refused({ kind: "shelve", note: "x", until: -1 })).toBe(
			"until must be a length of time in whole milliseconds.",
		);
		expect(refused({ kind: "shelve", note: "x".repeat(MAX_BLOCKED + 1) })).toContain(`the limit is ${MAX_BLOCKED}`);
		expect(refused({ kind: "shelve" })).toBe("note is required: say why the card is set aside.");
	});

	test("answers an open offer, so the two pool facts never share a card", () => {
		const offered = stepOf(created(), { kind: "offer" }, LEAD);
		expect(offered.offeredAt).toBe(NOW);
		expect("offeredAt" in stepOf(offered, { kind: "shelve", note: "not now" }, LEAD)).toBe(false);
	});

	test("a shelved card is not offered", () => {
		const card = aside();
		expect(refusal(applyOp(card, { kind: "offer" }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is shelved (waiting on pi 1.7); unshelve it first.",
		);
	});

	test("a claim clears the shelf, because taking the card is the decision", () => {
		expect("shelved" in stepOf(aside(), { kind: "claim" }, CORE)).toBe(false);
	});

	test("unshelve puts it back, and is a no-op when nothing was set aside", () => {
		const back = stepOf(aside(), { kind: "unshelve" }, LEAD);
		expect("shelved" in back).toBe(false);
		expect(back.lane).toBe("backlog");
		expect(accepted(applyOp(back, { kind: "unshelve" }, LEAD, NOW, boardOf(back))).changed).toBe(false);
	});

	test("a hand-edited shelf on a held card does not survive a return to the pool", () => {
		// A shelf only ever sits on a pool card, so this record is one this build cannot write: the
		// write that returns the card clears it rather than leaving the field on somebody's work.
		const stale = { ...claimed(), shelved: { at: NOW, by: LEAD.label, note: "hand-edited" } };
		expect("shelved" in stepOf(stale, { kind: "reclaim" }, LEAD)).toBe(false);
	});

	test("a shelved pool card rides at the bottom of the pool it stays in", () => {
		const aside = { at: NOW, by: LEAD.label, note: "not now" };
		const idle = { ...created(), id: "5", title: "Later" };
		const shelf = { ...created(), id: "6", title: "Much later", shelved: aside };
		// The pool's order is the store's: lane, then the shelf, then priority and id.
		expect(sortForLane([shelf, idle]).map((card) => card.id)).toEqual(["5", "6"]);
	});
});
