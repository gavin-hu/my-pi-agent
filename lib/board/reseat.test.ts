/**
 * The seat a resumed session stands in: the one operation that moves no lane.
 *
 * Split from `rules.test.ts`, which is at its line budget: a card whose owner stopped and whose
 * label a new session now wears belongs to that session, and the rule is what says so. What it must
 * prove is narrow and load-bearing — the work is untouched, and the four cases that look the same
 * from a distance are refused.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "./card.ts";
import type { Actor } from "./rules.ts";
import {
	applyOp,
	approved,
	boardOf,
	claimed,
	CORE,
	created,
	NOW,
	OTHER,
	proved,
	refusal,
	reviewed,
	stepOf,
} from "../../test/helpers/fixtures/board-rules.ts";

describe("the seat a resumed session stands in", () => {
	/** The session a `/resume` makes: the same name the card records, and a new id. */
	const RESUMED: Actor = { id: "s-core-resumed", label: CORE.label };
	/** The bus's answer about the owner a card names, bound to that owner. */
	const fact = (card: Card, state: "live" | "quiet" | "gone" | "absent") => ({
		owner: card.owner ?? { label: "nobody" },
		state,
	});

	test("re-points the owner to the session standing in its seat, and moves nothing else", () => {
		// The work is the lane, the plan, the approval and the spot-check — so a re-seat keeps every
		// one of them and changes the id a session is matched by.
		const card = approved();
		const seated = stepOf(card, { kind: "reseat", holder: fact(card, "gone") }, RESUMED);

		expect(seated.owner).toMatchObject({ id: RESUMED.id, label: CORE.label });
		expect(seated.lane).toBe(card.lane);
		expect(seated.planPath).toBe(card.planPath);
		expect(seated.contract).toEqual(card.contract);
		// The lane log is untouched: `laneSince` reads it to decide whether a spot-check is stale, so a
		// made-up transition there would move a rule rather than record one.
		expect(seated.log).toEqual(card.log);
		// The note is where the card explains a write its own `by` cannot: the old id's tail.
		expect(seated.notes.at(-1)?.text).toBe("re-seated from owner s-core, whose session had stopped");
	});

	test("takes the weaker fact of a pruned record, and refuses everything else", () => {
		// `absent` is a record the bus pruned, not a session it watched stop; the sweep says which. What
		// must not pass: another name, a record that may still be running, no fact at all, a label nobody
		// could resolve, and a finished card.
		const card = claimed();
		const refused = (actor: Actor, holder: ReturnType<typeof fact> | undefined) =>
			refusal(
				applyOp(card, { kind: "reseat", ...(holder === undefined ? {} : { holder }) }, actor, NOW, boardOf(card)),
			);

		expect(stepOf(card, { kind: "reseat", holder: fact(card, "absent") }, RESUMED).owner?.id).toBe(RESUMED.id);
		expect(refused(OTHER, fact(card, "gone"))).toBe(
			"#4 is held by billing-core; only that name can stand in its seat.",
		);
		expect(refused(RESUMED, fact(card, "live"))).toContain("is not stopped — it is live");
		expect(refused(RESUMED, fact(card, "quiet"))).toContain("is not stopped — it is quiet");
		expect(refused(RESUMED, undefined)).toContain("nothing says it stopped");
		// A caller the bus cannot name has no id to write: refused rather than storing one that is not there.
		expect(refused({ label: CORE.label }, fact(card, "gone"))).toContain("only by a session the bus names");

		const unresolved = { ...card, owner: { label: CORE.label, handoff: { at: 1, unresolved: true as const } } };
		expect(
			refusal(
				applyOp(
					unresolved,
					{ kind: "reseat", holder: { owner: unresolved.owner, state: "gone" } },
					RESUMED,
					NOW,
					boardOf(unresolved),
				),
			),
		).toContain("a label the bus could not name");

		const pool = created();
		expect(refusal(applyOp(pool, { kind: "reseat", holder: fact(pool, "gone") }, RESUMED, NOW, boardOf(pool)))).toBe(
			"#4 has no owner to re-seat.",
		);
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "reseat", holder: fact(done, "gone") }, RESUMED, NOW, boardOf(done)))).toBe(
			"#4 is done; there is nothing to re-seat.",
		);
	});
});
