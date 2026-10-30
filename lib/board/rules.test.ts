/**
 * The card lifecycle: who may do what, what a refusal says, and the gates that turn a
 * feature into a pull system.
 *
 * One table is the contract for the tool, the router, and the page, so these cases are the
 * whole authorisation story for a card: the lane matrix in `lanes.ts`, the two human gates
 * (an approved contract before `execute`, a spot-check before `done`), and the WIP limits
 * read from config. Every refusal is checked for its sentence as well as its state, because
 * the sentence is what a model retries against. The two signatures have their own suite,
 * `signs.test.ts`; the fixtures both share are `test/helpers/fixtures/board-rules.ts`.
 */

import { describe, expect, test } from "bun:test";
import { type Card, CARD_VERSION, MAX_LOG, MAX_NOTES, holds } from "./card.ts";
import type { BoardConfig } from "./config.ts";
import { createCard } from "./rules.ts";
import {
	accepted,
	applyOp,
	approved,
	boardOf,
	CONTRACT,
	claimed,
	CORE,
	created,
	executing,
	LEAD,
	mayOp,
	NOW,
	OTHER,
	proved,
	provedFor,
	pulled,
	ready,
	refusal,
	reviewed,
	stepOf,
	written,
} from "../../test/helpers/fixtures/board-rules.ts";

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
		const card = stepOf(created(), { kind: "claim" }, { label: "ad-hoc" });
		expect(card.owner).toEqual({ label: "ad-hoc" });
	});

	test("already holding it is a no-op, not a second revision", () => {
		const card = claimed();
		const result = accepted(applyOp(card, { kind: "claim" }, CORE, NOW, boardOf(card)));
		expect(result.changed).toBe(false);
		expect(result.card.rev).toBe(card.rev);
	});

	test("refuses a card another session holds, naming it", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "claim" }, OTHER, NOW, boardOf(card)))).toBe("#4 is held by billing-core.");
	});

	test("refuses a finished card", () => {
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "claim" }, LEAD, NOW, boardOf(done)))).toBe(
			"#4 is done; it cannot be claimed.",
		);
	});

	test("refuses the pull when plan is full, and says how to make room", () => {
		const config: BoardConfig = { wip: { plan: 3, execute: 5 }, lead: LEAD.label };
		const full = [pulled("1", CORE), pulled("2", OTHER), pulled("3", LEAD)];
		const pool = createCard("7", { title: "D", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(pool, { kind: "claim" }, CORE, NOW, boardOf(...full, pool), config))).toBe(
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
		const card = accepted(applyOp(created, { kind: "assign", to: CORE }, LEAD, NOW, boardOf(created))).card;
		expect(card).toMatchObject({ lane: "plan", owner: { id: CORE.id, label: CORE.label }, by: LEAD.label });
	});

	test("assignment is not a lane change: a card in plan stays there", () => {
		// Naming the session that already holds a card is the one held case assign accepts, and
		// it is a no-op: the lane it earned is unchanged and no revision is spent.
		const card = approved();
		const result = accepted(applyOp(card, { kind: "assign", to: CORE }, LEAD, NOW, boardOf(card)));
		expect(result.changed).toBe(false);
		expect(result.card.lane).toBe("plan");
	});

	test("handing a card to a different session is refused; reclaim is how it changes hands", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "assign", to: OTHER }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a card a third session holds", () => {
		const card = claimed(CORE);
		expect(refusal(applyOp(card, { kind: "assign", to: OTHER }, LEAD, NOW, boardOf(card)))).toBe(
			"#4 is held by billing-core.",
		);
	});

	test("refuses a finished card", () => {
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "assign", to: OTHER }, LEAD, NOW, boardOf(done)))).toBe(
			"#4 is done; it cannot be assigned.",
		);
	});

	test("refuses the pull into a full plan lane", () => {
		const full = [pulled("1", CORE), pulled("2", OTHER), pulled("3", LEAD)];
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		expect(refusal(applyOp(pool, { kind: "assign", to: CORE }, LEAD, NOW, boardOf(...full, pool)))).toContain(
			"cannot enter plan",
		);
	});
});

