/**
 * The card lifecycle: who may do what, what a refusal says, and the gates that turn a
 * feature into a pull system.
 *
 * One table is the contract for the tool, the router, and the page, so these cases are the
 * whole authorisation story for a card: the lane matrix in `lanes.ts`, the two human gates
 * (an approved contract before `execute`, a spot-check before `done`), and the WIP limits
 * read from config. Every refusal is checked for its sentence as well as its state, because
 * the sentence is what a model retries against.
 */

import { describe, expect, test } from "bun:test";
import { type Card, CARD_VERSION, MAX_LOG, MAX_NOTES } from "./card.ts";
import type { Contract } from "./contract.ts";
import { DEFAULT_WIP, type WipLimits } from "./limits.ts";
import { indexOf } from "./links.ts";
import { type Actor, applyOp, createCard, mayOp, type OpResult } from "./rules.ts";
import { holds } from "./card.ts";

const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };
const NOW = 2_000;

/** A board of these cards, which is the index every operation is checked against. */
function board(...cards: Card[]): ReturnType<typeof indexOf> {
	return indexOf(cards);
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

/** One step of a card's life, applied against a board holding just that card. */
function step(card: Card, op: Parameters<typeof applyOp>[1], actor: Actor, limits: WipLimits = DEFAULT_WIP): Card {
	return accepted(applyOp(card, op, actor, NOW, board(card), limits)).card;
}

function created(): Card {
	return createCard("4", { title: "Billing webhook accepts orders", paths: ["src/billing"] }, LEAD, 1_000);
}

/** A card somebody has pulled into `plan`. */
function claimed(owner: Actor = CORE): Card {
	return step(created(), { kind: "claim" }, owner);
}

const CONTRACT = {
	goal: "A webhook order is stored once",
	acceptance: "A retried delivery leaves one order",
	scopeOut: "No refunds",
};

/**
 * The plan artifact a caller hands in once it has proved the file.
 *
 * The board's state machine decides; the tool is what touches the plan store, so a pure
 * test passes the fact the way the tool would and the path is only a string here.
 */
function proved(path = "plans/webhook.md") {
	return { path };
}

/** The proof a move carries: bound to the record it was computed for. */
function provedFor(card: Card) {
	const recorded = card.planPath ?? "plans/webhook.md";
	return { path: recorded, recorded };
}

/** A card whose contract is written, still in `plan`. */
function written(owner: Actor = CORE, contract: Partial<Contract> = {}): Card {
	return step(claimed(owner), { kind: "contract", artifact: proved(), ...CONTRACT, ...contract }, owner);
}

/** A card whose contract somebody who does not hold it has approved, still in `plan`. */
function approved(owner: Actor = CORE, approver: Actor = LEAD): Card {
	return step(written(owner), { kind: "approve" }, approver);
}

/** A card executing: past the contract gate. */
function executing(card: Card = approved()): Card {
	return step(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE);
}

/** A card whose work somebody else has spot-checked, still in `execute`. */
function reviewed(owner: Actor = CORE, reviewer: Actor = LEAD): Card {
	return step(executing(approved(owner)), { kind: "review" }, reviewer);
}

/** A card in `plan` on one of `ids`, for the cases that need several at once. */
function pulled(id: string, owner: Actor): Card {
	return step(createCard(id, { title: `T${id}`, paths: [] }, LEAD, 1_000), { kind: "claim" }, owner);
}

/** A card in `plan` with its contract written and approved, ready for `execute`. */
function ready(id: string, owner: Actor): Card {
	const card = step(pulled(id, owner), { kind: "contract", artifact: proved(`plans/${id}.md`), ...CONTRACT }, owner);
	return step(card, { kind: "approve" }, LEAD);
}

describe("createCard", () => {
	test("is born in the backlog, unowned, at revision 1", () => {
		const card = created();
		expect(card).toMatchObject({ v: CARD_VERSION, id: "4", lane: "backlog", rev: 1, by: LEAD.label });
		expect("owner" in card).toBe(false);
		expect(card.createdAt).toBe(1_000);
		expect(card.log).toEqual([{ lane: "backlog", at: 1_000, by: LEAD.label }]);
	});

	test("takes the first note, attributed and stamped", () => {
		const card = createCard("4", { title: "T", paths: [], note: "from the page" }, LEAD, NOW);
		expect(card.notes).toEqual([{ by: LEAD.label, at: NOW, text: "from the page" }]);
	});
});

describe("claim", () => {
	test("pulls a backlog card into plan, owned by the claimer", () => {
		const card = claimed();
		expect(card).toMatchObject({ lane: "plan", owner: { id: CORE.id, label: CORE.label }, rev: 2, by: CORE.label });
		expect(card.updatedAt).toBe(NOW);
		expect(card.log?.at(-1)).toEqual({ lane: "plan", at: NOW, by: CORE.label });
	});

	test("records a label alone when the session has no id yet", () => {
		const card = step(created(), { kind: "claim" }, { label: "ad-hoc" });
		expect(card.owner).toEqual({ label: "ad-hoc" });
	});

	test("already holding it is a no-op, not a second revision", () => {
		const card = claimed();
		const result = accepted(applyOp(card, { kind: "claim" }, CORE, NOW, board(card)));
		expect(result.changed).toBe(false);
		expect(result.card.rev).toBe(card.rev);
	});

	test("refuses a card another session holds, naming it", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "claim" }, OTHER, NOW, board(card)))).toBe("#4 is held by billing-core.");
	});

	test("refuses a finished card", () => {
		const done = step(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "claim" }, LEAD, NOW, board(done)))).toBe("#4 is done; it cannot be claimed.");
	});

	test("refuses the pull when plan is full, and says how to make room", () => {
		const limits: WipLimits = { plan: 3, execute: 5 };
		const full = [pulled("1", CORE), pulled("2", OTHER), pulled("3", LEAD)];
		const pool = createCard("7", { title: "D", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(pool, { kind: "claim" }, CORE, NOW, board(...full, pool), limits))).toBe(
			"#7 cannot enter plan: 3 cards are already being planned (the limit is 3); finish, block, or release one first.",
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
	test("hands a backlog card to the target, and records the lead as the writer", () => {
		const created = createCard("4", { title: "T", paths: [] }, LEAD, 1_000);
		const card = accepted(applyOp(created, { kind: "assign", to: CORE }, LEAD, NOW, board(created))).card;
		expect(card).toMatchObject({ lane: "plan", owner: { id: CORE.id, label: CORE.label }, by: LEAD.label });
	});

	test("assignment is not a lane change: a card in plan stays there", () => {
		// Naming the session that already holds a card is the one held case assign accepts, and
		// it is a no-op: the lane it earned is unchanged and no revision is spent.
		const card = approved();
		const result = accepted(applyOp(card, { kind: "assign", to: CORE }, LEAD, NOW, board(card)));
		expect(result.changed).toBe(false);
		expect(result.card.lane).toBe("plan");
	});

	test("handing a card to a different session is refused; reclaim is how it changes hands", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "assign", to: OTHER }, LEAD, NOW, board(card)))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a card a third session holds", () => {
		const card = claimed(CORE);
		expect(refusal(applyOp(card, { kind: "assign", to: OTHER }, LEAD, NOW, board(card)))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a finished card", () => {
		const done = step(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "assign", to: OTHER }, LEAD, NOW, board(done)))).toBe(
			"#4 is done; it cannot be assigned.",
		);
	});

	test("refuses the pull into a full plan lane", () => {
		const full = [pulled("1", CORE), pulled("2", OTHER), pulled("3", LEAD)];
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(pool, { kind: "assign", to: CORE }, LEAD, NOW, board(...full, pool)))).toContain(
			"cannot enter plan",
		);
	});
});

