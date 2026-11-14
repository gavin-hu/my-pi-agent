/**
 * Who may sign a card's two gates, and the sentences the other sessions are refused with.
 *
 * The gate is a name compare, so what matters here is that the two accepted actors are accepted
 * and that every refusal names the way out: the lead's name, and the person's `/board` command.
 */

import { describe, expect, test } from "bun:test";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import {
	accepted,
	doneOf,
	applyOp,
	boardOf,
	CORE,
	executing,
	LEAD as BOARD_LEAD,
	NOW,
	refusal,
	VERIFY,
	verifying,
} from "../../test/helpers/fixtures/board-rules.ts";
import { type Card } from "./card.ts";
import {
	announced,
	currentReview,
	holderRefusal,
	isLead,
	isPerson,
	type Lead,
	failedSpotCheck,
	missingSign,
	normalizeLead,
	owesAnnouncement,
	PERSON_LABEL,
	personActor,
	signMark,
	signRefusal,
	signRecord,
	signedAs,
	signStale,
	staleSpotCheck,
	signedText,
	type Sign,
	unverifiedSpotCheck,
} from "./lead.ts";
import { askLead, leadName } from "./contract.ts";
import { boardConfig, type BoardConfig } from "./config.ts";
import type { Actor } from "./rules.ts";

const LEAD: Lead = "team-lead";
const PEER: Actor = { id: "s-peer", label: "api-core" };
const THE_LEAD: Actor = { id: "s-lead", label: "Team-Lead" };
const CARD = numberedCard("4");

/** A card this suite signs, so a case names only the fields the sign reads. */
const card = (overrides: Partial<Card> = {}) => numberedCard("4", overrides);

describe("currentReview", () => {
	/** An executing card that entered its lane at `since`, with a sign made at `at`. */
	const signed = (since: number, at: number) =>
		card({
			lane: "execute",
			owner: { label: "billing-core" },
			review: { by: "billing-lead", at },
			log: [
				{ lane: "backlog", at: since - 2_000, by: "billing-lead" },
				{ lane: "execute", at: since, by: "billing-core" },
			],
		});

	test("answers with the sign made since the card entered the lane", () => {
		expect(currentReview(signed(2_000, 3_000))).toMatchObject({ by: "billing-lead", at: 3_000 });
		expect(currentReview(signed(2_000, 2_000))).toMatchObject({ at: 2_000 });
	});

	test("answers nothing for a sign a previous execution left on the card", () => {
		// A reclaim keeps the lead's spot-check, and a kept sign is evidence about the work that was
		// taken back rather than about the execution the card is in now.
		expect(currentReview(signed(2_000, 1_500))).toBeUndefined();
	});

	test("keeps a sign a finished card carries, whatever the lane entry says", () => {
		// `done` is the lane the sign is evidence for, so the entry it followed is not a cut-off.
		const done = card({
			lane: "done",
			owner: { label: "billing-core" },
			review: { by: "lead", at: 1_000 },
			log: [{ lane: "done", at: 2_000, by: "billing-core" }],
		});
		expect(currentReview(done)).toMatchObject({ at: 1_000 });
	});

	test("keeps a sign whose lane entry the log no longer has", () => {
		// An elided log is not a reason to demand a second signature: the sign is the only evidence
		// left, and asking again for one already made is the worse answer.
		const silent = card({ lane: "execute", owner: { label: "billing-core" }, review: { by: "lead", at: 1_000 } });
		expect(currentReview(silent)).toMatchObject({ at: 1_000 });
	});
});

describe("normalizeLead", () => {
	test("a name is a label: flattened, trimmed, and capped", () => {
		expect(normalizeLead("  billing   lead ", LEAD)).toBe("billing lead");
		expect(normalizeLead("x".repeat(60), LEAD)).toHaveLength(40);
	});

	test("anything else keeps the name the layer below gave", () => {
		expect(normalizeLead(undefined, LEAD)).toBe(LEAD);
		expect(normalizeLead("   ", LEAD)).toBe(LEAD);
		expect(normalizeLead({ name: "lead" }, LEAD)).toBe(LEAD);
	});

	test("an empty string clears the name the layer below gave", () => {
		// The default team names a lead, so a project that wants none has to be able to say so.
		expect(normalizeLead("", LEAD)).toBe("");
	});
});

