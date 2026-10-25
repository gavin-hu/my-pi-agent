/**
 * The card lifecycle: who may do what, what a refusal says, and the invariants
 * that hold after every accepted operation.
 *
 * One table is the contract for the tool, the router, and the page, so these
 * cases are the whole authorisation story for a card. The last describe pins the
 * rule the store depends on: an operation re-applied to a card that changed
 * underneath re-checks its own preconditions instead of forcing the new state.
 */

import { describe, expect, test } from "bun:test";
import { type Card, MAX_NOTES } from "./card.ts";
import { type Actor, applyOp, createCard, holds, type OpResult } from "./rules.ts";

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };
const NOW = 2_000;

/** A claimed card, which is where most operations start. */
function claimed(owner: Actor = CORE): Card {
	const created = createCard("4", { title: "Billing webhook accepts orders", paths: ["src/billing"] }, LEAD, 1_000);
	const result = applyOp(created, { kind: "claim" }, owner, 1_000);
	if (!result.ok) throw new Error(result.error);
	return result.card;
}

/** The accepted result, or a failure that names the refusal. */
function accepted(result: OpResult): { card: Card; changed: boolean } {
	if (!result.ok) throw new Error(`expected acceptance, got: ${result.error}`);
	return { card: result.card, changed: result.changed };
}

/** The refusal's message, or a failure that names the card it wrongly returned. */
function refusal(result: OpResult): string {
	if (result.ok) throw new Error("expected a refusal, got an accepted operation");
	return result.error;
}

describe("createCard", () => {
	test("is born todo, unowned, at revision 1", () => {
		const card = createCard("4", { title: "T", paths: ["src"] }, LEAD, NOW);
		expect(card).toMatchObject({ v: 1, id: "4", status: "todo", rev: 1, by: LEAD.label });
		expect("owner" in card).toBe(false);
		expect(card.createdAt).toBe(NOW);
		expect(card.updatedAt).toBe(NOW);
	});

	test("takes the first note, attributed and stamped", () => {
		const card = createCard("4", { title: "T", paths: [], note: "from the page" }, LEAD, NOW);
		expect(card.notes).toEqual([{ by: LEAD.label, at: NOW, text: "from the page" }]);
	});
});

describe("claim", () => {
	test("moves a todo card to doing, owned by the claimer", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card, changed } = accepted(applyOp(created, { kind: "claim" }, CORE, NOW));
		expect(changed).toBe(true);
		expect(card).toMatchObject({ status: "doing", owner: { id: CORE.id, label: CORE.label }, rev: 2, by: CORE.label });
		expect(card.updatedAt).toBe(NOW);
	});

	test("records a label alone when the session has no id yet", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card } = accepted(applyOp(created, { kind: "claim" }, { label: "ad-hoc" }, NOW));
		expect(card.owner).toEqual({ label: "ad-hoc" });
	});

	test("already holding it is a no-op, not a second revision", () => {
		const card = claimed();
		const { card: same, changed } = accepted(applyOp(card, { kind: "claim" }, CORE, NOW));
		expect(changed).toBe(false);
		expect(same.rev).toBe(card.rev);
	});

	test("refuses a card another session holds, naming it", () => {
		expect(refusal(applyOp(claimed(), { kind: "claim" }, OTHER, NOW))).toBe("#4 is held by billing-core.");
	});

	test("refuses a finished card", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(refusal(applyOp(done, { kind: "claim" }, LEAD, NOW))).toBe("#4 is done; it cannot be claimed.");
	});

	test("a renamed session still holds its card, because the id decides", () => {
		const card = claimed();
		expect(holds(card, { id: CORE.id, label: "renamed-core" })).toBe(true);
		expect(holds(card, { id: "s-someone-else", label: CORE.label })).toBe(false);
	});

	test("a label decides when either side has no id", () => {
		const card = claimed({ label: "billing-core" });
		expect(holds(card, { label: "BILLING-CORE" })).toBe(true);
		expect(holds(card, { label: "billing-other" })).toBe(false);
	});
});