describe("release and reclaim", () => {
	test("release returns a card to the backlog with no owner", () => {
		const card = claimed();
		const back = step(card, { kind: "release" }, CORE);
		expect(back.lane).toBe("backlog");
		expect("owner" in back).toBe(false);
	});

	test("release keeps the contract and its approval: the plan did not change", () => {
		const card = approved();
		const back = step(card, { kind: "release" }, CORE);
		expect(back.contract).toMatchObject({ ...CONTRACT, approved: { by: LEAD.label, at: NOW } });
	});

	test("release from execute clears the spot-check, which was about finished work", () => {
		const card = reviewed();
		const back = step(card, { kind: "release" }, CORE);
		expect("review" in back).toBe(false);
	});

	test("release refuses a card nobody holds, and a finished one", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "release" }, CORE, NOW, board(pool)))).toBe("#4 is not claimed.");
		const done = step(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "release" }, CORE, NOW, board(done)))).toBe(
			"#4 is done; it cannot be released.",
		);
	});

	test("reclaim takes the card back from whoever holds it, and keeps its notes", () => {
		const card = step(claimed(), { kind: "note", text: "halfway" }, CORE);
		const back = step(card, { kind: "reclaim" }, LEAD);
		expect(back).toMatchObject({ lane: "backlog", by: LEAD.label });
		expect("owner" in back).toBe(false);
		expect(back.notes.at(-1)?.text).toBe("halfway");
	});

	test("reclaim refuses a card nobody holds", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "reclaim" }, LEAD, NOW, board(pool)))).toBe("#4 has no owner to reclaim.");
	});
});

