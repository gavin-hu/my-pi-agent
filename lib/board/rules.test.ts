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
import { type Card, type Lane, MAX_LOG, MAX_NOTES } from "./card.ts";
import { indexOf } from "./links.ts";
import { type Actor, applyOp, createCard, holds, type OpResult } from "./rules.ts";

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };
const NOW = 2_000;

/** A claimed card, which is where most operations start. */
function claimed(owner: Actor = CORE): Card {
	const created = createCard("4", { title: "Billing webhook accepts orders", paths: ["src/billing"] }, LEAD, 1_000);
	const result = applyOp(created, { kind: "claim" }, owner, 1_000, indexOf([created]));
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
		expect(card).toMatchObject({ v: 1, id: "4", lane: "todo", rev: 1, by: LEAD.label });
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
		const { card, changed } = accepted(applyOp(created, { kind: "claim" }, CORE, NOW, indexOf([created])));
		expect(changed).toBe(true);
		expect(card).toMatchObject({ lane: "doing", owner: { id: CORE.id, label: CORE.label }, rev: 2, by: CORE.label });
		expect(card.updatedAt).toBe(NOW);
	});

	test("records a label alone when the session has no id yet", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card } = accepted(applyOp(created, { kind: "claim" }, { label: "ad-hoc" }, NOW, indexOf([created])));
		expect(card.owner).toEqual({ label: "ad-hoc" });
	});

	test("already holding it is a no-op, not a second revision", () => {
		const card = claimed();
		const { card: same, changed } = accepted(applyOp(card, { kind: "claim" }, CORE, NOW, indexOf([card])));
		expect(changed).toBe(false);
		expect(same.rev).toBe(card.rev);
	});

	test("refuses a card another session holds, naming it", () => {
		expect(refusal(applyOp(claimed(), { kind: "claim" }, OTHER, NOW, indexOf([claimed()])))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a finished card", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "claim" }, LEAD, NOW, indexOf([done])))).toBe(
			"#4 is done; it cannot be claimed.",
		);
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
		const { card } = accepted(applyOp(created, { kind: "assign", to: CORE }, LEAD, NOW, indexOf([created])));
		expect(card).toMatchObject({ lane: "doing", owner: { id: CORE.id, label: CORE.label }, by: LEAD.label });
	});

	test("refuses a card a third session holds", () => {
		expect(refusal(applyOp(claimed(CORE), { kind: "assign", to: OTHER }, LEAD, NOW, indexOf([claimed(CORE)])))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a finished card", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "assign", to: OTHER }, LEAD, NOW, indexOf([done])))).toBe(
			"#4 is done; it cannot be assigned.",
		);
	});

	test("records the note it was handed in the same revision as the owner", () => {
		// The page cannot message a peer, so its assignment says so on the card: one write,
		// and a reader never sees the owner without the sentence explaining it.
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card } = accepted(
			applyOp(
				created,
				{ kind: "assign", to: CORE, note: "assigned from the board page; no handoff was sent" },
				LEAD,
				NOW,
				indexOf([created]),
			),
		);
		expect(card.rev).toBe(2);
		expect(card.owner).toEqual({ id: CORE.id, label: CORE.label });
		expect(card.notes.map((note) => note.text)).toEqual(["assigned from the board page; no handoff was sent"]);
		// Whoever wrote it is the lead, so the history says who recorded the hand-out.
		expect(card.notes[0]?.by).toBe(LEAD.label);
	});

	test("refuses a note it cannot keep, leaving the card unassigned", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "assign", to: CORE, note: "  " }, LEAD, NOW, indexOf([created])))).toBe(
			"text is required.",
		);
	});

	test("re-assigning to the holder is a no-op", () => {
		const card = claimed();
		const { changed } = accepted(applyOp(card, { kind: "assign", to: CORE }, LEAD, NOW, indexOf([card])));
		expect(changed).toBe(false);
	});
});

