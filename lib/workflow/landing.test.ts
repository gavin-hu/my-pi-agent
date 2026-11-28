/**
 * Which merge a finished card landed on: the chain the board reads, the rule that names the merge,
 * and the two doors that ask it.
 *
 * Split from `contract.test.ts` when the landing rule grew the ancestry question: the chain's own
 * cases and the refusal sentences are one capability, and the contract's four lines are another.
 */

import { describe, expect, test } from "bun:test";
import {
	applyOp,
	boardOf,
	closingCard,
	CORE,
	doneOf,
	landingFor as proofOf,
	mayOp,
	NOW,
	provedFor,
	reviewed,
} from "../../test/helpers/fixtures/board-rules.ts";
import {
	landingFor,
	landingGate,
	movedTree,
	beforeExecute,
	resolveLanding,
	landedWithoutMerge,
	absentFromBranch,
	unprovedLanding,
} from "./landing.ts";
import { workStartedAt } from "./lanes.ts";
import {
	BASE,
	BASE_AT,
	CARRIED,
	CARRIED_AT,
	ID,
	LANE,
	LATER,
	LATER_AT,
	PLAIN,
	REVIEWED,
	REVIEWED_AT,
	ROOT,
	commit,
	proof,
} from "../../test/helpers/fixtures/landing-chain.ts";

/**
 * The shas a landing case reads: a base commit, the merge that carried a review, and one on top.
 */