describe("isLead and isPerson", () => {
	test("a name is compared the way a teammate is addressed", () => {
		expect(isLead(THE_LEAD, LEAD)).toBe(true);
		expect(isLead(PEER, LEAD)).toBe(false);
		expect(isLead({ label: "team-lead" }, LEAD)).toBe(true);
	});

	test("the person is the actor no session can be", () => {
		expect(isPerson(personActor())).toBe(true);
		expect(isPerson(PEER)).toBe(false);
		expect(personActor()).toEqual({ id: "person:you", label: PERSON_LABEL });
	});
});

describe("signMark and signedAs", () => {
	test("the person signs as the lead's name, and the mark says the key wrote it", () => {
		expect(signMark(personActor(), LEAD)).toEqual({ by: LEAD, person: true });
		expect(signMark(PEER, LEAD)).toEqual({ by: PEER.label });
	});

	test("a board that names no lead records the person under their own label", () => {
		// There is no name to lend, and an empty `by` would be a sign nobody made: the person is
		// still a signer, so the record carries the label their own line prints.
		expect(signMark(personActor(), "")).toEqual({ by: PERSON_LABEL, person: true });
		expect(signedAs({ by: PERSON_LABEL, at: 1, person: true }, personActor(), "")).toBe(true);
	});

	test("the mark is the identity, so a session wearing the lead's label is somebody else", () => {
		// The person's sign and the same-named session's sign differ only by the mark, which is the
		// whole reason a label compare was wrong: it read one back as the other.
		const personal = { by: LEAD, at: 1, person: true } as const;
		const sessionSign = { by: LEAD, at: 1 };
		const leadSession: Actor = { id: "s-lead", label: LEAD };
		expect(signedAs(personal, personActor(), LEAD)).toBe(true);
		expect(signedAs(personal, leadSession, LEAD)).toBe(false);
		expect(signedAs(sessionSign, leadSession, LEAD)).toBe(true);
		expect(signedAs(sessionSign, personActor(), LEAD)).toBe(false);
		expect(signedAs(undefined, personActor(), LEAD)).toBe(false);
		// The person's label is not a name a card holds, so nothing signs back as it either.
		expect(signedAs({ by: PERSON_LABEL, at: 1 }, personActor(), LEAD)).toBe(false);
	});
});

describe("signRefusal", () => {
	test("the lead and the person sign, and nobody else does", () => {
		expect(signRefusal(CARD, THE_LEAD, LEAD, "approve")).toBeUndefined();
		expect(signRefusal(CARD, personActor(), LEAD, "approve")).toBeUndefined();
		expect(signRefusal(CARD, personActor(), LEAD, "review")).toBeUndefined();
	});

	test("a session that is not the lead is told whose signature the gate takes, and how to ask", () => {
		expect(signRefusal(CARD, PEER, LEAD, "approve")).toBe(
			"#4's contract is signed by the lead (team-lead), and this session is api-core — ask team-lead with `session send`, or the person signs it with `/board approve 4`.",
		);
		expect(signRefusal(CARD, PEER, LEAD, "review")).toBe(
			"#4 is spot-checked by the lead (team-lead), and this session is api-core — ask team-lead with `session send`, or the person signs with `/board review 4`.",
		);
	});

	test("with no lead named, the refusal names the key and keeps the person's door", () => {
		// The sentence a project sees before it has stated its team: the way out is the setting, or
		// the person at the keyboard — never a peer to ask, because there is nobody to ask.
		expect(signRefusal(CARD, PEER, "", "approve")).toBe(
			"#4's contract is signed by the lead, and this board names none: set `team.lead` in `bytefly.json`, or the person signs it with `/board approve 4`.",
		);
		expect(signRefusal(CARD, PEER, "", "review")).toBe(
			"#4 is spot-checked by the lead, and this board names none: set `team.lead` in `bytefly.json`, or the person signs with `/board review 4`.",
		);
		// The person is still the one door the gate accepts.
		expect(signRefusal(CARD, personActor(), "", "approve")).toBeUndefined();
	});
});