describe("release", () => {
	test("clears the owner and returns the card to todo, with no owner key left behind", () => {
		const { card } = accepted(applyOp(claimed(), { kind: "release" }, CORE, NOW, indexOf([claimed()])));
		expect(card.lane).toBe("todo");
		expect("owner" in card).toBe(false);
		expect(card.notes).toEqual([]);
	});

	test("refuses a session that does not hold it", () => {
		expect(refusal(applyOp(claimed(), { kind: "release" }, OTHER, NOW, indexOf([claimed()])))).toBe(
			"#4 is held by billing-core. Release is the owner's decision.",
		);
	});

	test("refuses an unclaimed card", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "release" }, LEAD, NOW, indexOf([created])))).toBe("#4 is not claimed.");
	});

	test("refuses a finished card, so done cannot be undone", () => {
		// The one transition that could have reopened history: a released done card would put
		// a dependency back in To do under a card that already finished against it.
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "release" }, CORE, NOW, indexOf([done])))).toBe(
			"#4 is done; it cannot be released.",
		);
	});
});

describe("move", () => {
	test("an owner parks a card and picks it up again", () => {
		const blocked = accepted(
			applyOp(claimed(), { kind: "move", lane: "blocked" }, CORE, NOW, indexOf([claimed()])),
		).card;
		expect(blocked.lane).toBe("blocked");
		expect(accepted(applyOp(blocked, { kind: "move", lane: "doing" }, CORE, NOW, indexOf([blocked]))).card.lane).toBe(
			"doing",
		);
	});

	test("blocked may finish without going back through doing", () => {
		const blocked = accepted(
			applyOp(claimed(), { kind: "move", lane: "blocked" }, CORE, NOW, indexOf([claimed()])),
		).card;
		expect(accepted(applyOp(blocked, { kind: "move", lane: "done" }, CORE, NOW, indexOf([blocked]))).card.lane).toBe(
			"done",
		);
	});

	test("moving to the lane it is already in writes nothing", () => {
		const card = claimed();
		const { changed } = accepted(applyOp(card, { kind: "move", lane: "doing" }, CORE, NOW, indexOf([card])));
		expect(changed).toBe(false);
	});

	test("refuses a card someone else holds", () => {
		expect(refusal(applyOp(claimed(), { kind: "move", lane: "done" }, OTHER, NOW, indexOf([claimed()])))).toBe(
			"#4 is held by billing-core. Only its owner can move it.",
		);
	});

	test("refuses an unclaimed card, naming claim", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "move", lane: "doing" }, LEAD, NOW, indexOf([created])))).toBe(
			"#4 is unclaimed; claim it before moving it to doing.",
		);
	});

	test("a block records what it waits on, and a leave clears it", () => {
		const card = claimed();
		const blocked = accepted(
			applyOp(
				card,
				{ kind: "move", lane: "blocked", blockedBy: "waiting on the marketing copy" },
				CORE,
				NOW,
				indexOf([card]),
			),
		).card;
		expect(blocked.blockedBy).toBe("waiting on the marketing copy");
		// The decision is what `blocked` is for, so the sentence belongs to the lane: a card
		// that goes back to work no longer says it is waiting on anything.
		expect(
			accepted(applyOp(blocked, { kind: "move", lane: "doing" }, CORE, NOW, indexOf([blocked]))).card.blockedBy,
		).toBeUndefined();
	});

	test("a card may be blocked with nothing recorded, and a repeated block may change the sentence", () => {
		const card = claimed();
		const unrecorded = accepted(applyOp(card, { kind: "move", lane: "blocked" }, CORE, NOW, indexOf([card])));
		expect(unrecorded.card.blockedBy).toBeUndefined();
		expect(unrecorded.changed).toBe(true);

		const recorded = accepted(
			applyOp(
				unrecorded.card,
				{ kind: "move", lane: "blocked", blockedBy: "legal has to sign" },
				CORE,
				NOW,
				indexOf([unrecorded.card]),
			),
		);
		expect(recorded.card.blockedBy).toBe("legal has to sign");
		expect(recorded.changed).toBe(true);
	});

	test("a release keeps the block, because the decision is still pending", () => {
		const card = claimed();
		const blocked = accepted(
			applyOp(card, { kind: "move", lane: "blocked", blockedBy: "legal has to sign" }, CORE, NOW, indexOf([card])),
		).card;
		const released = accepted(applyOp(blocked, { kind: "release" }, CORE, NOW, indexOf([blocked]))).card;
		expect(released.lane).toBe("todo");
		expect(released.blockedBy).toBe("legal has to sign");
	});

	test("a move to done records the commit that closed the card", () => {
		const card = claimed();
		const done = accepted(
			applyOp(card, { kind: "move", lane: "done", landed: { commit: "4af1b4a" } }, CORE, NOW, indexOf([card])),
		).card;
		expect(done.landed).toEqual({ commit: "4af1b4a", at: NOW });
		expect(done.blockedBy).toBeUndefined();
	});

	test("a move to done without a commit still finishes the card", () => {
		const card = claimed();
		const done = accepted(applyOp(card, { kind: "move", lane: "done" }, CORE, NOW, indexOf([card]))).card;
		expect(done.landed).toBeUndefined();
		expect(done.lane).toBe("done");
	});

	test("refuses a block whose sentence is empty or too long", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "move", lane: "blocked", blockedBy: "  " }, CORE, NOW, indexOf([card])))).toBe(
			"blockedBy must say what the card waits on.",
		);
		expect(
			refusal(applyOp(card, { kind: "move", lane: "blocked", blockedBy: "x".repeat(201) }, CORE, NOW, indexOf([card]))),
		).toBe("blockedBy must be at most 200 characters.");
	});

	test("refuses to move a finished card anywhere", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "move", lane: "blocked" }, CORE, NOW, indexOf([done])))).toBe(
			"#4 is done; it cannot be moved.",
		);
	});
});