describe("resolveLanding", () => {
	test("answers the merge that carried the review, though a later merge landed on top", () => {
		// The case the tip rule got wrong: `A` merges at CARRIED, `B` merges at LATER, and `A` is
		// still the card being closed. A rule that read the tip refused it and asked for an override.
		expect(resolveLanding(LANE, REVIEWED, ID)).toEqual({ sha: CARRIED });
	});

	test("refuses a merge committed before the card's work, so a sign on the checkout's head names nothing", () => {
		// #641: the reviewer ran the gate in the root checkout on `main`, whose head was a merge made
		// before this card existed; `done` then named that merge as the landing. A merge older than
		// the card's own `execute` cannot be its landing, however the chain reads.
		//
		// #475 changed the sentence, not the guard: the refusal now says the commit predates `execute`
		// instead of speaking of a merge that a squashing repository never made.
		const late = proof(LANE.chain, CARRIED, { since: CARRIED_AT + 1 });
		expect(resolveLanding(late, CARRIED, ID)).toEqual({
			error: beforeExecute("main", CARRIED, ID),
			shape: "before-execute",
		});
	});

	test("answers a reviewed merge that is still the tip, so a review of the merged tree holds", () => {
		// A review taken after the merge is a review of the merged tree, and while that merge is the
		// tip it is its own landing: no moved-lines comparison, because a merge cannot be compared to
		// itself.
		expect(resolveLanding(proof(LANE.chain, LATER), LATER, ID)).toEqual({ sha: LATER });
	});

	test("refuses a reviewed merge once the branch has moved past it, naming the door", () => {
		// The pair that used to stand here read "a reviewed merge is its own landing" unconditionally,
		// and that is the defect: #641 closed a card on a merge another card had made. A merge that is
		// no longer the tip carries nothing of its own, so the close refuses and the door is a re-sign.
		expect(resolveLanding(proof(LANE.chain, CARRIED), CARRIED, ID)).toEqual({
			error: landedWithoutMerge("main", CARRIED, ID),
			shape: "ancestor",
		});
	});

	test("answers a squash landing by its trailing id once the branch has moved past it", () => {
		// #440's shape: a repository that lands by squashing has no merge carrying the review, so the
		// chain alone says nothing about which card a commit landed. #439 landed, #430 landed on top of
		// it, and the sign taken on that merged tree was refused as an older one.
		const SQUASH = "db80a71000000000000000000000000000000000";
		const ON_TOP = "96b8d22100000000000000000000000000000000";
		const squashed = proof(
			[
				commit(BASE, BASE_AT, ["0000000000000000000000000000000000000001"], "chore(repo): the base"),
				commit(SQUASH, REVIEWED_AT, [BASE], "refactor(contract): 业务实体去掉抽象与父实体（#12）"),
				commit(ON_TOP, LATER_AT, [SQUASH], "feat(web): 左栏搜索的出口（#13）"),
			],
			ON_TOP,
		);
		expect(resolveLanding(squashed, ON_TOP, ID)).toEqual({ sha: SQUASH });
	});

	test("reads only the trailing id, so a commit that names another card is not this card's landing", () => {
		// #438's subject ends with its own id and mentions #436 in passing. A loose match would name that
		// commit as #436's landing although #436 landed earlier — the misnaming this rule exists to stop.
		const MENTIONS = "a4e8561c00000000000000000000000000000000";
		const chain = proof(
			[
				commit(BASE, BASE_AT, ["0000000000000000000000000000000000000001"], "chore(repo): the base"),
				commit(MENTIONS, REVIEWED_AT, [BASE], "docs(repo): 更正 #12 那份 plan 的 Context（#13）"),
				commit(LATER, LATER_AT, [MENTIONS], "feat(web): 别人的落地（#14）"),
			],
			LATER,
		);
		expect(resolveLanding(chain, LATER, ID)).toEqual({
			error: landedWithoutMerge("main", LATER, ID),
			shape: "ancestor",
		});
	});

	test("reads the last id of a several-card marker, which is the one that landed", () => {
		// A landing that also corrected another card's plan carries both ids — `（#11、#12）` (#441) — and
		// the last one is the card that landed. Reading only a single-id marker left this shape unnamed.
		const SQUASH = "7c1f0a0000000000000000000000000000000000";
		const ON_TOP = "8d2e1b0000000000000000000000000000000000";
		const squashed = proof(
			[
				commit(BASE, BASE_AT, ["0000000000000000000000000000000000000001"], "chore(repo): the base"),
				commit(SQUASH, REVIEWED_AT, [BASE], "fix(gates): 补号要看全部 plan（#11、#12）"),
				commit(ON_TOP, LATER_AT, [SQUASH], "feat(web): 别人的落地（#13）"),
			],
			ON_TOP,
		);
		expect(resolveLanding(squashed, ON_TOP, ID)).toEqual({ sha: SQUASH });
	});

	test("refuses a marker whose last id is another card, so the several-card form cannot be borrowed", () => {
		// The order is the statement: `（#12、#11）` says #11 landed and merely touched #12. Taking any id in
		// the marker would name this commit as #12's landing — the #279 misnaming, one accepted form away.
		const OURS_NOT_LAST = "9e3f2c0000000000000000000000000000000000";
		const chain = proof(
			[
				commit(BASE, BASE_AT, ["0000000000000000000000000000000000000001"], "chore(repo): the base"),
				commit(OURS_NOT_LAST, REVIEWED_AT, [BASE], "fix(gates): 补号要看全部 plan（#12、#11）"),
				commit(LATER, LATER_AT, [OURS_NOT_LAST], "feat(web): 别人的落地（#13）"),
			],
			LATER,
		);
		expect(resolveLanding(chain, LATER, ID)).toEqual({
			error: landedWithoutMerge("main", LATER, ID),
			shape: "ancestor",
		});
	});

	test("follows the ancestry through a re-merge, so a branch merged twice needs no second sign", () => {
		// #618: the branch merged `main` into itself after the review, so the merge on `main` carries a
		// commit whose *own* second parent is the reviewed one. Reading one parent deep refused this.
		const inner = "1d0c0a0000000000000000000000000000000000";
		const again = "2e1d3b0000000000000000000000000000000000";
		const remade = proof(
			[
				commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
				commit(again, LATER_AT, [BASE, inner], "merge(work): the branch merged main in"),
			],
			REVIEWED,
			{ carries: (commit) => commit.sha === again },
		);
		expect(resolveLanding(remade, REVIEWED, ID)).toEqual({ sha: again });
	});

	test("refuses a plain commit that is on the chain but is not a landing", () => {
		// The #594/#593 shape: a sign taken in the checkout names main's head, a plain commit the
		// merge did not carry. Accepting any ancestor wrote a landing that carried nothing.
		//
		// The commit sits **after** `since` here on purpose (#475): one before it is the other shape,
		// `before-execute`, which says the sign predates the card's own work.
		const OTHER = "7ee0d10000000000000000000000000000000000";
		const unnamed = proof(
			[
				commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
				commit(PLAIN, REVIEWED_AT, [BASE], "feat(repo): a plain commit nobody carried"),
				commit(CARRIED, LATER_AT, [PLAIN, OTHER], "merge(work): another branch's work"),
			],
			PLAIN,
		);
		expect(resolveLanding(unnamed, PLAIN, ID)).toEqual({
			error: landedWithoutMerge("main", PLAIN, ID),
			shape: "ancestor",
		});
	});

	test("answers a plain commit when it is the chain's tip", () => {
		// A review taken after the work is the tip: there is no merge above it to look for, and it
		// names itself rather than being refused as an older tree.
		const tip = proof([
			commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
			commit(PLAIN, REVIEWED_AT, [BASE], "feat(repo): the plain commit a sign named"),
		]);
		expect(resolveLanding(tip, PLAIN, ID)).toEqual({ sha: PLAIN });
	});

	test("answers the earliest carrier, not whichever merge comes first in the list", () => {
		// Two merges both carry the reviewed commit, which a criss-cross can produce: the walk is
		// oldest-first and stops at the one that carried the work.
		const crossed = proof([
			commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
			commit(CARRIED, CARRIED_AT, [BASE, REVIEWED], "merge(work): the first carrier"),
			commit(LATER, LATER_AT, [CARRIED, REVIEWED], "merge(work): the second carrier"),
		]);
		expect(resolveLanding(crossed, REVIEWED, ID)).toEqual({ sha: CARRIED });
	});

	test("refuses a review the branch has never seen, and offers no instruction it cannot take", () => {
		// The shape a squash or a rebase leaves: the reviewed commit is nowhere on the branch, so there
		// is nothing for a person's reason to stand in for. The sentence used to promise `override`
		// here — a door the move gate refuses for exactly this shape — and the assertion below is
		// that it stopped.
		const squash = "5d0dd00000000000000000000000000000000000";
		const refused = resolveLanding(proof(LANE.chain, squash), squash, ID);
		expect(refused).toEqual({ error: absentFromBranch("main", squash, ID), shape: "unlanded" });
		if ("error" in refused) {
			expect(refused.error).toContain("#12's spot-check was of `5d0dd00`");
			expect(refused.error).toContain("no merge on `main` carries it");
			expect(refused.error).not.toContain("`override`");
			expect(refused.error).toContain("cannot stand in for");
		}
	});

	test("takes an instruction for a commit the branch holds, and never for one it does not", () => {
		// The two shapes an instruction is offered or refused for, asked at the gate rather than through
		// a card: a commit on the branch that no merge carried can be closed by a person's reason, while
		// a commit the branch has never seen cannot — and the sentence says which is which.
		const OTHER = "7ee0d10000000000000000000000000000000000";
		const onBranch = proof(
			[
				commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
				commit(PLAIN, REVIEWED_AT, [BASE], "feat(repo): a plain commit nobody carried"),
				commit(CARRIED, LATER_AT, [PLAIN, OTHER], "merge(work): another branch's work"),
			],
			PLAIN,
		);
		expect(landingGate(ID, PLAIN, onBranch, "landed with no merge to point at")).toBeUndefined();
		// The words say which shape it is: a commit the branch holds, carried by nothing.
		expect(landingGate(ID, PLAIN, onBranch)).toContain("which is on `main`");
		expect(landingGate(ID, PLAIN, onBranch)).toContain("may close the card by instruction");
		const nowhere = "5d0dd00000000000000000000000000000000000";
		const absent = proof(LANE.chain, nowhere);
		// And this one says the opposite, because it is the opposite: the commit is nowhere on the branch.
		expect(landingGate(ID, nowhere, absent, "close it")).toContain("not on the branch at all");
		expect(landingGate(ID, nowhere, absent, "close it")).toContain("cannot stand in for");
	});

	test("refuses a merge that moved the tree the review proved, naming the merge", () => {
		const refused = resolveLanding(proof(LANE.chain, REVIEWED, { moved: ["lib/workflow/steps.ts"] }), REVIEWED, ID);
		expect(refused).toEqual({
			error: movedTree("main", REVIEWED, CARRIED, ["lib/workflow/steps.ts"], ID),
			shape: "moved",
		});
		// The distinction the sentence carries: the merge, not the review, is the unchecked tree.
		if ("error" in refused) {
			expect(refused.error).toContain("the merge that carried it on `main`, `9a7d2e0`, moved lib/workflow/steps.ts");
			expect(refused.error).toContain("the merge is what nobody ran the gate on");
		}
	});

	test("names three moved paths and counts the rest, so a refusal stays one line", () => {
		const moved = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
		const said = movedTree("main", REVIEWED, CARRIED, moved, ID);
		expect(said).toContain("moved a.ts, b.ts, c.ts and 2 more");
	});

	test("says a chain that was never read is a refusal, not a pass", () => {
		expect(unprovedLanding(ID, REVIEWED)).toContain("the branch it landed on was not read");
	});
});

