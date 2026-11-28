/**
 * The contract: the four lines a card promises, the boundary the model's arguments pass,
 * and the sign an approval leaves.
 *
 * The caps are asserted here because the model writes them: a goal that wraps a row or a
 * scope-out that grows a card file is refused at the boundary rather than clamped later.
 */

import { describe, expect, test } from "bun:test";
import {
	CONTRACT_LINES,
	contractApproved,
	contractComplete,
	isContract,
	isHandoff,
	isSign,
	isVerification,
	MAX_CONTRACT,
	mergedContract,
	missingContractFields,
	normalizeContractField,
	normalizeInstruction,
} from "./contract.ts";
import {
	accepted,
	applyOp,
	boardOf,
	CONTRACT,
	CORE,
	finished,
	NOW,
	OTHER,
	proved,
	pulled,
	written,
} from "../../test/helpers/fixtures/board-rules.ts";

const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s", verify: "bun run check" };

/** A contract stored before `verify` was required: three keys, and still one this build reads. */
const LEGACY = { goal: "g", acceptance: "a", scopeOut: "s" };

describe("normalizeContractField", () => {
	test("keeps one sanitized line", () => {
		expect(normalizeContractField("goal", "  a goal\nwith a break  ")).toEqual({ text: "a goal with a break" });
	});

	test("refuses an absent, empty, or over-long line, naming the field", () => {
		expect(normalizeContractField("goal", undefined)).toEqual({ error: "goal is required." });
		expect(normalizeContractField("acceptance", "   ")).toEqual({ error: "acceptance is required." });
		expect(normalizeContractField("scopeOut", "x".repeat(MAX_CONTRACT + 1))).toEqual({
			error: `scopeOut is ${MAX_CONTRACT + 1} characters; the limit is ${MAX_CONTRACT} — trim 1.`,
		});
		expect(normalizeContractField("goal", 7)).toEqual({ error: "goal is required." });
	});
});