describe("release and reclaim", () => {
	test("release returns a card to the backlog with no owner", () => {
		const card = claimed();
		const back = stepOf(card, { kind: "release" }, CORE);
		expect(back.lane).toBe("backlog");
		expect("owner" in back).toBe(false);
	});

	test("release keeps the contract and its approval: the plan did not change", () => {
		const card = approved();
		const back = stepOf(card, { kind: "release" }, CORE);
		expect(back.contract).toMatchObject({ ...CONTRACT, approved: { by: LEAD.label, at: NOW } });
	});

	test("release from execute clears the spot-check, which was about finished work", () => {
		const card = reviewed();
		const back = stepOf(card, { kind: "release" }, CORE);
		expect("review" in back).toBe(false);
	});

	test("release refuses a card nobody holds, and a finished one", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "release" }, CORE, NOW, boardOf(pool)))).toBe("#4 is not claimed.");
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(refusal(applyOp(done, { kind: "release" }, CORE, NOW, boardOf(done)))).toBe(
			"#4 is done; it cannot be released.",
		);
	});

	test("reclaim takes the card back from whoever holds it, and keeps its notes", () => {
		const card = stepOf(claimed(), { kind: "note", text: "halfway" }, CORE);
		const back = stepOf(card, { kind: "reclaim" }, LEAD);
		expect(back).toMatchObject({ lane: "backlog", by: LEAD.label });
		expect("owner" in back).toBe(false);
		expect(back.notes.at(-1)?.text).toBe("halfway");
	});

	test("reclaim refuses a card nobody holds", () => {
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "reclaim" }, LEAD, NOW, boardOf(pool)))).toBe("#4 has no owner to reclaim.");
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
		const repointed = stepOf(card, { kind: "contract", artifact: proved("plans/other.md"), ...CONTRACT }, CORE);
		expect(repointed.planPath).toBe("plans/other.md");
		expect(repointed.contract?.approved).toBeUndefined();
		expect(repointed.contract?.goal).toBe(CONTRACT.goal);
	});

	test("re-recording the same plan and lines keeps the sign, and is a no-op", () => {
		const card = approved();
		const same = accepted(
			applyOp(card, { kind: "contract", artifact: proved(), ...CONTRACT }, CORE, NOW, boardOf(card)),
		);
		expect(same.changed).toBe(false);
		expect(same.card.contract?.approved).toEqual({ by: LEAD.label, at: NOW });
	});

	test("a changed line drops the approval, because the sign named a wording", () => {
		const card = approved();
		const reworded = stepOf(
			card,
			{ kind: "contract", artifact: proved(), scopeOut: "No refunds, no partial captures" },
			CORE,
		);
		expect(reworded.contract?.scopeOut).toBe("No refunds, no partial captures");
		expect(reworded.contract?.approved).toBeUndefined();
	});

	test("re-writing the same lines is a no-op", () => {
		const card = written();
		const same = accepted(
			applyOp(card, { kind: "contract", artifact: proved(), ...CONTRACT }, CORE, NOW, boardOf(card)),
		);
		expect(same.changed).toBe(false);
	});

	test("refuses a contract with no plan, naming where the path comes from", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "contract", ...CONTRACT }, CORE, NOW, boardOf(card)))).toBe(
			"contract needs the plan file #4 is executed against: pass `path` as write_plan returned it.",
		);
	});

	test("refuses a lane other than plan, and a session that does not hold it", () => {
		const pool = created();
		expect(
			refusal(applyOp(pool, { kind: "contract", artifact: proved(), ...CONTRACT }, LEAD, NOW, boardOf(pool))),
		).toBe("#4 is in backlog; its contract is written in plan.");
		const card = claimed();
		expect(
			refusal(applyOp(card, { kind: "contract", ...CONTRACT, artifact: proved("p.md") }, OTHER, NOW, boardOf(card))),
		).toBe("#4 is held by billing-core. Only its owner records a plan.");
	});

	test("holds each line to one line and its cap", () => {
		const card = claimed();
		// A line is flattened at the boundary: a goal that arrives with a newline is stored as
		// the one line a row and a dialog rung can hold.
		const multi = accepted(
			applyOp(card, { kind: "contract", artifact: proved(), goal: "two\nlines" }, CORE, NOW, boardOf(card)),
		).card;
		expect(multi.contract?.goal).toBe("two lines");
		expect(
			refusal(applyOp(card, { kind: "contract", artifact: proved(), goal: "x".repeat(401) }, CORE, NOW, boardOf(card))),
		).toBe("goal must be at most 400 characters.");
	});
});