describe("the contract", () => {
	test("records the plan file and the three lines in one write", () => {
		const card = written();
		expect(card.planPath).toBe("plans/webhook.md");
		expect(card.contract).toEqual(CONTRACT);
		expect(card.lane).toBe("plan");
	});

	test("a different plan drops the approval too, because the sign named an artifact", () => {
		// Otherwise a peer could read one plan and the card be executed against another: the
		// three lines are the same, and the file they are read against is not.
		const card = approved();
		const repointed = step(card, { kind: "contract", artifact: proved("plans/other.md"), ...CONTRACT }, CORE);
		expect(repointed.planPath).toBe("plans/other.md");
		expect(repointed.contract?.approved).toBeUndefined();
		expect(repointed.contract?.goal).toBe(CONTRACT.goal);
	});

	test("re-recording the same plan and lines keeps the sign, and is a no-op", () => {
		const card = approved();
		const same = accepted(applyOp(card, { kind: "contract", artifact: proved(), ...CONTRACT }, CORE, NOW, board(card)));
		expect(same.changed).toBe(false);
		expect(same.card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
	});

	test("a changed line drops the approval, because the sign named a wording", () => {
		const card = approved();
		const reworded = step(
			card,
			{ kind: "contract", artifact: proved(), scopeOut: "No refunds, no partial captures" },
			CORE,
		);
		expect(reworded.contract?.scopeOut).toBe("No refunds, no partial captures");
		expect(reworded.contract?.approved).toBeUndefined();
	});

	test("re-writing the same lines is a no-op", () => {
		const card = written();
		const same = accepted(applyOp(card, { kind: "contract", artifact: proved(), ...CONTRACT }, CORE, NOW, board(card)));
		expect(same.changed).toBe(false);
	});

	test("refuses a contract with no plan, naming where the path comes from", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "contract", ...CONTRACT }, CORE, NOW, board(card)))).toBe(
			"contract needs the plan file #4 is executed against: pass `path` as write_plan returned it.",
		);
	});

	test("refuses a lane other than plan, and a session that does not hold it", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "contract", artifact: proved(), ...CONTRACT }, LEAD, NOW, board(pool)))).toBe(
			"#4 is in backlog; its contract is written in plan.",
		);
		const card = claimed();
		expect(
			refusal(applyOp(card, { kind: "contract", ...CONTRACT, artifact: proved("p.md") }, OTHER, NOW, board(card))),
		).toBe("#4 is held by billing-core. Only its owner records a plan.");
	});

	test("holds each line to one line and its cap", () => {
		const card = claimed();
		// A line is flattened at the boundary: a goal that arrives with a newline is stored as
		// the one line a row and a dialog rung can hold.
		const multi = accepted(
			applyOp(card, { kind: "contract", artifact: proved(), goal: "two\nlines" }, CORE, NOW, board(card)),
		).card;
		expect(multi.contract?.goal).toBe("two lines");
		expect(
			refusal(applyOp(card, { kind: "contract", artifact: proved(), goal: "x".repeat(401) }, CORE, NOW, board(card))),
		).toBe("goal must be at most 400 characters.");
	});
});