describe("note", () => {
	test("anyone may note a card, and the writer is recorded", () => {
		const { card } = accepted(
			applyOp(claimed(), { kind: "note", text: "routes wired" }, LEAD, NOW, indexOf([claimed()])),
		);
		expect(card.notes.at(-1)).toEqual({ by: LEAD.label, at: NOW, text: "routes wired" });
		expect(card.rev).toBe(claimed().rev + 1);
	});

	test("keeps the last MAX_NOTES and counts what dropped", () => {
		let card = claimed();
		for (let index = 0; index < MAX_NOTES + 2; index++) {
			card = accepted(applyOp(card, { kind: "note", text: `note ${index}` }, CORE, NOW, indexOf([card]))).card;
		}
		expect(card.notes).toHaveLength(MAX_NOTES);
		expect(card.notesDropped).toBe(2);
		expect(card.notes.at(-1)?.text).toBe(`note ${MAX_NOTES + 1}`);
	});

	test("refuses empty text", () => {
		expect(refusal(applyOp(claimed(), { kind: "note", text: "  " }, CORE, NOW, indexOf([claimed()])))).toBe(
			"text is required.",
		);
	});
});

describe("plan", () => {
	test("the owner records the plan it is executing", () => {
		const { card } = accepted(
			applyOp(claimed(), { kind: "plan", path: "~/.pi/agent/plans/k/billing.md" }, CORE, NOW, indexOf([claimed()])),
		);
		expect(card.plan).toBe("~/.pi/agent/plans/k/billing.md");
	});

	test("recording the same plan again writes nothing", () => {
		const card = accepted(applyOp(claimed(), { kind: "plan", path: "p.md" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(accepted(applyOp(card, { kind: "plan", path: "p.md" }, CORE, NOW, indexOf([card]))).changed).toBe(false);
	});

	test("only the owner records one", () => {
		expect(refusal(applyOp(claimed(), { kind: "plan", path: "p.md" }, OTHER, NOW, indexOf([claimed()])))).toBe(
			"#4 is held by billing-core. Only its owner records a plan.",
		);
	});

	test("a finished card keeps the plan it finished with", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "plan", path: "p.md" }, CORE, NOW, indexOf([done])))).toBe(
			"#4 is done; its plan cannot change.",
		);
	});
});

