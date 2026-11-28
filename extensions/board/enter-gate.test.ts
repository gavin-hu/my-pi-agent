/**
 * The board's one question about plan mode, and the handler that asks it.
 *
 * The case this closes is a session whose work is still in the pool: `heldCards` never returns a
 * pool card — `card.ts` keeps it ownerless — so the refusal cannot come from the lane table. This
 * is the step before it, and its sentence is the deliverable a lead spot-checks. The two
 * stand-downs live here too: plan mode's own block is the stricter answer while planning, and a
 * board that does not speak for a session must not gate it at all.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { guardedBoard } from "../../test/helpers/board.ts";
import { boardCard } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { planEntryRefusal } from "./enter-gate.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the refusal", () => {
	test("names the claim when nothing is held, and the team's own way out", () => {
		const refused = planEntryRefusal([], "team");
		expect(refused).toContain("plan mode needs a card you hold");
		expect(refused).toContain("`board claim <id>`");
		expect(refused).toContain("`/team exit`");
	});

	test("a held card is the whole allowance, whatever lane it is in", () => {
		for (const lane of ["plan", "execute", "blocked"] as const) {
			expect(planEntryRefusal([boardCard("953", { lane })], "team")).toBeUndefined();
		}
	});

	test("a solo board names no door it does not have", () => {
		const refused = planEntryRefusal([], "solo");
		expect(refused).toContain("`board add`");
		expect(refused).not.toContain("/team exit");
	});
});

describe("the handler", () => {
	test("refuses the model's plan entry while its card is still in the pool", async () => {
		const next = await guardedBoard({ track: temps.track, claim: false });
		const refused = await next.call("plan", { action: "enter" });
		expect(refused?.block).toBe(true);
		expect(refused?.reason).toContain("plan mode needs a card you hold");
		expect(refused?.reason).toContain("`board claim <id>`");
	});

	test("allows it for the card this session holds", async () => {
		const next = await guardedBoard({ track: temps.track });
		expect(await next.call("plan", { action: "enter" })).toBeUndefined();
	});

	test("is not the answer while plan mode is already on, so one call gets one sentence", async () => {
		const planning = await guardedBoard({
			track: temps.track,
			claim: false,
			branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
		});
		expect(await planning.call("plan", { action: "enter" })).toBeUndefined();
	});

	test("says nothing on a bus that holds no record of this session", async () => {
		// The board's tool is withheld from an off-team session, so the board is not its gate: the
		// no-brick rule `write-gate.ts` states, applied to the step before it.
		const off = await guardedBoard({ track: temps.track, claim: false, bus: true });
		expect(await off.call("plan", { action: "enter" })).toBeUndefined();
	});
});
