/**
 * Who may sign a card's two gates, and the sentences the other sessions are refused with.
 *
 * The gate is a name compare, so what matters here is that the two accepted actors are accepted
 * and that every refusal names the way out: the lead's name, and the person's `/board` command.
 */

import { describe, expect, test } from "bun:test";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import { type Card } from "./card.ts";
import {
	announced,
	askLead,
	currentReview,
	holderRefusal,
	isLead,
	isPerson,
	type Lead,
	missingSign,
	normalizeLead,
	owesAnnouncement,
	PERSON_LABEL,
	personActor,
	signMark,
	signRefusal,
	signRecord,
	signedAs,
	signedText,
	type Sign,
} from "./lead.ts";
import { DEFAULT_WIP } from "./limits.ts";
import type { BoardConfig } from "./config.ts";
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
});

describe("askLead", () => {
	test("the lead is reached by its name over the bus, which is the one phrase every surface prints", () => {
		expect(askLead(LEAD)).toBe("ask team-lead with `session send`");
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
	const CONFIG: BoardConfig = { wip: DEFAULT_WIP, lead: LEAD };
	/** The moment a record is stamped with: nothing in this module reads a clock of its own. */
	const NOW = 5_000;
	const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s" };
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
