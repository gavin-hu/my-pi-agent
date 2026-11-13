/**
 * The two gates on a project that names no lead.
 *
 * A project states its own team, so a board may name no lead at all — and that state has two
 * halves, proved together because either one alone reads as broken. A session is refused with the
 * sentence that names `team.lead`, and the person's `/board approve` and `/board review` still sign
 * both gates: that second half is what a wrong optional type on `config.lead` would quietly break.
 *
 * It is its own suite because `signs.test.ts` and `sign.test.ts` are at the 400-line bar, and
 * because the capability is the unstated team's rather than either door's.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PERSON_LABEL } from "../../lib/board/lead.ts";
import { bench, claimedWithContract, flushFixture } from "../../test/helpers/board-signs.ts";
import { signingBoard } from "../../test/helpers/board-command.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";

afterAll(flushFixture);

/** The clause a sign carries when nobody could be told: this harness registers no `session-bus`. */
const NOT_TOLD = " · team-agent-slead was not told (the session bus is not loaded)";

describe("a board that names no lead", () => {
	test("refuses a session's sign with the sentence that names the setting", async () => {
		const board = bench({}, { lead: "" });
		await claimedWithContract(board);
		const refused = await board.lead.call({ action: "approve", card: "1" });
		expect(resultText(refused)).toEndWith(
			"#1's contract is signed by the lead, and this board names none: set `team.lead` in `bytefly.json`, or the person signs it with `/board approve 1`.",
		);
		// The refusal is a reading, not a write: the card keeps the contract it had.
		expect((await board.peer.call({ action: "list", card: "1" })).details.card?.contract?.approved).toBeUndefined();
	});

	test("still signs both gates as the person, which is the one door an unset lead leaves", async () => {
		const board = await signingBoard({ lead: "" });
		await board.store.mutate(
			board.id,
			{
				kind: "contract",
				artifact: { path: board.plan },
				goal: "g",
				acceptance: "a",
				scopeOut: "s",
				verify: "bun run check",
			},
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe(`board: #1 approved by you${NOT_TOLD}`);
		// The approval opens `execute` even though no session is the lead: the person's sign is the
		// gate, and a board with none named is not a board that cannot move.
		expect(
			(
				await board.store.mutate(
					board.id,
					{ kind: "move", lane: "execute", artifact: { path: board.plan } },
					board.me,
					1_000,
				)
			).ok,
		).toBe(true);
		expect(await board.say("review 1")).toContain("board: #1 reviewed by you");
		// Recorded under the person's own label, because there is no lead's name to lend — and with the
		// run the contract named, which the sign keeps as its evidence.
		expect((await board.store.read(board.id))?.review).toMatchObject({
			by: PERSON_LABEL,
			at: 1_000,
			person: true,
			verified: { cmd: "bun run check", exit: 0 },
		});
		board.temps.flush();
	});
});
