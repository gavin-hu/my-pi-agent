/**
 * Who may sign a card's two gates, and the sentences the other sessions are refused with.
 *
 * The gate is a name compare, so what matters here is that the two accepted actors are accepted
 * and that every refusal names the way out: the lead's name, and the person's `/board` command.
 */

import { describe, expect, test } from "bun:test";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import {
	holderRefusal,
	isLead,
	isPerson,
	type Lead,
	missingSign,
	normalizeLead,
	PERSON_LABEL,
	personActor,
	signRefusal,
} from "./lead.ts";
import type { Actor } from "./rules.ts";

const LEAD: Lead = "team-lead";
const PEER: Actor = { id: "s-peer", label: "api-core" };
const THE_LEAD: Actor = { id: "s-lead", label: "Team-Lead" };
const CARD = numberedCard("4");

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

describe("signRefusal", () => {
	test("the lead and the person sign, and nobody else does", () => {
		expect(signRefusal(CARD, THE_LEAD, LEAD, "approve")).toBeUndefined();
		expect(signRefusal(CARD, personActor(), LEAD, "approve")).toBeUndefined();
		expect(signRefusal(CARD, personActor(), LEAD, "review")).toBeUndefined();
	});

	test("a session that is not the lead is told whose signature the gate takes", () => {
		expect(signRefusal(CARD, PEER, LEAD, "approve")).toBe(
			"#4's contract is signed by the lead (team-lead); this session is api-core. The person signs it with `/board approve 4`.",
		);
		expect(signRefusal(CARD, PEER, LEAD, "review")).toBe(
			"#4 is spot-checked by the lead (team-lead); this session is api-core. The person signs with `/board review 4`.",
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
	test("a lane that needs a sign names both ways to give it", () => {
		expect(missingSign(CARD, LEAD, "approve")).toBe(
			"#4 is in plan; its contract is not approved yet. The lead (team-lead) approves with `approve`, or the person with `/board approve 4`.",
		);
		expect(missingSign(CARD, LEAD, "review")).toBe(
			"#4 has no spot-check recorded. The lead (team-lead) records one with `review`, or the person with `/board review 4`.",
		);
	});
});