describe("holderRefusal", () => {
	test("a lead is told to release the card, and another holder is told whose sign it is", () => {
		expect(holderRefusal(THE_LEAD, LEAD, "approve")).toBe("A lead releases a card before signing it.");
		expect(holderRefusal(THE_LEAD, LEAD, "review")).toBe("A lead releases a card before spot-checking it.");
		expect(holderRefusal(PEER, LEAD, "approve")).toBe("Its contract is signed by the lead, who does not hold it.");
		expect(holderRefusal(PEER, LEAD, "review")).toBe("A card is spot-checked by the lead, who does not hold it.");
	});
});

describe("missingSign", () => {
	test("a lane that needs a sign names both ways to give it, and the channel that reaches the lead", () => {
		expect(missingSign(CARD, LEAD, "approve")).toBe(
			"#4 is in plan; its contract is not approved yet. The lead (team-lead) approves with `approve` (ask team-lead with `session send`), or the person with `/board approve 4`.",
		);
		expect(missingSign(CARD, LEAD, "review")).toBe(
			"#4 has no spot-check recorded. The lead (team-lead) records one with `review` (ask team-lead with `session send`), or the person with `/board review 4`.",
		);
	});

	test("with no lead named, it is the person's door that opens the lane", () => {
		expect(missingSign(CARD, "", "approve")).toBe(
			"#4 is in plan; its contract is not approved yet, and this board names none: set `team.lead` in `bytefly.json`, or the person approves it with `/board approve 4`.",
		);
	});
});

describe("the run a spot-check records", () => {
	/** The sentence the `done` gate is refused with when the contract named a command and no run came. */
	test("a missing run names the command and both doors that would record one", () => {
		expect(unverifiedSpotCheck(CARD, "bun run check", LEAD)).toBe(
			"#4's contract names `bun run check`, and its spot-check carries no result: the lead (team-lead) records one with `review`, or the person with `/board review 4`.",
		);
	});

	test("a stale run says what to re-run, and why the last one stopped counting", () => {
		expect(staleSpotCheck(CARD, "bun run check", LEAD)).toBe(
			"#4 was written after its spot-check, so the run no longer speaks for it — run `bun run check` and review again: the lead (team-lead) with `review`, or the person with `/board review 4`.",
		);
	});

	test("a red run is the check doing its job, and names the exit it gave", () => {
		expect(failedSpotCheck(CARD, "bun run check", 1)).toBe("`bun run check` exited 1, so #4 was not spot-checked.");
	});
});

describe("the words a refusal prints", () => {
	test("the lead is reached by its name over the bus, which is the one phrase every surface prints", () => {
		expect(askLead(LEAD)).toBe("ask team-lead with `session send`");
	});

	test("with no lead named, a sentence names the setting instead of a peer and never a blank", () => {
		expect(askLead("")).toBe("set `team.lead` in `bytefly.json`");
		expect(leadName(LEAD)).toBe(LEAD);
		expect(leadName("")).toBe("`team.lead`");
		expect(unverifiedSpotCheck(CARD, "bun run check", "")).toContain(
			"the lead (`team.lead`) records one with `review`",
		);
	});
});

describe("signedText", () => {
	test("the owner is told who signed and the move the sign unlocked", () => {
		expect(signedText(CARD, "approve", THE_LEAD.label)).toBe(
			'Signature: #4 "feature 4" — its contract is approved by Team-Lead.\nNext: `execute` is open — board action "move" with lane "execute", while the lane has room. `done` still needs the lead\'s `review`.',
		);
		expect(signedText(CARD, "review", THE_LEAD.label)).toBe(
			'Signature: #4 "feature 4" — spot-checked by Team-Lead.\nNext: `done` is open — board action "move" with lane "done", while the plan it recorded is still in the store.',
		);
	});
});