describe("the gate a landing answers", () => {
	test("owes nothing when the sign named no commit, because there is no branch to resolve", () => {
		expect(landingGate(ID, undefined, LANE)).toBeUndefined();
		expect(landingFor(ID, undefined, LANE, 7)).toBeUndefined();
	});

	test("refuses a sign whose branch was never read, rather than waving it through", () => {
		expect(landingGate(ID, REVIEWED, undefined)).toContain("the branch it landed on was not read");
		expect(landingFor(ID, REVIEWED, undefined, 7)).toBeUndefined();
	});

	test("records the merge the review became, stamped with the write's moment", () => {
		expect(landingGate(ID, REVIEWED, LANE)).toBeUndefined();
		expect(landingFor(ID, REVIEWED, LANE, 7)).toEqual({ sha: CARRIED, at: 7 });
	});
});

describe("closing a card by instruction", () => {
	/** The refusal a squash leaves, which is the only shape an instruction answers. */
	const refused = { refusal: "no merge on `main` carries it" };

	test("writes the instruction as a note, and no landing, when the door handed one in", () => {
		// The decision moved to where the chain is read, so `applyOp` applies both halves it is handed:
		// a verdict and an accepted instruction. What it must never do is invent a landing.
		const card = closingCard();
		const held = applyOp(
			card,
			{ ...doneOf(card), landed: refused, instruction: { text: "landed as a squash on main" } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("ok" in held && held.ok).toBe(true);
		if ("ok" in held && held.ok) {
			expect(held.card.landed).toBeUndefined();
			expect(held.card.notes.at(-1)?.text).toBe("closed by instruction: landed as a squash on main");
		}
	});

	test("writes no note when the door refused the instruction", () => {
		const card = closingCard();
		const held = applyOp(
			card,
			{ ...doneOf(card), landed: refused, instruction: { error: "an instruction cannot stand in for code" } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("error" in held ? held.error : "").toBe("an instruction cannot stand in for code");
	});

	test("records the landing the verdict names, stamped with the write's own moment", () => {
		const card = closingCard();
		const landed = applyOp(
			card,
			{ ...doneOf(card), landed: { landing: { sha: "abc1234" } } },
			CORE,
			NOW,
			boardOf(card),
		);
		expect("ok" in landed && landed.ok ? landed.card.landed : undefined).toEqual({ sha: "abc1234", at: NOW });
	});

	test("the window is the rule's, not the case's: a merge before the work names nothing", () => {
		// The assertion the cases above need in order to mean anything: their chains carry the reviewed
		// commit *after* the work began, so a pass is the rule answering rather than an empty candidate
		// set. This one moves the same merge behind `workStartedAt` and the answer flips.
		const card = closingCard();
		const started = workStartedAt(card);
		const root = "0".repeat(39) + "1";
		const chain = [
			commit(root, started - 3_000, [root], "chore(repo): the base"),
			commit("5d0dd0".padEnd(40, "0"), started - 2_000, [root], "merge(work): a merge made before the card began"),
			commit("b".repeat(40), started - 1_000, ["5d0dd0".padEnd(40, "0")], "merge(work): and one more"),
		];
		const inside = proofOf(card, chain);
		expect(landingGate(card.id, card.review?.verified?.sha, inside)).toContain("on `main`");
		// The same chain read from a card whose work began before it: the window opens, and the refusal
		// above is the rule rather than an empty set.
		const early = { ...card, log: [], createdAt: started - 9_000 };
		expect(landingGate(card.id, card.review?.verified?.sha, proofOf(early, chain))).toContain("on `main`");
	});
});

describe("a close handed no verdict", () => {
	test("is refused as unchecked, rather than trusted", () => {
		const card = reviewed();
		// The op a door builds with the one fact it resolves left out: the shape a surface added later
		// produces by forgetting it, and the one that used to close a card without a question.
		const refused = mayOp(card, { kind: "move", lane: "done", artifact: provedFor(card) }, CORE, boardOf(card));
		expect(refused).toContain("landing was not checked");
	});

	test("closes on `none`, the fact that the sign had nothing to prove", () => {
		const card = reviewed();
		const op = {
			kind: "move" as const,
			lane: "done" as const,
			artifact: provedFor(card),
			landed: { none: true as const },
		};
		expect(mayOp(card, op, CORE, boardOf(card))).toBeUndefined();
	});
});