describe("the required verify line", () => {
	test("is one sanitized line, refused empty like its three neighbours", () => {
		// One parser for four lines: an empty command is a line the contract owes, not a way to take
		// the line back off — the gate that asks for it is the reason the line exists.
		expect(normalizeContractField("verify", "  bun run check\n")).toEqual({ text: "bun run check" });
		expect(normalizeContractField("verify", "")).toEqual({ error: "verify is required." });
		expect(normalizeContractField("verify", 7)).toEqual({ error: "verify is required." });
		expect(normalizeContractField("verify", "x".repeat(MAX_CONTRACT + 1))).toEqual({
			error: `verify is ${MAX_CONTRACT + 1} characters; the limit is ${MAX_CONTRACT} — trim 1.`,
		});
	});

	test("is a line a contract owes, so a card without it is not complete", () => {
		// The split the card closes: a contract with three lines was approvable, and the gate its
		// sign got was a sentence rather than a run.
		expect(missingContractFields(LEGACY)).toEqual(["verify"]);
		expect(missingContractFields(COMPLETE)).toEqual([]);
		expect(contractComplete(LEGACY)).toBe(false);
	});

	test("rides a change like any other contract line, so the sign goes with it", () => {
		// The failure this line exists to prevent: a spot-check that ran the old command standing
		// as evidence for a promise the card no longer makes.
		const approved = { ...COMPLETE, approved: { by: "lead", at: 5 } };
		const renamed = mergedContract(approved, { verify: "bun test" });
		expect(renamed.verify).toBe("bun test");
		expect(renamed.approved).toBeUndefined();
		// And a write that changes nothing else keeps it where it was.
		expect(mergedContract(approved, {}).verify).toBe("bun run check");
	});

	test("is not a required key in the shape, so an older contract still reads", () => {
		// `isContract` answers shape, and requiring the key here would make every contract stored
		// before this rule unreadable: `isCard` would drop the records rather than report them owed.
		expect(isContract(LEGACY)).toBe(true);
		expect(isContract(COMPLETE)).toBe(true);
		expect(isContract({ ...LEGACY, verify: "" })).toBe(true);
		expect(isContract({ ...COMPLETE, verify: 7 } as unknown)).toBe(false);
		expect(isContract({ ...COMPLETE, verify: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
	});
});

describe("missingContractFields", () => {
	test("a card with no contract is missing every line, in order", () => {
		expect(missingContractFields(undefined)).toEqual([...CONTRACT_LINES]);
	});

	test("names only the blank lines, so a refusal says what to write", () => {
		const blank = { goal: "g", acceptance: "", scopeOut: "s", verify: "bun run check" };
		expect(missingContractFields(blank)).toEqual(["acceptance"]);
		expect(contractComplete(blank)).toBe(false);
		expect(contractComplete({ ...blank, acceptance: "a" })).toBe(true);
	});
});

describe("an approval", () => {
	test("is absent until somebody signs, and the sign is a name and a moment", () => {
		expect(contractApproved({ ...COMPLETE })).toBe(false);
		expect(contractApproved({ ...COMPLETE, approved: { by: "billing-lead", at: 1 } })).toBe(true);
	});

	test("an edited line drops the sign, because it named a wording", () => {
		const approved = { ...COMPLETE, approved: { by: "billing-lead", at: 1 } };
		const reworded = mergedContract(approved, { scopeOut: "no refunds" });
		expect(reworded).toEqual({ goal: "g", acceptance: "a", scopeOut: "no refunds", verify: "bun run check" });
		expect(reworded.approved).toBeUndefined();
	});

	test("merging keeps every line it was not given", () => {
		expect(mergedContract({ goal: "g", acceptance: "a", scopeOut: "s" }, { acceptance: "b" })).toEqual({
			goal: "g",
			acceptance: "b",
			scopeOut: "s",
		});
	});
});

describe("normalizeInstruction", () => {
	test("keeps one sanitized line, in the signer's words", () => {
		expect(normalizeInstruction("  closed on my instruction\nfor 0.22.0 ")).toEqual({
			text: "closed on my instruction for 0.22.0",
		});
	});

	test("refuses an absent, empty, or over-long reason, in the words of the field", () => {
		expect(normalizeInstruction(undefined)).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction("   ")).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction(7)).toEqual({ error: "override needs the one line saying why." });
		expect(normalizeInstruction("x".repeat(MAX_CONTRACT + 1))).toEqual({
			error: `override is ${MAX_CONTRACT + 1} characters; the limit is ${MAX_CONTRACT} — trim 1.`,
		});
	});
});

describe("isContract and isSign", () => {
	test("accepts what this build writes, and an older contract with no sign", () => {
		expect(isContract(COMPLETE)).toBe(true);
		expect(isContract({ ...COMPLETE, approved: { by: "billing-lead", at: 1 } })).toBe(true);
	});

	test("refuses a missing line, a line that is not one, an over-long one, and a sign that is not one", () => {
		// A missing key is a hand edit, not a half-written contract: the writer states all three, empty
		// or not, so only a file edited by hand loses one.
		expect(isContract({ goal: "g", acceptance: "a" })).toBe(false);
		expect(isContract({ ...COMPLETE, goal: 7 } as unknown)).toBe(false);
		expect(isContract({ ...COMPLETE, acceptance: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "", at: 1 } })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "x", at: 1.5 } })).toBe(false);
		expect(isContract("not a contract")).toBe(false);
	});

	test("reads a contract written a field at a time, and leaves completeness to its own query", () => {
		// The bug this card is: `mergedContract` writes "" for a line a call did not name, and a
		// predicate that demanded three written lines made that card unreadable — `isCard` dropped the
		// record and its holder was locked out of their own card.
		const half = { ...COMPLETE, acceptance: "" };
		expect(isContract(half)).toBe(true);
		expect(missingContractFields(half)).toEqual(["acceptance"]);
		expect(contractComplete(half)).toBe(false);
	});

	test("a sign is a label and a whole moment", () => {
		expect(isSign({ by: "billing-lead", at: 0 })).toBe(true);
		expect(isSign({ by: "billing-lead" })).toBe(false);
		expect(isSign(undefined)).toBe(false);
	});

	test("a sign carries the person's mark, or nothing at all", () => {
		// The mark says the key rather than a session wrote it, so `true` is the only value the write
		// path produces: a hand-edited `false` is a record this build cannot read back as a sign.
		expect(isSign({ by: "billing-lead", at: 0, person: true })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, person: false })).toBe(false);
		expect(isContract({ ...COMPLETE, approved: { by: "billing-lead", at: 1, person: true } })).toBe(true);
	});

	test("a sign says when its message was settled, and only as a whole moment", () => {
		// A malformed announcement would read as "still owed" for the rest of the card's life: the sign
		// would keep asking its signer to say the same thing again.
		expect(isSign({ by: "billing-lead", at: 0, told: { at: 4 } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, told: { at: 1.5 } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, told: {} })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, told: "just now" })).toBe(false);
	});

	test("a handoff says the same fact as a sign, and a card refuses one that is malformed", () => {
		// Same rule as a sign's: a stamp, and a settled message or none. A handoff with no stamp, or a
		// `told` that is not one, would read as "still owed" for the rest of the card's life.
		expect(isHandoff({ at: 1 })).toBe(true);
		expect(isHandoff({ at: 1, told: { at: 2 } })).toBe(true);
		expect(isHandoff({ at: 1.5 })).toBe(false);
		expect(isHandoff({ told: { at: 2 } })).toBe(false);
		expect(isHandoff({ at: 1, told: "yes" })).toBe(false);
		expect(isHandoff({ at: 1, told: { at: "now" } })).toBe(false);
		expect(isHandoff(undefined)).toBe(false);
	});

	test("a spot-check's run names its tree, and a record without one still reads", () => {
		// The tree is the half a sha cannot say: the same commit backs a branch and its checkout, so a
		// record that names only the commit reads as proof of whichever tree the reader assumed. Signs
		// written before the board recorded one carry no field, and must keep reading.
		const run = { cmd: "bun run check", exit: 0, at: 4, sha: "1d3a8ce3" };
		expect(isSign({ by: "billing-lead", at: 0, verified: run })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: "/repo/.pi/worktrees/x" } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: "" } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, root: 7 } })).toBe(false);
	});

	test("a run's branch and checkout are the tree a path cannot say at a glance", () => {
		// `checkout` is a `true`-only mark, like `person` and `unresolved`: `false` is a spelling of the
		// absence, and a record states which tree it was or says nothing. A branch is text; empty is not a
		// branch, and a number is not one either.
		const run = { cmd: "bun run check", exit: 0, at: 4, root: "/repo", sha: "1d3a8ce3" };
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, branch: "main", checkout: true } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, branch: "worktree-x" } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, checkout: true } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, branch: "" } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, branch: 7 } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, checkout: false } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, checkout: 1 } })).toBe(false);
	});

	test("a run's size gate is one of its two answers, and a record without one still reads", () => {
		// #481: the gate is part of the evidence because a reader cannot ask a card whether it ran, so the
		// field is read as strictly as the rest — `ran` is the fact and nothing else, a skip is a whole
		// line, and a file that says both is not a shape any call produces.
		const run = { cmd: "bun run check", exit: 0, at: 4, root: "/repo" };
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { ran: true } } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { skipped: "no test/" } } })).toBe(true);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { ran: false } } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { skipped: "" } } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { skipped: 7 } } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: {} } })).toBe(false);
		expect(isSign({ by: "billing-lead", at: 0, verified: { ...run, sizeGates: { ran: true, skipped: "both" } } })).toBe(
			false,
		);
	});

	test("a sign by instruction is trusted only as the line a signer would have written", () => {
		expect(isSign({ by: "you", at: 0, byInstruction: "closed on my instruction" })).toBe(true);
		// A stored sign the write path would never produce: an empty reason, a wrapping one, and a
		// wrapping one whose newline has been flattened but not capped.
		expect(isSign({ by: "you", at: 0, byInstruction: "" })).toBe(false);
		expect(isSign({ by: "you", at: 0, byInstruction: "two\nlines" })).toBe(false);
		expect(isSign({ by: "you", at: 0, byInstruction: "x".repeat(MAX_CONTRACT + 1) })).toBe(false);
	});
});