describe("approve", () => {
	test("records who approved the contract, and when", () => {
		const card = approved();
		expect(card.lane).toBe("plan");
		expect(card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
	});

	test("refuses the session that holds the card", () => {
		const card = written();
		expect(refusal(applyOp(card, { kind: "approve" }, CORE, NOW, board(card)))).toBe(
			"#4 is held by billing-core. Its contract is approved by a session that does not hold it.",
		);
	});

	test("refuses an incomplete contract, naming the missing lines", () => {
		const card = step(claimed(), { kind: "contract", artifact: proved("p.md"), goal: "G" }, CORE);
		expect(refusal(applyOp(card, { kind: "approve" }, LEAD, NOW, board(card)))).toBe(
			"#4 has no contract to approve yet: acceptance, scopeOut are missing.",
		);
	});

	test("refuses a lane other than plan", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "approve" }, LEAD, NOW, board(card)))).toBe(
			"#4 is in execute; a contract is approved in plan.",
		);
	});

	test("the same approver again is a no-op, and another one re-signs", () => {
		const card = approved();
		expect(accepted(applyOp(card, { kind: "approve" }, LEAD, NOW, board(card))).changed).toBe(false);
		const next = step(card, { kind: "approve" }, OTHER);
		expect(next.contract?.approved?.by).toBe(OTHER.label);
	});
});

describe("review", () => {
	test("records the spot-check, by a session that does not hold the card", () => {
		const card = reviewed();
		expect(card.review).toEqual({ by: LEAD.label, at: NOW });
	});

	test("refuses the holder, and a lane other than execute", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "review" }, CORE, NOW, board(card)))).toBe(
			"#4 is held by billing-core. A card is spot-checked by a session that does not hold it.",
		);
		const plan = approved();
		expect(refusal(applyOp(plan, { kind: "review" }, LEAD, NOW, board(plan)))).toBe(
			"#4 is in plan; finished work is spot-checked in execute.",
		);
	});

	test("the same reviewer again is a no-op", () => {
		const card = reviewed();
		expect(accepted(applyOp(card, { kind: "review" }, LEAD, NOW, board(card))).changed).toBe(false);
	});
});

