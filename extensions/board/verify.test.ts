/**
 * The run a spot-check makes, over the tool: the command its card's contract names, and what the
 * sign records when it passes or refuses it.
 *
 * The state machine's answer is `lib/board/signs.test.ts`, and the seam's is
 * `lib/board/verify.test.ts`; what this suite proves is the wiring a model sees — that `review`
 * reads the contract's command, runs it before anything is written, and hands the store a result
 * (or refuses with a sentence that names the command). It is its own suite because
 * `extensions/board/signs.test.ts` is at the 400-line bar and a suite that is named in
 * `test/suite-sizes.test.ts` may not gain a line.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	bench,
	claimedWithContract,
	flushFixture,
	LEAD,
	NOW,
	runner,
	type Session,
	signPlan as writePlan,
} from "../../test/helpers/board-signs.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";

afterAll(flushFixture);

/** The command a card's contract names in these cases, and its one run. */
const VERIFY = "bun run check";

/** A card in `execute` whose contract names `verify`, or one that names no command. */
async function running(who: { lead: Session; peer: Session }, verify?: string): Promise<void> {
	await claimedWithContract(who);
	if (verify !== undefined) {
		await who.peer.call({ action: "contract", card: "1", path: await writePlan(who.peer), verify });
	}
	// The lead signs the wording, then the holder moves it: the gates a run sits behind.
	await who.lead.call({ action: "approve", card: "1" });
	await who.peer.call({ action: "move", card: "1", lane: "execute" });
}

describe("a spot-check whose contract names a command", () => {
	test("runs it, and the exit and the commit ride the sign", async () => {
		const run = runner();
		const who = bench({ verify: run });
		await running(who, VERIFY);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		expect(reviewed.isError).toBeFalsy();
		expect(run.ran).toEqual([VERIFY]);
		// The record is the run's, and the card is what the store ended up with.
		expect(reviewed.details.card?.review?.verified).toEqual({ cmd: VERIFY, exit: 0, at: NOW });
		expect(reviewed.details.card?.review?.by).toBe(LEAD);
	});

	test("a card whose contract names no command runs nothing", async () => {
		const run = runner();
		const who = bench({ verify: run });
		await running(who);
		expect((await who.lead.call({ action: "review", card: "1" })).isError).toBeFalsy();
		expect(run.ran).toEqual([]);
	});

	test("a red command refuses the sign, naming the exit and what it printed", async () => {
		const who = bench({ verify: runner({ exit: 1, output: "3 tests failed\n  see above" }) });
		await running(who, VERIFY);
		const refused = await who.lead.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain(`\`${VERIFY}\` exited 1`);
		expect(resultText(refused)).toContain("3 tests failed see above");
		// Nothing was signed: a red check is the gate working, not a failed call on a card.
		expect(refused.details.card?.review).toBeUndefined();
	});

	test("a run that outlives its bound is refused, naming the bound", async () => {
		const who = bench({ verify: runner({ killed: true, exit: -1 }) });
		await running(who, VERIFY);
		const refused = await who.lead.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("did not finish within 10 minutes");
	});

	test("the run is what done reads: a note after it refuses the close", async () => {
		const who = bench({ verify: runner() });
		await running(who, VERIFY);
		expect((await who.lead.call({ action: "review", card: "1" })).isError).toBeFalsy();
		// A write after the sign: the bench's clock is fixed, so the later moment is the store's.
		const store = await who.peer.board.runtime.store(who.peer.board.ctx.cwd);
		const me = await who.peer.board.runtime.who(who.peer.board.ctx, who.peer.board.ctx.cwd);
		expect((await store.mutate("1", { kind: "note", text: "one more thing" }, me, NOW + 1)).ok).toBe(true);
		const refused = await who.peer.call({ action: "move", card: "1", lane: "done" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("was written after its spot-check");
	});
});