describe("a plan file another card records", () => {
	// The record's suite rather than the step's: `rules.test.ts` holds `describe("the contract")` at a
	// declared 673 in `test/suite-sizes.test.ts`, where an entry may only fall — so this pair lives beside
	// the record the collision protects instead of costing that file a split. Both cases run through
	// `applyOp`, because the rule is the state machine's and not a helper's.
	test("is refused, naming the card that holds it", () => {
		const held = finished();
		const heldPlan = held.planPath;
		if (heldPlan === undefined) throw new Error("the fixture's finished card records no plan");
		const second = pulled("961", OTHER);
		const op = { kind: "contract" as const, artifact: proved(heldPlan), ...CONTRACT };
		const answered = applyOp(second, op, OTHER, NOW, boardOf(held, second));
		// The sentence is the assertion, not just the refusal: a case that only expects `ok: false` would
		// pass on any other refusal the state machine happened to give.
		expect(answered.ok ? "" : answered.error).toContain(`#${held.id} holds; a plan is one card's`);
	});

	test("still records on the card that already holds it, because that is the re-plan", () => {
		const card = written();
		const changed = accepted(
			applyOp(
				card,
				{ kind: "contract", artifact: proved(), ...CONTRACT, goal: "A different promise" },
				CORE,
				NOW,
				boardOf(card),
			),
		);
		expect(changed.changed).toBe(true);
		expect(changed.card.contract?.goal).toBe("A different promise");
	});
});

describe("the run a sign records", () => {
	/** A run of one command, which is the shape every record has. */
	const RUN = { cmd: "bun run check", exit: 0, at: NOW };

	test("keeps the base that moved, which is a fact about the tree and not the command", () => {
		// `behind` is the landing's warning, recorded beside the run so the page can print it without git.
		expect(isVerification({ ...RUN, behind: { base: "origin/main", sha: "20fdf9c7" } })).toBe(true);
		expect(isVerification(RUN)).toBe(true);
	});

	test("refuses a base it cannot read, because a record it cannot trust is not an older record", () => {
		// The file is hand-editable, so a shape this build never writes is a refusal rather than an absence.
		expect(isVerification({ ...RUN, behind: { base: 3, sha: "20fdf9c7" } })).toBe(false);
		expect(isVerification({ ...RUN, behind: { base: "origin/main" } })).toBe(false);
		expect(isVerification({ ...RUN, behind: { base: "", sha: "20fdf9c7" } })).toBe(false);
		expect(isVerification({ ...RUN, behind: "origin/main" })).toBe(false);
	});
});