describe("move", () => {
	test("plan to execute needs a complete and approved contract", () => {
		const written = step(claimed(), { kind: "contract", artifact: proved("p.md"), goal: "G" }, CORE);
		expect(
			refusal(
				applyOp(written, { kind: "move", lane: "execute", artifact: provedFor(written) }, CORE, NOW, board(written)),
			),
		).toBe("#4 is in plan; its contract needs goal, acceptance, and scopeOut — missing: acceptance, scopeOut.");
		const complete = approved();
		expect(
			refusal(
				applyOp(complete, { kind: "move", lane: "execute", artifact: provedFor(complete) }, LEAD, NOW, board(complete)),
			),
		).toBe("#4 is held by billing-core. Only its owner can move it.");
		expect(step(complete, { kind: "move", lane: "execute", artifact: provedFor(complete) }, CORE).lane).toBe("execute");
	});

	test("execute refuses a proof that belongs to another recorded path", () => {
		const card = approved();
		const elsewhere = { path: "plans/other.md", recorded: "plans/other.md" };
		expect(refusal(applyOp(card, { kind: "move", lane: "execute", artifact: elsewhere }, CORE, NOW, board(card)))).toBe(
			"#4's plan changed while it was being read; record it with `contract`.",
		);
	});

	test("execute refuses a caller that recorded a plan but did not prove it", () => {
		// Fail closed: a surface that forgets the check cannot open the gate by omission.
		const card = approved();
		expect(refusal(applyOp(card, { kind: "move", lane: "execute" }, CORE, NOW, board(card)))).toBe(
			"#4's plan was not checked; record it with `contract`.",
		);
	});

	test("plan to execute refuses an approved contract that is not there yet", () => {
		const card = written(CORE);
		expect(
			refusal(applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE, NOW, board(card))),
		).toBe("#4 is in plan; its contract is not approved yet. A session that does not hold it approves with `approve`.");
	});

	test("execute to done needs a spot-check and a recorded plan", () => {
		const card = executing();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE, NOW, board(card))),
		).toBe("#4 has no spot-check recorded; a session that does not hold it records one with `review`.");
		const checked = reviewed();
		const noPlan = { ...checked, planPath: undefined } as Card;
		expect(
			refusal(applyOp(noPlan, { kind: "move", lane: "done", artifact: provedFor(noPlan) }, CORE, NOW, board(noPlan))),
		).toBe("#4 has no plan recorded; move it back to plan, then record it with `contract`.");
		expect(step(checked, { kind: "move", lane: "done", artifact: provedFor(checked) }, CORE).lane).toBe("done");
	});

	test("a done move records the commit that closed the card", () => {
		const card = reviewed();
		const done = step(card, { kind: "move", lane: "done", landed: { commit: "4af1b4a" }, artifact: proved() }, CORE);
		expect(done.landed).toEqual({ commit: "4af1b4a", at: NOW });
	});

	test("plan to done is not a route, and the refusal names the ones that are", () => {
		const card = approved();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE, NOW, board(card))),
		).toBe("#4 is in plan; it can move to execute, or blocked, not done.");
	});

	test("a block records its kind and its sentence, and both are required of the kind", () => {
		const card = executing();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "blocked", blockedBy: "legal signs" }, CORE, NOW, board(card))),
		).toBe("a block needs a blocker: contract, dependency, decision.");
		const blocked = step(card, { kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal signs" }, CORE);
		expect(blocked).toMatchObject({ lane: "blocked", blocked: { kind: "decision", note: "legal signs" } });
	});

	test("a blocked card routes by its contract, not by the kind it was parked on", () => {
		// Parked from `plan`: the contract gate still stands in front of `execute`, so the way
		// back is planning — the kind of block has nothing to do with where the card may go.
		const planned = step(claimed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect(
			refusal(
				applyOp(planned, { kind: "move", lane: "execute", artifact: provedFor(planned) }, CORE, NOW, board(planned)),
			),
		).toBe(
			"#4 is in blocked; its contract needs goal, acceptance, and scopeOut — missing: goal, acceptance, scopeOut.",
		);
		expect(step(planned, { kind: "move", lane: "plan" }, CORE).lane).toBe("plan");
		// Parked from `execute`: it already carries the contract and its approval, so it resumes.
		const parked = step(executing(), { kind: "move", lane: "blocked", blocker: "dependency" }, CORE);
		expect(step(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE).lane).toBe("execute");
		// And a parked card may still be re-planned, as it may from `execute`.
		expect(step(parked, { kind: "move", lane: "plan" }, CORE).lane).toBe("plan");
	});

	test("a spot-check does not survive a park, so finishing needs a fresh look", () => {
		// The look was at work somebody then decided was not finished, so the gate asks again
		// rather than signing the older state.
		const parked = step(reviewed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect("review" in parked).toBe(false);
		const resumed = step(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
		expect(
			refusal(
				applyOp(resumed, { kind: "move", lane: "done", artifact: provedFor(resumed) }, CORE, NOW, board(resumed)),
			),
		).toBe("#4 has no spot-check recorded; a session that does not hold it records one with `review`.");
	});

	test("a blocked card resumes in execute, and its block is cleared on the way", () => {
		const parked = step(
			executing(),
			{ kind: "move", lane: "blocked", blocker: "dependency", blockedBy: "a link" },
			CORE,
		);
		const resumed = step(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
		expect(resumed.lane).toBe("execute");
		expect("blocked" in resumed).toBe(false);
		// The transition that parked it keeps what it was: the present record is deleted, the
		// history is not, so "why did this sit" survives the resume.
		expect(resumed.log?.find((entry) => entry.lane === "blocked")?.block).toEqual({
			kind: "dependency",
			note: "a link",
		});
	});

	test("a block lives only in the blocked lane: leaving it clears the record", () => {
		const parked = step(executing(), { kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal" }, CORE);
		// Release and reclaim are the two routes back to the pool, and neither may carry a block
		// into a lane that does not have one. The log keeps what the park was.
		for (const [op, actor] of [
			[{ kind: "release" }, CORE],
			[{ kind: "reclaim" }, LEAD],
		] as const) {
			const back = step(parked, op, actor);
			expect(back.lane).toBe("backlog");
			expect("blocked" in back).toBe(false);
			expect(back.log?.find((entry) => entry.lane === "blocked")?.block).toEqual({ kind: "decision", note: "legal" });
		}
		// And a claim out of the pool starts clean, so an executing card never reads a block.
		const released = step(parked, { kind: "release" }, CORE);
		const reclaimed = step(released, { kind: "claim" }, CORE);
		expect(reclaimed.lane).toBe("plan");
		expect("blocked" in reclaimed).toBe(false);
	});

	test("a spot-check does not survive a park, so finishing needs a fresh look", () => {
		const parked = step(reviewed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect("review" in parked).toBe(false);
		const resumed = step(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
		expect(
			refusal(
				applyOp(resumed, { kind: "move", lane: "done", artifact: provedFor(resumed) }, CORE, NOW, board(resumed)),
			),
		).toBe("#4 has no spot-check recorded; a session that does not hold it records one with `review`.");
	});

	test("execute to plan is re-planning, and it clears the spot-check", () => {
		const card = reviewed();
		const replanned = step(card, { kind: "move", lane: "plan" }, CORE);
		expect(replanned.lane).toBe("plan");
		expect("review" in replanned).toBe(false);
	});

	test("execute to done keeps the spot-check that let it through", () => {
		// `done` is the lane the sign is evidence for, and `review` refuses a finished card, so a
		// move that cleared it left the finished card's record telling nobody who had checked it.
		const card = reviewed();
		const finished = step(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE);
		expect(finished.lane).toBe("done");
		expect(finished.review).toEqual(card.review);
	});

	test("refuses the backlog as a target, an unclaimed card, a card held by another, and a finished one", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "move", lane: "backlog" }, CORE, NOW, board(card)))).toBe(
			"#4 cannot be moved to backlog; release it instead.",
		);
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "move", lane: "plan" }, CORE, NOW, board(pool)))).toBe(
			"#4 is unclaimed; claim it before moving it to plan.",
		);
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, OTHER, NOW, board(card))),
		).toBe("#4 is held by billing-core. Only its owner can move it.");
		const done = step(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(
			refusal(applyOp(done, { kind: "move", lane: "execute", artifact: provedFor(done) }, CORE, NOW, board(done))),
		).toBe("#4 is done; it cannot be moved.");
	});

	test("the same lane again is a no-op", () => {
		const card = executing();
		expect(
			accepted(applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE, NOW, board(card)))
				.changed,
		).toBe(false);
	});

	test("refuses the execute pull when that lane is full", () => {
		const full = ["1", "2", "3", "4", "5"].map((id) => executing(ready(id, CORE)));
		const queued = ready("9", CORE);
		const limits: WipLimits = { plan: 3, execute: 5 };
		expect(
			refusal(
				applyOp(
					queued,
					{ kind: "move", lane: "execute", artifact: provedFor(queued) },
					CORE,
					NOW,
					board(...full, queued),
					limits,
				),
			),
		).toBe(
			"#9 cannot enter execute: 5 cards are already executing (the limit is 5); finish, block, or release one first.",
		);
	});

	test("an unfinished dependency gates execute and done, not planning", () => {
		const blocker = ready("1", OTHER);
		const waiting = { ...ready("2", CORE), dependsOn: [blocker.id] };
		// Planning a card that waits is allowed: the contract is what the wait is read against.
		expect(
			refusal(
				applyOp(
					waiting,
					{ kind: "move", lane: "execute", artifact: provedFor(waiting) },
					CORE,
					NOW,
					board(blocker, waiting),
				),
			),
		).toContain("waits on");
		// Finishing is the other question the link answers: work that starts late cannot close
		// first, and a link recorded while the card was already executing is the way in.
		const finished = { ...reviewed(), dependsOn: [blocker.id] };
		expect(
			refusal(
				applyOp(
					finished,
					{ kind: "move", lane: "done", artifact: provedFor(finished) },
					CORE,
					NOW,
					board(blocker, finished),
				),
			),
		).toBe("#4 waits on #1 (plan).");
	});
});