describe("the announcement", () => {
	const CONFIG: BoardConfig = boardConfig({ lead: LEAD });
	/** The moment a record is stamped with: nothing in this module reads a clock of its own. */
	const NOW = 5_000;
	const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s", verify: "bun run check" };
	/** A card in plan whose contract the lead approved, or one the person did. */
	const approved = (by: Actor = THE_LEAD) =>
		card({ lane: "plan", contract: { ...COMPLETE, approved: { ...signMark(by, LEAD), at: 1 } } });
	const tell = (target: Card, sign: Sign, actor: Actor) =>
		announced(target, { kind: "announced", sign }, actor, CONFIG, NOW);

	test("records the moment on the sign, and a second record is the no-op", () => {
		const first = tell(approved(), "approve", THE_LEAD);
		expect(first).toMatchObject({ changed: true });
		const told = first && "fields" in first ? { ...approved(), ...first.fields } : undefined;
		expect(told?.contract?.approved?.told).toEqual({ at: NOW });
		// Two doors recording one announcement is one fact, not a second write.
		expect(told === undefined ? undefined : tell(told, "approve", THE_LEAD)).toMatchObject({ changed: false });
	});

	test("is the signer's to record, and the person's sign is the person's", () => {
		// The name is the lead's and the mark is the person's: a session wearing the lead's label did
		// not make that signature, so it cannot say the message landed. The person's own door can.
		expect(tell(approved(), "approve", PEER)).toMatchObject({ error: expect.stringContaining("to announce") });
		expect(tell(approved(personActor()), "approve", THE_LEAD)).toMatchObject({
			error: expect.stringContaining("to announce"),
		});
		expect(tell(approved(personActor()), "approve", personActor())).toMatchObject({ changed: true });
	});

	test("refuses a gate nobody signed, and the other gate's sign", () => {
		expect(tell(card({ lane: "plan" }), "approve", THE_LEAD)).toMatchObject({
			error: expect.stringContaining("has no approval to announce"),
		});
		expect(tell(approved(), "review", THE_LEAD)).toMatchObject({
			error: expect.stringContaining("has no spot-check to announce"),
		});
	});

	test("a repeat sign owes the message until the sign records it", () => {
		const fresh = approved();
		// A fresh stamp owes one; the actor's own untold sign owes one; a told sign owes nothing.
		expect(owesAnnouncement(card({ lane: "plan" }), "approve", THE_LEAD, LEAD)).toBe(true);
		expect(owesAnnouncement(fresh, "approve", THE_LEAD, LEAD)).toBe(true);
		const recorded =
			fresh.contract?.approved === undefined
				? undefined
				: { ...fresh, contract: { ...fresh.contract, approved: { ...fresh.contract.approved, told: { at: 1 } } } };
		expect(recorded === undefined ? undefined : owesAnnouncement(recorded, "approve", THE_LEAD, LEAD)).toBe(false);
		// Somebody else's sign is not the one this actor repeats, so the call is a fresh stamp to them.
		expect(owesAnnouncement(recorded ?? fresh, "approve", PEER, LEAD)).toBe(true);
	});

	test("reads the review a done card closed on, not the sign a reclaim kept", () => {
		const reviewed = card({ lane: "execute", owner: { label: "api-core" }, review: { by: THE_LEAD.label, at: 2 } });
		expect(signRecord(reviewed, "review")).toMatchObject({ at: 2 });
		expect(signRecord(reviewed, "approve")).toBeUndefined();
	});
});

