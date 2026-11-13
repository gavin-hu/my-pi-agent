/**
 * The sign's message and its record, as one transaction.
 *
 * The message goes first because it is the half a person acts on, and the record second because it
 * is the retry: a record that could not be written says so, since a repeat would otherwise send the
 * same message again. Both doors word that, and this is where the wording has one owner — a suite
 * that drove only one door could not see the two drift apart, which is the defect the card named.
 *
 * It is its own suite because `extensions/board/signs.test.ts` and `sign.test.ts` are at the 400-line
 * bar, and because the capability is the pair's rather than either door's.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { BoardStore } from "../../lib/board/store.ts";
import { bench, claimedWithContract, flushFixture, PEER, type Sent, signBus } from "../../test/helpers/board-signs.ts";
import { signingBoard } from "../../test/helpers/board-command.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";

afterAll(flushFixture);

/** What a store that cannot write the record says, so a case names it once. */
const FAILED = "EACCES: the board is not writable";

/**
 * A board whose record cannot be written, and whose every other write lands.
 *
 * The record is the one thing that can fail after the message is already out, which is the case
 * both doors have to word — and the fixture is a real store with one op refused, not a mock of the
 * store's own rules.
 */
function failsRecord(store: BoardStore): BoardStore {
	return {
		...store,
		mutate: async (id, op, actor, now) =>
			op.kind === "announced" ? { ok: false as const, error: FAILED } : store.mutate(id, op, actor, now),
	};
}

describe("a record that could not be written", () => {
	test("is worded by the tool, and the card still owes the message", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent }) }, { wrapStore: failsRecord });
		await claimedWithContract(who);
		const approved = await who.lead.call({ action: "approve", card: "1" });
		expect(approved.isError).toBeFalsy();
		// The message went — the owner is not left in the dark about a sign that happened.
		expect(sent).toHaveLength(1);
		expect(resultText(approved)).toContain(`told ${PEER}`);
		// The record did not, and the line says which half failed rather than pretending.
		expect(resultText(approved)).toContain(`(not recorded: ${FAILED})`);
		// The card reads as never told, which is what makes the signer's repeat the retry.
		expect(approved.details.card?.contract?.approved?.told).toBeUndefined();
	});

	test("is worded the same by the person's door", async () => {
		const sent: Sent[] = [];
		const next = await signingBoard({ notify: signBus({ sent }), wrapStore: failsRecord });
		await next.store.mutate(
			next.id,
			{ kind: "contract", artifact: { path: next.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			next.me,
			1_000,
		);
		const line = await next.say("approve 1");
		expect(sent).toHaveLength(1);
		// One body words this, so the two doors cannot drift: the door's own prefix, and then the same
		// "told … (not recorded: …)" clause the tool prints, with only the peer's name differing.
		expect(line).toContain("board: #1 approved by you · told ");
		expect(line).toContain(`(not recorded: ${FAILED})`);
		next.temps.flush();
	});
});