describe("offer", () => {
	/** A `todo` card nobody holds, which is what an offer is for. */
	const free = (overrides: Partial<Card> = {}): Card => ({
		...createCard("2", { title: "Retry branches", paths: [] }, LEAD, 1_000),
		...overrides,
	});

	test("records when the offer was made, and changes nothing else", () => {
		const board = indexOf([free()]);
		const before = free();
		const { card, changed } = accepted(applyOp(before, { kind: "offer" }, LEAD, NOW, board));
		expect(card.offeredAt).toBe(NOW);
		expect(card.lane).toBe("todo");
		expect("owner" in card).toBe(false);
		expect(card.rev).toBe(before.rev + 1);
		expect(changed).toBe(true);
	});

	test("re-offering refreshes the age instead of refusing as a no-op", () => {
		const board = indexOf([free()]);
		const first = accepted(applyOp(free(), { kind: "offer" }, LEAD, NOW, board));
		const again = accepted(applyOp(first.card, { kind: "offer" }, LEAD, NOW + 60_000, board));
		// A lead who offers again is asking again, and the age is when they last asked.
		expect(again.card.offeredAt).toBe(NOW + 60_000);
		expect(again.changed).toBe(true);
	});

	test("refuses a held card, a finished one, and one that waits", () => {
		const held = indexOf([claimed()]);
		expect(refusal(applyOp(claimed(), { kind: "offer" }, LEAD, NOW, held))).toBe("#4 is held by billing-core.");
		const done = { ...claimed(), lane: "done" as const };
		expect(refusal(applyOp(done, { kind: "offer" }, LEAD, NOW, indexOf([done])))).toContain("is done");
		// A card that waits is refused before anything is broadcast, so no peer is asked to
		// claim a card the claim would refuse.
		const waiting = free({ dependsOn: ["1"] });
		const board = indexOf([free({ id: "1" }), waiting]);
		expect(refusal(applyOp(waiting, { kind: "offer" }, LEAD, NOW, board))).toBe("#2 waits on #1 (todo).");
	});

	test("every answer clears it, so an open record means an unanswered offer", () => {
		const offered = free({ offeredAt: NOW });
		const board = indexOf([free({ id: "1" }), offered]);
		const after = (op: Parameters<typeof applyOp>[1], actor: Actor = LEAD, at = NOW + 1): Card =>
			accepted(applyOp(offered, op, actor, at, board)).card;
		// A claim, an assignment, and a move each answer the offer: the record goes, and
		// `write` deletes the key rather than leaving one holding undefined.
		// A move cannot be one of them: it needs an owner, and an offered card has none — every
		// way into another lane goes through a claim or an assignment first, and both clear it.
		for (const answered of [after({ kind: "claim" }), after({ kind: "assign", to: { label: "billing-core" } })]) {
			expect(answered.offeredAt).toBeUndefined();
			expect("offeredAt" in answered).toBe(false);
		}
		// A release is the fourth: the card goes back to To do, and the offer that was
		// answered by the claim is not re-opened by giving the card back.
		const reoffered = { ...after({ kind: "claim" }), offeredAt: NOW };
		const released = accepted(applyOp(reoffered, { kind: "release" }, LEAD, NOW + 2, board)).card;
		expect("offeredAt" in released).toBe(false);
	});

	test("a note, a plan, or an edit leaves it standing", () => {
		const offered = free({ offeredAt: NOW });
		const after = (op: Parameters<typeof applyOp>[1]): Card =>
			accepted(applyOp(offered, op, LEAD, NOW + 1, indexOf([offered]))).card;
		// None of these answers the offer: the card was offered, and it still is.
		// A plan is not among them either: recording one needs the card, and an offer is made
		// before anybody holds it.
		expect(after({ kind: "note", text: "waiting on the gateway owner" }).offeredAt).toBe(NOW);
		expect(
			after({
				kind: "edit",
				title: "Retry branches, restated",
				paths: undefined,
				priority: undefined,
				dependsOn: undefined,
			}).offeredAt,
		).toBe(NOW);
	});
});

describe("reclaim", () => {
	test("clears the owner, keeps the notes, and records the reclaimer", () => {
		const noted = accepted(
			applyOp(claimed(), { kind: "note", text: "half done" }, CORE, NOW, indexOf([claimed()])),
		).card;
		const { card } = accepted(applyOp(noted, { kind: "reclaim" }, LEAD, NOW, indexOf([noted])));
		expect(card.lane).toBe("todo");
		expect("owner" in card).toBe(false);
		expect(card.notes.map((entry) => entry.text)).toEqual(["half done"]);
		expect(card.by).toBe(LEAD.label);
	});

	test("refuses an unclaimed or finished card", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "reclaim" }, LEAD, NOW, indexOf([created])))).toBe(
			"#4 has no owner to reclaim.",
		);
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(done, { kind: "reclaim" }, LEAD, NOW, indexOf([done])))).toBe(
			"#4 is done; there is nothing to reclaim.",
		);
	});
});