describe("move", () => {
	test("plan to execute needs a complete and approved contract", () => {
		const written = stepOf(claimed(), { kind: "contract", artifact: proved("p.md"), goal: "G" }, CORE);
		expect(
			refusal(
				applyOp(written, { kind: "move", lane: "execute", artifact: provedFor(written) }, CORE, NOW, boardOf(written)),
			),
		).toBe("#4 is in plan; its contract needs goal, acceptance, and scopeOut — missing: acceptance, scopeOut.");
		const complete = approved();
		expect(
			refusal(
				applyOp(
					complete,
					{ kind: "move", lane: "execute", artifact: provedFor(complete) },
					LEAD,
					NOW,
					boardOf(complete),
				),
			),
		).toBe("#4 is held by billing-core. Only its owner can move it.");
		expect(stepOf(complete, { kind: "move", lane: "execute", artifact: provedFor(complete) }, CORE).lane).toBe(
			"execute",
		);
	});

	test("execute refuses a proof that belongs to another recorded path", () => {
		const card = approved();
		const elsewhere = { path: "plans/other.md", recorded: "plans/other.md" };
		expect(
			refusal(applyOp(card, { kind: "move", lane: "execute", artifact: elsewhere }, CORE, NOW, boardOf(card))),
		).toBe("#4's plan changed while it was being read; record it with `contract`.");
	});

	test("execute refuses a caller that recorded a plan but did not prove it", () => {
		// Fail closed: a surface that forgets the check cannot open the gate by omission.
		const card = approved();
		expect(refusal(applyOp(card, { kind: "move", lane: "execute" }, CORE, NOW, boardOf(card)))).toBe(
			"#4's plan was not checked; record it with `contract`.",
		);
	});

	test("plan to execute refuses an approved contract that is not there yet", () => {
		const card = written(CORE);
		expect(
			refusal(applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE, NOW, boardOf(card))),
		).toBe(
			"#4 is in plan; its contract is not approved yet. The lead (billing-lead) approves with `approve`, or the person with `/board approve 4`.",
		);
	});

	test("execute to done needs a spot-check and a recorded plan", () => {
		const card = executing();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE, NOW, boardOf(card))),
		).toBe(
			"#4 has no spot-check recorded. The lead (billing-lead) records one with `review`, or the person with `/board review 4`.",
		);
		const checked = reviewed();
		const noPlan = { ...checked, planPath: undefined } as Card;
		expect(
			refusal(applyOp(noPlan, { kind: "move", lane: "done", artifact: provedFor(noPlan) }, CORE, NOW, boardOf(noPlan))),
		).toBe("#4 has no plan recorded; move it back to plan, then record it with `contract`.");
		expect(stepOf(checked, { kind: "move", lane: "done", artifact: provedFor(checked) }, CORE).lane).toBe("done");
	});

	test("a done move records the commit that closed the card", () => {
		const card = reviewed();
		const done = stepOf(card, { kind: "move", lane: "done", landed: { commit: "4af1b4a" }, artifact: proved() }, CORE);
		expect(done.landed).toEqual({ commit: "4af1b4a", at: NOW });
	});

	test("plan to done is not a route, and the refusal names the ones that are", () => {
		const card = approved();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE, NOW, boardOf(card))),
		).toBe("#4 is in plan; it can move to execute, or blocked, not done.");
	});

	test("a block records its kind and its sentence, and both are required of the kind", () => {
		const card = executing();
		expect(
			refusal(applyOp(card, { kind: "move", lane: "blocked", blockedBy: "legal signs" }, CORE, NOW, boardOf(card))),
		).toBe("a block needs a blocker: contract, dependency, decision.");
		const blocked = stepOf(
			card,
			{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal signs" },
			CORE,
		);
		expect(blocked).toMatchObject({ lane: "blocked", blocked: { kind: "decision", note: "legal signs" } });
	});

	test("a blocked card routes by its contract, not by the kind it was parked on", () => {
		// Parked from `plan`: the contract gate still stands in front of `execute`, so the way
		// back is planning — the kind of block has nothing to do with where the card may go.
		const planned = stepOf(claimed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect(
			refusal(
				applyOp(planned, { kind: "move", lane: "execute", artifact: provedFor(planned) }, CORE, NOW, boardOf(planned)),
			),
		).toBe(
			"#4 is in blocked; its contract needs goal, acceptance, and scopeOut — missing: goal, acceptance, scopeOut.",
		);
		expect(stepOf(planned, { kind: "move", lane: "plan" }, CORE).lane).toBe("plan");
		// Parked from `execute`: it already carries the contract and its approval, so it resumes.
		const parked = stepOf(executing(), { kind: "move", lane: "blocked", blocker: "dependency" }, CORE);
		expect(stepOf(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE).lane).toBe("execute");
		// And a parked card may still be re-planned, as it may from `execute`.
		expect(stepOf(parked, { kind: "move", lane: "plan" }, CORE).lane).toBe("plan");
	});

	test("a spot-check does not survive a park, so finishing needs a fresh look", () => {
		// The look was at work somebody then decided was not finished, so the gate asks again
		// rather than signing the older state.
		const parked = stepOf(reviewed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect("review" in parked).toBe(false);
		const resumed = stepOf(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
		expect(
			refusal(
				applyOp(resumed, { kind: "move", lane: "done", artifact: provedFor(resumed) }, CORE, NOW, boardOf(resumed)),
			),
		).toBe(
			"#4 has no spot-check recorded. The lead (billing-lead) records one with `review`, or the person with `/board review 4`.",
		);
	});

	test("a blocked card resumes in execute, and its block is cleared on the way", () => {
		const parked = stepOf(
			executing(),
			{ kind: "move", lane: "blocked", blocker: "dependency", blockedBy: "a link" },
			CORE,
		);
		const resumed = stepOf(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
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
		const parked = stepOf(
			executing(),
			{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal" },
			CORE,
		);
		// Release and reclaim are the two routes back to the pool, and neither may carry a block
		// into a lane that does not have one. The log keeps what the park was.
		for (const [op, actor] of [
			[{ kind: "release" }, CORE],
			[{ kind: "reclaim" }, LEAD],
		] as const) {
			const back = stepOf(parked, op, actor);
			expect(back.lane).toBe("backlog");
			expect("blocked" in back).toBe(false);
			expect(back.log?.find((entry) => entry.lane === "blocked")?.block).toEqual({ kind: "decision", note: "legal" });
		}
		// And a claim out of the pool starts clean, so an executing card never reads a block.
		const released = stepOf(parked, { kind: "release" }, CORE);
		const reclaimed = stepOf(released, { kind: "claim" }, CORE);
		expect(reclaimed.lane).toBe("plan");
		expect("blocked" in reclaimed).toBe(false);
	});

	test("a resume into a full lane says what a blocked card can do about it", () => {
		const config: BoardConfig = { wip: { plan: 3, execute: 5 }, lead: LEAD.label };
		// A park frees a slot rather than reserving one, so the lane can refill while it waits.
		const parked = stepOf(
			executing(),
			{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal" },
			CORE,
		);
		const full = [pulled("1", CORE), pulled("2", OTHER), pulled("3", LEAD)];
		expect(refusal(applyOp(parked, { kind: "move", lane: "plan" }, CORE, NOW, boardOf(...full, parked), config))).toBe(
			"#4 cannot enter plan: 3 cards are already being planned (the limit is 3); wait for a slot, or release it back to the pool.",
		);
	});

	test("a blocker belongs to a move into blocked, and nowhere else", () => {
		const card = approved();
		expect(
			refusal(
				applyOp(
					card,
					{ kind: "move", lane: "execute", blocker: "decision", artifact: provedFor(card) },
					CORE,
					NOW,
					boardOf(card),
				),
			),
		).toBe("a blocker is recorded by a move to blocked, not to execute.");
	});

	test("a reason is fixed while the card is parked, and the refusal says how to change it", () => {
		const parked = stepOf(
			executing(),
			{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "legal" },
			CORE,
		);
		expect(
			refusal(
				applyOp(
					parked,
					{ kind: "move", lane: "blocked", blocker: "dependency", blockedBy: "a link" },
					CORE,
					NOW,
					boardOf(parked),
				),
			),
		).toBe(
			"#4 is blocked; its reason is fixed while the card is parked — resume it, then park it again with the new sentence.",
		);
	});

	test("a spot-check does not survive a park, so finishing needs a fresh look", () => {
		const parked = stepOf(reviewed(), { kind: "move", lane: "blocked", blocker: "decision" }, CORE);
		expect("review" in parked).toBe(false);
		const resumed = stepOf(parked, { kind: "move", lane: "execute", artifact: provedFor(parked) }, CORE);
		expect(
			refusal(
				applyOp(resumed, { kind: "move", lane: "done", artifact: provedFor(resumed) }, CORE, NOW, boardOf(resumed)),
			),
		).toBe(
			"#4 has no spot-check recorded. The lead (billing-lead) records one with `review`, or the person with `/board review 4`.",
		);
	});

	test("execute to plan is re-planning, and it clears the spot-check", () => {
		const card = reviewed();
		const replanned = stepOf(card, { kind: "move", lane: "plan" }, CORE);
		expect(replanned.lane).toBe("plan");
		expect("review" in replanned).toBe(false);
	});

	test("execute to done keeps the spot-check that let it through", () => {
		// `done` is the lane the sign is evidence for, and `review` refuses a finished card, so a
		// move that cleared it left the finished card's record telling nobody who had checked it.
		const card = reviewed();
		const finished = stepOf(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE);
		expect(finished.lane).toBe("done");
		expect(finished.review).toEqual(card.review);
	});

	test("refuses the backlog as a target, an unclaimed card, a card held by another, and a finished one", () => {
		const card = executing();
		expect(refusal(applyOp(card, { kind: "move", lane: "backlog" }, CORE, NOW, boardOf(card)))).toBe(
			"#4 cannot be moved to backlog; release it instead.",
		);
		const pool = created();
		expect(refusal(applyOp(pool, { kind: "move", lane: "plan" }, CORE, NOW, boardOf(pool)))).toBe(
			"#4 is unclaimed; claim it before moving it to plan.",
		);
		expect(
			refusal(applyOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, OTHER, NOW, boardOf(card))),
		).toBe("#4 is held by billing-core. Only its owner can move it.");
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		expect(
			refusal(applyOp(done, { kind: "move", lane: "execute", artifact: provedFor(done) }, CORE, NOW, boardOf(done))),
		).toBe("#4 is done; it cannot be moved.");
	});

	test("the same lane again is a no-op", () => {
		const card = executing();
		expect(
			accepted(applyOp(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE, NOW, boardOf(card)))
				.changed,
		).toBe(false);
	});

	test("refuses the execute pull when that lane is full", () => {
		const full = ["1", "2", "3", "4", "5"].map((id) => executing(ready(id, CORE)));
		const queued = ready("9", CORE);
		const config: BoardConfig = { wip: { plan: 3, execute: 5 }, lead: LEAD.label };
		expect(
			refusal(
				applyOp(
					queued,
					{ kind: "move", lane: "execute", artifact: provedFor(queued) },
					CORE,
					NOW,
					boardOf(...full, queued),
					config,
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
					boardOf(blocker, waiting),
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
					boardOf(blocker, finished),
				),
			),
		).toBe("#4 waits on #1 (plan).");
	});
});

describe("mayOp", () => {
	test("answers the refusal the write would, and nothing when the write would land", () => {
		const card = claimed();
		expect(mayOp(card, { kind: "claim" }, CORE, boardOf(card))).toBeUndefined();
		expect(mayOp(card, { kind: "claim" }, OTHER, boardOf(card))).toBe("#4 is held by billing-core.");
		expect(mayOp(card, { kind: "claim" }, OTHER, boardOf(card))).toBe(
			refusal(applyOp(card, { kind: "claim" }, OTHER, NOW, boardOf(card))),
		);
	});

	test("reads the limits it is given, not the defaults", () => {
		// `team` asks this before it sends a handoff, so a board configured with a limit of
		// one must refuse a second card before anything reaches the bus.
		const full = [pulled("1", CORE)];
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		const config: BoardConfig = { wip: { plan: 1, execute: 1 }, lead: LEAD.label };
		expect(mayOp(pool, { kind: "claim" }, CORE, boardOf(...full, pool), config)).toContain("the limit is 1");
		expect(mayOp(pool, { kind: "claim" }, CORE, boardOf(...full, pool))).toBeUndefined();
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
		const card = stepOf({ ...start, notes, notesDropped: 0 }, { kind: "note", text: "latest" }, CORE);
		expect(card.notes).toHaveLength(MAX_NOTES);
		expect(card.notes.at(-1)?.text).toBe("latest");
		expect(card.notesDropped).toBe(3);
	});

	test("a note is the holder's, and a pool card is anybody's to note", () => {
		const held = claimed(CORE);
		expect(refusal(applyOp(held, { kind: "note", text: "n" }, LEAD, NOW, boardOf(held)))).toBe(
			"#4 is held by billing-core. Only its owner can add a note.",
		);
		// Nobody holds the pool, so a note there is not a write on somebody else's card.
		const pool = created();
		expect(accepted(applyOp(pool, { kind: "note", text: "n" }, OTHER, NOW, boardOf(pool))).changed).toBe(true);
	});

	test("edit fixes the title and hints whichever lane the card is in, and is a no-op when nothing changes", () => {
		const held = executing();
		const edited = stepOf(held, { kind: "edit", title: "Billing webhook stores orders" }, CORE);
		expect(edited.title).toBe("Billing webhook stores orders");
		expect(
			accepted(applyOp(edited, { kind: "edit", title: "Billing webhook stores orders" }, CORE, NOW, boardOf(edited)))
				.changed,
		).toBe(false);
		// A pool card belongs to nobody, so anybody may fix what it says before it is pulled.
		const pool = created();
		expect(stepOf(pool, { kind: "edit", title: "Elsewhere" }, LEAD).title).toBe("Elsewhere");
	});

	test("a lane change is one log entry, and the log is bounded", () => {
		// A park and a re-plan is the cheapest loop that changes lane twice, so each move is one
		// entry and the oldest drops.
		let card = claimed();
		for (let round = 0; round < MAX_LOG + 2; round++) {
			card = stepOf(card, { kind: "move", lane: "blocked", blocker: "contract" }, CORE);
			card = stepOf(card, { kind: "move", lane: "plan" }, CORE);
		}
		expect(card.log?.length).toBe(MAX_LOG);
		expect(card.logDropped).toBeGreaterThan(0);
		expect(card.log?.at(-1)?.lane).toBe("plan");
	});
});

describe("offer, archive, and drop", () => {
	test("an offer is recorded on a pool card, and cleared by a claim", () => {
		const pool = created();
		const offered = stepOf(pool, { kind: "offer" }, LEAD);
		expect(offered.offeredAt).toBe(NOW);
		expect("offeredAt" in stepOf(offered, { kind: "claim" }, CORE)).toBe(false);
	});

	test("a held card cannot be offered", () => {
		const card = claimed();
		expect(refusal(applyOp(card, { kind: "offer" }, LEAD, NOW, boardOf(card)))).toBe("#4 is held by billing-core.");
	});

	test("a card is not offered into a full plan lane, which is the claim the offer asks for", () => {
		const full = pulled("1", CORE);
		const pool = createCard("9", { title: "D", paths: [] }, LEAD, 1_000);
		const config: BoardConfig = { wip: { plan: 1, execute: 5 }, lead: LEAD.label };
		expect(refusal(applyOp(pool, { kind: "offer" }, LEAD, NOW, boardOf(full, pool), config))).toContain(
			"cannot be offered: 1 cards are already being planned (the limit is 1)",
		);
	});

	test("only a finished card can be archived, and it changes no field", () => {
		const executingCard = executing();
		expect(refusal(applyOp(executingCard, { kind: "archive" }, CORE, NOW, boardOf(executingCard)))).toBe(
			"#4 is in execute; only a finished card can be archived.",
		);
		const done = stepOf(reviewed(), { kind: "move", lane: "done", artifact: proved() }, CORE);
		const result = accepted(applyOp(done, { kind: "archive" }, LEAD, NOW, boardOf(done)));
		expect(result.changed).toBe(true);
		expect(result.card).toEqual(done);
	});

	test("anyone may drop a pool or a finished card; a held one is the holder's", () => {
		const pool = created();
		expect(accepted(applyOp(pool, { kind: "drop" }, LEAD, NOW, boardOf(pool))).changed).toBe(true);
		const held = claimed();
		expect(refusal(applyOp(held, { kind: "drop" }, LEAD, NOW, boardOf(held)))).toBe(
			"#4 is held by billing-core. It cannot be dropped while someone holds it.",
		);
	});

	test("a card something waits on cannot be dropped", () => {
		const blocker = created();
		const waiting = { ...created(), id: "5", dependsOn: [blocker.id] };
		expect(refusal(applyOp(blocker, { kind: "drop" }, LEAD, NOW, boardOf(blocker, waiting)))).toContain("#5");
	});
});