describe("mayOp", () => {
	test("answers the refusal the write would, and nothing when the write would land", () => {
		const card = claimed();
		expect(mayOp(card, { kind: "claim" }, CORE, board(card))).toBeUndefined();
		expect(mayOp(card, { kind: "claim" }, OTHER, board(card))).toBe("#4 is held by billing-core.");
		expect(mayOp(card, { kind: "claim" }, OTHER, board(card))).toBe(
			refusal(applyOp(card, { kind: "claim" }, OTHER, NOW, board(card))),
		);
	});

	test("reads the limits it is given, not the defaults", () => {
		// `team` asks this before it sends a handoff, so a board configured with a limit of
		// one must refuse a second card before anything reaches the bus.
		const full = [pulled("1", CORE)];
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		const limits: WipLimits = { plan: 1, execute: 1 };
		expect(mayOp(pool, { kind: "claim" }, CORE, board(...full, pool), limits)).toContain("the limit is 1");
		expect(mayOp(pool, { kind: "claim" }, CORE, board(...full, pool))).toBeUndefined();
	});
});

describe("note and edit", () => {
	test("a note is appended, attributed and stamped, and the oldest drops past the cap", () => {
		const start = claimed();
		const notes = Array.from({ length: MAX_NOTES + 2 }, (_, index) => ({
			by: CORE.label,
			at: index,
			text: `n${index}`,
		}));
		const card = step({ ...start, notes, notesDropped: 0 }, { kind: "note", text: "latest" }, CORE);
		expect(card.notes).toHaveLength(MAX_NOTES);
		expect(card.notes.at(-1)?.text).toBe("latest");
		expect(card.notesDropped).toBe(3);
	});

	test("a note is the holder's, and a pool card is anybody's to note", () => {
		const held = claimed(CORE);
		expect(refusal(applyOp(held, { kind: "note", text: "n" }, LEAD, NOW, board(held)))).toBe(
			"#4 is held by billing-core. Only its owner can add a note.",
		);
		// Nobody holds the pool, so a note there is not a write on somebody else's card.
		const pool = created();
		expect(accepted(applyOp(pool, { kind: "note", text: "n" }, OTHER, NOW, board(pool))).changed).toBe(true);
	});

	test("edit fixes the title and hints whichever lane the card is in, and is a no-op when nothing changes", () => {
		const held = executing();
		const edited = step(held, { kind: "edit", title: "Billing webhook stores orders" }, CORE);
		expect(edited.title).toBe("Billing webhook stores orders");
		expect(
			accepted(applyOp(edited, { kind: "edit", title: "Billing webhook stores orders" }, CORE, NOW, board(edited)))
				.changed,
		).toBe(false);
		// A pool card belongs to nobody, so anybody may fix what it says before it is pulled.
		const pool = created();
		expect(step(pool, { kind: "edit", title: "Elsewhere" }, LEAD).title).toBe("Elsewhere");
	});

	test("a lane change is one log entry, and the log is bounded", () => {
		// A park and a re-plan is the cheapest loop that changes lane twice, so each move is one
		// entry and the oldest drops.
		let card = claimed();
		for (let round = 0; round < MAX_LOG + 2; round++) {
			card = step(card, { kind: "move", lane: "blocked", blocker: "contract" }, CORE);
			card = step(card, { kind: "move", lane: "plan" }, CORE);
		}
		expect(card.log?.length).toBe(MAX_LOG);
		expect(card.logDropped).toBeGreaterThan(0);
		expect(card.log?.at(-1)?.lane).toBe("plan");
	});
});