describe("drop", () => {
	test("an abandoned todo card is anyone's to drop", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(accepted(applyOp(created, { kind: "drop" }, OTHER, NOW, indexOf([created]))).changed).toBe(true);
	});

	test("finished history is anyone's to drop", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(accepted(applyOp(done, { kind: "drop" }, OTHER, NOW, indexOf([done]))).changed).toBe(true);
	});

	test("its owner drops a live card", () => {
		expect(accepted(applyOp(claimed(), { kind: "drop" }, CORE, NOW, indexOf([claimed()]))).changed).toBe(true);
	});

	test("a live card held by someone else is refused", () => {
		expect(refusal(applyOp(claimed(), { kind: "drop" }, OTHER, NOW, indexOf([claimed()])))).toBe(
			"#4 is held by billing-core. It cannot be dropped while someone holds it.",
		);
	});
});

describe("archive", () => {
	/** A card that finished, which is the only kind that may be set aside. */
	function finished(): Card {
		return accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
	}

	test("a finished card is anyone's to set aside, and its record does not move", () => {
		const done = finished();
		const { card, changed } = accepted(applyOp(done, { kind: "archive" }, OTHER, NOW + 1, indexOf([done])));
		expect(changed).toBe(true);
		// The pile is the whole of the state: no field, no revision, and no lane change,
		// because an archived card is still done and its history still says so.
		expect(card).toEqual(done);
		expect(card.log).toEqual(done.log);
	});

	test("a card still in flight is refused, naming the lane it is in", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(created, { kind: "archive" }, LEAD, NOW, indexOf([created])))).toBe(
			"#4 is in todo; only a finished card can be archived.",
		);
		expect(refusal(applyOp(claimed(), { kind: "archive" }, CORE, NOW, indexOf([claimed()])))).toBe(
			"#4 is in doing; only a finished card can be archived.",
		);
	});

	test("leaving the board writes nothing, so the invariants are untouched", () => {
		const done = finished();
		const { card } = accepted(applyOp(done, { kind: "archive" }, LEAD, NOW, indexOf([done])));
		expect(card.rev).toBe(done.rev);
		expect(card.updatedAt).toBe(done.updatedAt);
		expect(card.lane === "todo").toBe(card.owner === undefined);
	});
});

describe("the transition log", () => {
	test("a new card is born in todo, and says so", () => {
		const card = createCard("4", { title: "T", paths: ["src"] }, LEAD, NOW);
		expect(card.log).toEqual([{ lane: "todo", at: NOW, by: LEAD.label }]);
		expect(card.logDropped).toBe(0);
	});

	test("a lane change appends, credited to the session that moved it", () => {
		const created = createCard("4", { title: "T", paths: ["src"] }, LEAD, 1_000);
		const claimedCard = accepted(applyOp(created, { kind: "claim" }, CORE, NOW, indexOf([created]))).card;
		expect(claimedCard.log?.map((entry) => entry.lane)).toEqual(["todo", "doing"]);
		expect(claimedCard.log?.at(-1)).toEqual({ lane: "doing", at: NOW, by: CORE.label });
	});

	test("a write that leaves the lane alone is not a transition", () => {
		const base = claimed();
		const noted = accepted(applyOp(base, { kind: "note", text: "phase one" }, CORE, NOW, indexOf([base]))).card;
		expect(noted.log).toEqual(base.log);
		// A claim by the holder is a no-op: nothing is written, so nothing is logged.
		const again = accepted(applyOp(base, { kind: "claim" }, CORE, NOW, indexOf([base])));
		expect(again.changed).toBe(false);
		expect(again.card.log).toEqual(base.log);
	});

	test("the oldest transition drops past the cap and is counted", () => {
		let card = createCard("4", { title: "T", paths: ["src"] }, LEAD, 0);
		card = accepted(applyOp(card, { kind: "claim" }, CORE, 1, indexOf([card]))).card;
		const lanes: Array<Exclude<Lane, "todo">> = [
			"blocked",
			"doing",
			"blocked",
			"doing",
			"blocked",
			"doing",
			"blocked",
			"doing",
		];
		for (const [index, lane] of lanes.entries()) {
			card = accepted(applyOp(card, { kind: "move", lane }, CORE, 10 + index, indexOf([card]))).card;
		}
		expect(card.log).toHaveLength(MAX_LOG);
		expect(card.logDropped).toBe(2);
		expect(card.log?.at(-1)).toEqual({ lane: "doing", at: 17, by: CORE.label });
	});
});