describe("signStale", () => {
	test("the card's own clock, against the sign and the announcement that followed it", () => {
		const stamp = { by: BOARD_LEAD.label, at: 2_000 };
		expect(signStale(card({ updatedAt: 2_000 }), stamp)).toBe(false);
		expect(signStale(card({ updatedAt: 2_001 }), stamp)).toBe(true);
		// The announcement is the sign's own second write, so it buys the stamp the time it needs:
		// reading the card's clock against the stamp alone refused the golden path (#398).
		const told = { ...stamp, told: { at: 2_500 } };
		expect(signStale(card({ updatedAt: 2_500 }), told)).toBe(false);
		expect(signStale(card({ updatedAt: 2_501 }), told)).toBe(true);
	});
});

describe("the stamp a repeat makes", () => {
	/** One operation at an explicit moment, and the card it left. */
	const at = (from: Card, op: Parameters<typeof applyOp>[1], moment: number, actor = BOARD_LEAD): Card =>
		accepted(applyOp(from, op, actor, moment, boardOf(from))).card;
	/** The run a card whose contract names `VERIFY` has to carry with every sign. */
	const run = (moment: number) => ({ cmd: VERIFY, exit: 0, at: moment });

	test("re-makes a sign the card has outgrown, so `done` can open again", () => {
		// The sequence that stuck #416: sign, a write, a refusal naming "review again", and a repeat
		// by the same signer — which used to leave the stamp where it was and so could never satisfy
		// the gate it was told to satisfy.
		const signed = at(verifying(), { kind: "review", verified: run(NOW + 1) }, NOW + 1);
		const noted = at(signed, { kind: "note", text: "one more thing" }, NOW + 2, CORE);
		expect(refusal(applyOp(noted, doneOf(noted), CORE, NOW + 3, boardOf(noted)))).toContain(
			"was written after its spot-check",
		);
		const again = at(noted, { kind: "review", verified: run(NOW + 4) }, NOW + 4);
		expect(again.review?.at).toBe(NOW + 4);
		expect(again.review?.verified).toEqual(run(NOW + 4));
		expect(accepted(applyOp(again, doneOf(again), CORE, NOW + 5, boardOf(again))).card.lane).toBe("done");
	});

	test("re-makes a sign that speaks, even where the card has not outgrown the old one", () => {
		// The widening: a repeat carrying text is a new sign, not only a repair. It re-stamps and
		// re-announces, because the note it writes moves the card past the stamp it replaced.
		const signed = at(executing(), { kind: "review", verified: run(NOW + 1) }, NOW + 1);
		const said = accepted(
			applyOp(
				signed,
				{ kind: "review", text: "one more look", verified: run(NOW + 2) },
				BOARD_LEAD,
				NOW + 2,
				boardOf(signed),
			),
		);
		expect(said.changed).toBe(true);
		expect(said.card.review?.at).toBe(NOW + 2);
		expect(said.card.notes.at(-1)?.text).toBe("one more look");
	});

	test("answers nothing for an identical sign that still speaks for the card", () => {
		// No text and no write since the sign: the repeat rule's whole purpose — the sign there is
		// already the one that was asked for.
		const signed = at(executing(), { kind: "review", verified: run(NOW + 1) }, NOW + 1);
		const again = applyOp(signed, { kind: "review", verified: run(NOW + 1) }, BOARD_LEAD, NOW + 1, boardOf(signed));
		expect(again.ok && again.changed).toBe(false);
		expect(again.ok && again.card.review).toEqual(signed.review);
	});

	test("owes the owner the message again, because the stamp it replaces was heard", () => {
		const signed = at(executing(), { kind: "review", verified: run(NOW + 1) }, NOW + 1);
		const heard = at(signed, { kind: "announced", sign: "review" }, NOW + 2);
		const noted = at(heard, { kind: "note", text: "one more thing" }, NOW + 3, CORE);
		const again = applyOp(noted, { kind: "review", verified: run(NOW + 4) }, BOARD_LEAD, NOW + 4, boardOf(noted));
		expect(again.ok && again.announce).toBe(true);
		// The fresh stamp has no `told`: the owner is told once more, and the next write after it is
		// the one that makes the sign stale again.
		expect(again.ok && again.card.review?.told).toBeUndefined();
		expect(again.ok && again.card.review?.at).toBe(NOW + 4);
	});
});
