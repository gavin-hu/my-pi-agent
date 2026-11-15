/**
 * Which spot-check still speaks for a card: the lane it was made in, and whether the card has been
 * written since.
 *
 * The board's three readers — the lead's queue (`gateOf`), the card's reason line (`reasonFor`) and
 * the `done` gate (`spotCheckRefusal`) — ask this one rule, and the sign that re-makes a stamp asks
 * it too, so these are the rule's own cases: when a sign counts, and when a write has outgrown it.
 * A suite of its own because that question is what the readers used to disagree about, and
 * `lead.test.ts` is at its height in `test/suite-sizes.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { LEAD as BOARD_LEAD } from "../../test/helpers/fixtures/board-rules.ts";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import { type Card } from "./card.ts";
import { currentReview, signStale } from "./lead.ts";

/** A card this suite signs, so a case names only the fields the sign reads. */
const card = (overrides: Partial<Card> = {}) => numberedCard("4", overrides);

describe("currentReview", () => {
	/** An executing card that entered its lane at `since`, with a sign made at `at`. */
	const signed = (since: number, at: number) =>
		card({
			lane: "execute",
			owner: { label: "billing-core" },
			review: { by: "billing-lead", at },
			log: [
				{ lane: "backlog", at: since - 2_000, by: "billing-lead" },
				{ lane: "execute", at: since, by: "billing-core" },
			],
		});

	test("answers with the sign made since the card entered the lane", () => {
		expect(currentReview(signed(2_000, 3_000))).toMatchObject({ by: "billing-lead", at: 3_000 });
		expect(currentReview(signed(2_000, 2_000))).toMatchObject({ at: 2_000 });
	});

	test("answers nothing for a sign a previous execution left on the card", () => {
		// A reclaim keeps the lead's spot-check, and a kept sign is evidence about the work that was
		// taken back rather than about the execution the card is in now.
		expect(currentReview(signed(2_000, 1_500))).toBeUndefined();
	});

	test("answers nothing for a sign the card has been written after", () => {
		// The card changing under the evidence is the same fact the `done` gate refuses with, so a
		// queue that read the sign as current kept the card away from the lead who owes it a look.
		expect(currentReview({ ...signed(2_000, 3_000), updatedAt: 3_500 })).toBeUndefined();
	});

	test("keeps a sign the announcement followed, which is the sign's own second write", () => {
		// #398: the record that the owner heard lands after the stamp and moves the card's clock, so the
		// comparison is against the later of the two writes and not the stamp alone.
		const told = {
			...signed(2_000, 3_000),
			updatedAt: 4_000,
			review: { by: "billing-lead", at: 3_000, told: { at: 4_000 } },
		};
		expect(currentReview(told)).toMatchObject({ at: 3_000 });
	});

	test("keeps a sign a finished card carries, whatever the lane entry says", () => {
		// `done` is the lane the sign is evidence for, so the entry it followed is not a cut-off.
		const done = card({
			lane: "done",
			owner: { label: "billing-core" },
			review: { by: "lead", at: 1_000 },
			log: [{ lane: "done", at: 2_000, by: "billing-core" }],
		});
		expect(currentReview(done)).toMatchObject({ at: 1_000 });
	});

	test("keeps a sign whose lane entry the log no longer has", () => {
		// An elided log is not a reason to demand a second signature: the sign is the only evidence
		// left, and asking again for one already made is the worse answer.
		const silent = card({ lane: "execute", owner: { label: "billing-core" }, review: { by: "lead", at: 1_000 } });
		expect(currentReview(silent)).toMatchObject({ at: 1_000 });
	});
});

describe("signStale", () => {
	test("the card's own clock, against the sign and the announcement that followed it", () => {
		const stamp = { by: BOARD_LEAD.label, at: 2_000 };
		expect(signStale(card({ updatedAt: 2_000 }), stamp)).toBe(false);
		expect(signStale(card({ updatedAt: 2_001 }), stamp)).toBe(true);
		// The announcement is the sign's own second write, so it buys the stamp the time it needs:
		// reading the card's clock against the stamp alone refused the golden path (#398).
		const told = { ...stamp, told: { at: 2_500 } };
		expect(signStale(card({ updatedAt: 2_500 }), told)).toBe(false);
		expect(signStale(card({ updatedAt: 2_501 }), told)).toBe(true);
	});
});