describe("edit", () => {
	test("its holder fixes the title, and the write is recorded as theirs", () => {
		const { card, changed } = accepted(
			applyOp(
				claimed(),
				{
					kind: "edit",
					title: "Billing webhook takes orders",
					paths: undefined,
					priority: undefined,
					dependsOn: undefined,
				},
				CORE,
				NOW,
				indexOf([claimed()]),
			),
		);
		expect(changed).toBe(true);
		expect(card.title).toBe("Billing webhook takes orders");
		expect(card.by).toBe(CORE.label);
	});

	test("anyone fixes an unclaimed card, which is the one with no holder to ask", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const { card } = accepted(
			applyOp(
				created,
				{ kind: "edit", title: "Billing webhook", paths: ["src/billing"], priority: "high", dependsOn: undefined },
				OTHER,
				NOW,
				indexOf([created]),
			),
		);
		expect(card).toMatchObject({ title: "Billing webhook", paths: ["src/billing"], priority: "high" });
	});

	test("refuses a card another session holds, naming it", () => {
		expect(
			refusal(
				applyOp(
					claimed(),
					{ kind: "edit", title: "T", paths: undefined, priority: undefined, dependsOn: undefined },
					OTHER,
					NOW,
					indexOf([claimed()]),
				),
			),
		).toBe("#4 is held by billing-core. Only its owner can edit it.");
	});

	test("a finished card keeps a readable title, because its owner may still correct it", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		const { card } = accepted(
			applyOp(
				done,
				{
					kind: "edit",
					title: "Billing webhook (renamed)",
					paths: undefined,
					priority: undefined,
					dependsOn: undefined,
				},
				CORE,
				NOW,
				indexOf([done]),
			),
		);
		expect(card.title).toBe("Billing webhook (renamed)");
	});

	test("a field that already holds the value asked for writes nothing", () => {
		const card = claimed();
		const { changed } = accepted(
			applyOp(
				card,
				{ kind: "edit", title: card.title, paths: card.paths, priority: "normal", dependsOn: [] },
				CORE,
				NOW,
				indexOf([card]),
			),
		);
		expect(changed).toBe(false);
	});

	test("a refused link leaves the card as it was", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		expect(
			refusal(
				applyOp(
					created,
					{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ["7"] },
					LEAD,
					NOW,
					indexOf([created]),
				),
			),
		).toBe("#7 does not exist.");
	});
});

