/**
 * The plan gate's two questions, held apart from `rules.test.ts` — what a dry run makes of a
 * deferred fact, and what a fact bound to another record is refused with.
 *
 * `rules.test.ts` is named at its height in `test/suite-sizes.test.ts`, and these are the two
 * answers the thunk in `artifact.ts` added: a caller hands over the way to find out, and the rule
 * takes it where it asks. The dry run asks the same thing without a lock, which is what makes
 * `team`'s pre-check and the write one answer.
 */

import { describe, expect, test } from "bun:test";
import { approved, boardOf, CORE, mayOp, provedFor } from "../../test/helpers/fixtures/board-rules.ts";

describe("the plan gate", () => {
	test("a dry run takes a deferred fact, so the question and the write cannot disagree", () => {
		const card = approved();
		const op = { kind: "move" as const, lane: "execute" as const };
		expect(mayOp(card, { ...op, artifact: () => provedFor(card) }, CORE, boardOf(card))).toBeUndefined();
	});

	test("no fact at all is the fail-closed refusal, never a missing-plan one", () => {
		// A surface that forgot to prove anything is told so, rather than hearing that a plan it never
		// named is gone — which is the difference between a bug in the caller and a deleted file.
		const card = approved();
		expect(mayOp(card, { kind: "move", lane: "execute" }, CORE, boardOf(card))).toContain("was not checked");
	});

	test("a fact bound to another record is refused as stale, not trusted", () => {
		const card = approved();
		const elsewhere = { path: card.planPath ?? "plans/webhook.md", recorded: "plans/another.md" };
		expect(mayOp(card, { kind: "move", lane: "execute", artifact: elsewhere }, CORE, boardOf(card))).toContain(
			"changed while it was being read",
		);
	});
});