describe("assign", () => {
	test("hands an unclaimed card to the target, and records the lead as the writer", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card } = accepted(applyOp(created, { kind: "assign", to: CORE }, LEAD, NOW));
		expect(card).toMatchObject({ status: "doing", owner: { id: CORE.id, label: CORE.label }, by: LEAD.label });
	});

	test("refuses a card a third session holds", () => {
		expect(refusal(applyOp(claimed(CORE), { kind: "assign", to: OTHER }, LEAD, NOW))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a finished card", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(refusal(applyOp(done, { kind: "assign", to: OTHER }, LEAD, NOW))).toBe("#4 is done; it cannot be assigned.");
	});

	test("re-assigning to the holder is a no-op", () => {
		const card = claimed();
		const { changed } = accepted(applyOp(card, { kind: "assign", to: CORE }, LEAD, NOW));
		expect(changed).toBe(false);
	});
});

describe("release", () => {
	test("clears the owner and returns the card to todo, with no owner key left behind", () => {
		const { card } = accepted(applyOp(claimed(), { kind: "release" }, CORE, NOW));
		expect(card.status).toBe("todo");
		expect("owner" in card).toBe(false);
		expect(card.notes).toEqual([]);
	});

	test("refuses a session that does not hold it", () => {
		expect(refusal(applyOp(claimed(), { kind: "release" }, OTHER, NOW))).toBe(
			"#4 is held by billing-core. Release is the owner's decision.",
		);
	});

	test("refuses an unclaimed card", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "release" }, LEAD, NOW))).toBe("#4 is not claimed.");
	});
});

describe("move", () => {
	test("an owner parks a card and picks it up again", () => {
		const blocked = accepted(applyOp(claimed(), { kind: "move", status: "blocked" }, CORE, NOW)).card;
		expect(blocked.status).toBe("blocked");
		expect(accepted(applyOp(blocked, { kind: "move", status: "doing" }, CORE, NOW)).card.status).toBe("doing");
	});

	test("blocked may finish without going back through doing", () => {
		const blocked = accepted(applyOp(claimed(), { kind: "move", status: "blocked" }, CORE, NOW)).card;
		expect(accepted(applyOp(blocked, { kind: "move", status: "done" }, CORE, NOW)).card.status).toBe("done");
	});

	test("moving to the lane it is already in writes nothing", () => {
		const card = claimed();
		const { changed } = accepted(applyOp(card, { kind: "move", status: "doing" }, CORE, NOW));
		expect(changed).toBe(false);
	});

	test("refuses a card someone else holds", () => {
		expect(refusal(applyOp(claimed(), { kind: "move", status: "done" }, OTHER, NOW))).toBe(
			"#4 is held by billing-core. Only its owner can move it.",
		);
	});

	test("refuses an unclaimed card, naming claim", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "move", status: "doing" }, LEAD, NOW))).toBe(
			"#4 is unclaimed; claim it before moving it to doing.",
		);
	});

	test("refuses to move a finished card anywhere", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(refusal(applyOp(done, { kind: "move", status: "blocked" }, CORE, NOW))).toBe(
			"#4 is done; it cannot be moved.",
		);
	});
});

describe("note", () => {
	test("anyone may note a card, and the writer is recorded", () => {
		const { card } = accepted(applyOp(claimed(), { kind: "note", text: "routes wired" }, LEAD, NOW));
		expect(card.notes.at(-1)).toEqual({ by: LEAD.label, at: NOW, text: "routes wired" });
		expect(card.rev).toBe(claimed().rev + 1);
	});

	test("keeps the last MAX_NOTES and counts what dropped", () => {
		let card = claimed();
		for (let index = 0; index < MAX_NOTES + 2; index++) {
			card = accepted(applyOp(card, { kind: "note", text: `note ${index}` }, CORE, NOW)).card;
		}
		expect(card.notes).toHaveLength(MAX_NOTES);
		expect(card.notesDropped).toBe(2);
		expect(card.notes.at(-1)?.text).toBe(`note ${MAX_NOTES + 1}`);
	});

	test("refuses empty text", () => {
		expect(refusal(applyOp(claimed(), { kind: "note", text: "  " }, CORE, NOW))).toBe("text is required.");
	});
});

describe("plan", () => {
	test("the owner records the plan it is executing", () => {
		const { card } = accepted(applyOp(claimed(), { kind: "plan", path: "~/.pi/agent/plans/k/billing.md" }, CORE, NOW));
		expect(card.plan).toBe("~/.pi/agent/plans/k/billing.md");
	});

	test("recording the same plan again writes nothing", () => {
		const card = accepted(applyOp(claimed(), { kind: "plan", path: "p.md" }, CORE, NOW)).card;
		expect(accepted(applyOp(card, { kind: "plan", path: "p.md" }, CORE, NOW)).changed).toBe(false);
	});

	test("only the owner records one", () => {
		expect(refusal(applyOp(claimed(), { kind: "plan", path: "p.md" }, OTHER, NOW))).toBe(
			"#4 is held by billing-core. Only its owner records a plan.",
		);
	});

	test("a finished card keeps the plan it finished with", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(refusal(applyOp(done, { kind: "plan", path: "p.md" }, CORE, NOW))).toBe(
			"#4 is done; its plan cannot change.",
		);
	});
});

