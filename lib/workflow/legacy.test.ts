/**
 * A contract stored before `verify` was a required line.
 *
 * The fourth line is required now: `contract` refuses an empty command, `approve` refuses a
 * contract that names none, and a close refuses a sign it cannot answer for. A card stored while
 * the line was optional still reads and still signs on a reader's sentence — the compatibility
 * half, which neither `rules.test.ts` nor `signs.test.ts` owns.
 */

import { describe, expect, test } from "bun:test";
import { isContract, missingContractFields } from "./contract.ts";
import { noVerifyCommand } from "./lead.ts";
import {
	applyOp,
	boardOf,
	CORE,
	LEAD,
	LEGACY_CONTRACT,
	NOW,
	doneOf,
	refusal,
	stepOf,
	legacyCard,
} from "../../test/helpers/fixtures/board-rules.ts";

describe("a contract stored before the fourth line was required", () => {
	test("still reads, and owes the line the gate asks for", () => {
		expect(isContract(LEGACY_CONTRACT)).toBe(true);
		expect(missingContractFields(LEGACY_CONTRACT)).toEqual(["verify"]);
	});

	test("signs on a reader's sentence, because there is no command to run", () => {
		// The record a stored card carries: evidence was never asked of it, and nothing invents one.
		expect(stepOf(legacyCard(), { kind: "review" }, LEAD).review?.verified).toBeUndefined();
	});

	test("is refused a run, because a command the card never promised proves nothing", () => {
		const card = legacyCard();
		const run = { cmd: "bun run check", exit: 0, at: NOW };
		expect(refusal(applyOp(card, { kind: "review", verified: run }, LEAD, NOW, boardOf(card)))).toContain(
			"names no command",
		);
	});

	test("is refused a close, naming the line and the approval recording it costs", () => {
		const legacy = stepOf(legacyCard(), { kind: "review" }, LEAD);
		expect(refusal(applyOp(legacy, doneOf(legacy), CORE, NOW, boardOf(legacy)))).toContain("names no `verify` command");
	});

	test("said as one sentence: the line, the action, and the approval it costs", () => {
		expect(noVerifyCommand(legacyCard(), LEAD.label)).toBe(
			"#4's contract names no `verify` command, so there is no run for its spot-check: its holder records one with `contract`, and the approval that drops is signed again by the lead (billing-lead) or the person with `/board approve 4`.",
		);
		// A project that names no lead names the setting, as every sentence beside it does.
		expect(noVerifyCommand(legacyCard(), "")).toContain("the lead (`team.lead`)");
	});
});