describe("links between cards", () => {
	/** A board where `#4` waits on `#2`, which `billing-core` holds. */
	function waiting(): { card: Card; board: ReturnType<typeof indexOf> } {
		const first = createCard("2", { title: "Retry branches merge cleanly", paths: [] }, LEAD, 1_000);
		const claimedFirst = accepted(applyOp(first, { kind: "claim" }, CORE, 1_000, indexOf([first]))).card;
		const second = createCard("4", { title: "Billing webhook accepts orders", paths: [] }, LEAD, 1_000);
		const linked = accepted(
			applyOp(
				second,
				{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ["2"] },
				LEAD,
				NOW,
				indexOf([first, second]),
			),
		).card;
		return { card: linked, board: indexOf([claimedFirst, linked]) };
	}

	test("a claim is refused while a dependency is unfinished, in the words the caller shows", () => {
		const { card, board } = waiting();
		expect(refusal(applyOp(card, { kind: "claim" }, LEAD, NOW, board))).toBe("#4 waits on #2 (doing).");
	});

	test("an assignment is refused by the same rule", () => {
		const { card, board } = waiting();
		expect(refusal(applyOp(card, { kind: "assign", to: CORE }, LEAD, NOW, board))).toBe("#4 waits on #2 (doing).");
	});

	test("it may be blocked, and may not be taken or finished, once somebody holds it", () => {
		const { card, board } = waiting();
		const started = accepted(applyOp(card, { kind: "claim" }, CORE, NOW, indexOf([card]))).card;
		const withBoard = indexOf([board.get("2") as Card, started]);
		const blocked = accepted(applyOp(started, { kind: "move", lane: "blocked" }, CORE, NOW, withBoard)).card;
		expect(blocked.lane).toBe("blocked");
		expect(refusal(applyOp(blocked, { kind: "move", lane: "doing" }, CORE, NOW, withBoard))).toBe(
			"#4 waits on #2 (doing).",
		);
		expect(refusal(applyOp(blocked, { kind: "move", lane: "done" }, CORE, NOW, withBoard))).toBe(
			"#4 waits on #2 (doing).",
		);
	});

	test("a finished dependency stops counting, so the claim goes through", () => {
		const first = createCard("2", { title: "Retry branches merge cleanly", paths: [] }, LEAD, 1_000);
		const done = accepted(
			applyOp(
				accepted(applyOp(first, { kind: "claim" }, CORE, 1_000, indexOf([first]))).card,
				{ kind: "move", lane: "done" },
				CORE,
				NOW,
				indexOf([first]),
			),
		).card;
		const second = createCard("4", { title: "Billing webhook", paths: [] }, LEAD, 1_000);
		const linked = accepted(
			applyOp(
				second,
				{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ["2"] },
				LEAD,
				NOW,
				indexOf([done, second]),
			),
		).card;
		const board = indexOf([done, linked]);
		expect(accepted(applyOp(linked, { kind: "claim" }, LEAD, NOW, board)).card.lane).toBe("doing");
	});

	test("a drop is refused while another card waits on it", () => {
		const { board } = waiting();
		const first = board.get("2") as Card;
		const released = accepted(applyOp(first, { kind: "reclaim" }, LEAD, NOW, board)).card;
		expect(refusal(applyOp(released, { kind: "drop" }, LEAD, NOW, indexOf([released, board.get("4") as Card])))).toBe(
			"#2 is waited on by #4; drop that card first.",
		);
	});
});

describe("re-applying an operation to a card that changed underneath", () => {
	// The store re-reads on a lost compare-and-set and applies the operation once
	// more. That second application must re-check the operation's own
	// preconditions: an operation says "apply when this holds", never "force this".
	test("a move the owner was going to make is refused once the card was released", () => {
		const released = accepted(applyOp(claimed(), { kind: "release" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(refusal(applyOp(released, { kind: "move", lane: "done" }, CORE, NOW, indexOf([released])))).toBe(
			"#4 is unclaimed; claim it before moving it to done.",
		);
	});

	test("a claim loses to the session that got there first, and names it", () => {
		const takenByOther = claimed(OTHER);
		expect(refusal(applyOp(takenByOther, { kind: "claim" }, CORE, NOW, indexOf([takenByOther])))).toBe(
			"#4 is held by billing-other.",
		);
	});

	test("a note still applies, because noting has no precondition to lose", () => {
		const done = accepted(applyOp(claimed(), { kind: "move", lane: "done" }, CORE, NOW, indexOf([claimed()]))).card;
		expect(
			accepted(applyOp(done, { kind: "note", text: "shipped" }, LEAD, NOW, indexOf([done]))).card.notes,
		).toHaveLength(1);
	});
});

describe("the invariants hold after every accepted operation", () => {
	const ops = [
		(card: Card) => applyOp(card, { kind: "note", text: "n" }, LEAD, NOW, indexOf([card])),
		(card: Card) => applyOp(card, { kind: "move", lane: "blocked" }, CORE, NOW, indexOf([card])),
		(card: Card) => applyOp(card, { kind: "plan", path: "p.md" }, CORE, NOW, indexOf([card])),
		(card: Card) => applyOp(card, { kind: "release" }, CORE, NOW, indexOf([card])),
		(card: Card) => applyOp(card, { kind: "reclaim" }, LEAD, NOW, indexOf([card])),
		(card: Card) => applyOp(card, { kind: "claim" }, CORE, NOW, indexOf([card])),
		(card: Card) =>
			applyOp(
				card,
				{ kind: "edit", title: "renamed", paths: ["src/other"], priority: "high", dependsOn: undefined },
				CORE,
				NOW,
				indexOf([card]),
			),
	];

	test("todo means no owner, and the other three always have one", () => {
		for (const op of ops) {
			const result = op(claimed());
			if (!result.ok) continue;
			const card = result.card;
			expect(card.lane === "todo").toBe(card.owner === undefined);
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