describe("reclaim", () => {
	test("clears the owner, keeps the notes, and records the reclaimer", () => {
		const noted = accepted(applyOp(claimed(), { kind: "note", text: "half done" }, CORE, NOW)).card;
		const { card } = accepted(applyOp(noted, { kind: "reclaim" }, LEAD, NOW));
		expect(card.status).toBe("todo");
		expect("owner" in card).toBe(false);
		expect(card.notes.map((entry) => entry.text)).toEqual(["half done"]);
		expect(card.by).toBe(LEAD.label);
	});

	test("refuses an unclaimed or finished card", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "reclaim" }, LEAD, NOW))).toBe("#4 has no owner to reclaim.");
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(refusal(applyOp(done, { kind: "reclaim" }, LEAD, NOW))).toBe("#4 is done; there is nothing to reclaim.");
	});
});

describe("drop", () => {
	test("an abandoned todo card is anyone's to drop", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(accepted(applyOp(created, { kind: "drop" }, OTHER, NOW)).changed).toBe(true);
	});

	test("finished history is anyone's to drop", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(accepted(applyOp(done, { kind: "drop" }, OTHER, NOW)).changed).toBe(true);
	});

	test("its owner drops a live card", () => {
		expect(accepted(applyOp(claimed(), { kind: "drop" }, CORE, NOW)).changed).toBe(true);
	});

	test("a live card held by someone else is refused", () => {
		expect(refusal(applyOp(claimed(), { kind: "drop" }, OTHER, NOW))).toBe(
			"#4 is held by billing-core. It cannot be dropped while someone holds it.",
		);
	});
});

describe("re-applying an operation to a card that changed underneath", () => {
	// The store re-reads on a lost compare-and-set and applies the operation once
	// more. That second application must re-check the operation's own
	// preconditions: an operation says "apply when this holds", never "force this".
	test("a move the owner was going to make is refused once the card was released", () => {
		const released = accepted(applyOp(claimed(), { kind: "release" }, CORE, NOW)).card;
		expect(refusal(applyOp(released, { kind: "move", status: "done" }, CORE, NOW))).toBe(
			"#4 is unclaimed; claim it before moving it to done.",
		);
	});

	test("a claim loses to the session that got there first, and names it", () => {
		const takenByOther = claimed(OTHER);
		expect(refusal(applyOp(takenByOther, { kind: "claim" }, CORE, NOW))).toBe("#4 is held by billing-other.");
	});

	test("a note still applies, because noting has no precondition to lose", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", status: "done" }, CORE, NOW)).card;
		expect(accepted(applyOp(done, { kind: "note", text: "shipped" }, LEAD, NOW)).card.notes).toHaveLength(1);
	});
});

describe("the invariants hold after every accepted operation", () => {
	const ops = [
		(card: Card) => applyOp(card, { kind: "note", text: "n" }, LEAD, NOW),
		(card: Card) => applyOp(card, { kind: "move", status: "blocked" }, CORE, NOW),
		(card: Card) => applyOp(card, { kind: "plan", path: "p.md" }, CORE, NOW),
		(card: Card) => applyOp(card, { kind: "release" }, CORE, NOW),
		(card: Card) => applyOp(card, { kind: "reclaim" }, LEAD, NOW),
		(card: Card) => applyOp(card, { kind: "claim" }, CORE, NOW),
	];

	test("todo means no owner, and the other three always have one", () => {
		for (const op of ops) {
			const result = op(claimed());
			if (!result.ok) continue;
			const card = result.card;
			expect(card.status === "todo").toBe(card.owner === undefined);
		}
	});

	test("every accepted write moves the revision and the clock", () => {
		for (const op of ops) {
			const before = claimed();
			const result = op(before);
			if (!result.ok || !result.changed) continue;
			expect(result.card.rev).toBe(before.rev + 1);
			expect(result.card.updatedAt).toBe(NOW);
		}
	});
});