describe("offer, archive, and drop", () => {
	test("an offer is recorded on a pool card, and cleared by a claim", () => {
		const pool = created();
		const offered = step(pool, { kind: "offer" }, LEAD);
		expect(offered.offeredAt).toBe(NOW);
		expect("offeredAt" in step(offered, { kind: "claim" }, CORE)).toBe(false);
	});

	test("a held card cannot be offered", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "offer" }, LEAD, NOW, board(card)))).toBe("#4 is held by billing-core.");
	});

	test("a card is not offered into a full plan lane, which is the claim the offer asks for", () => {
		const full = pulled("1", CORE);
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		const limits: WipLimits = { plan: 1, execute: 5 };
		expect(refusal(applyOp(pool, { kind: "offer" }, LEAD, NOW, board(full, pool), limits))).toContain(
			"cannot be offered: 1 cards are already being planned (the limit is 1)",
		);
	});

	test("only a finished card can be archived, and it changes no field", () => {
		const executingCard = executing();
		expect(refusal(applyOp(executingCard, { kind: "archive" }, CORE, NOW, board(executingCard)))).toBe(
			"#4 is in execute; only a finished card can be archived.",
		);
		const done = step(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		const result = accepted(applyOp(done, { kind: "archive" }, LEAD, NOW, board(done)));
		expect(result.changed).toBe(true);
		expect(result.card).toEqual(done);
	});

	test("anyone may drop a pool or a finished card; a held one is the holder's", () => {
		const pool = created();
		expect(accepted(applyOp(pool, { kind: "drop" }, LEAD, NOW, board(pool))).changed).toBe(true);
		const held = claimed();
		expect(refusal(applyOp(held, { kind: "drop" }, LEAD, NOW, board(held)))).toBe(
			"#4 is held by billing-core. It cannot be dropped while someone holds it.",
		);
	});

	test("a card something waits on cannot be dropped", () => {
		const blocker = created();
		const waiting = { ...created(), id: "5", dependsOn: [blocker.id] };
		expect(refusal(applyOp(blocker, { kind: "drop" }, LEAD, NOW, board(blocker, waiting)))).toContain("#5");
	});
});
