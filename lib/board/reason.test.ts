/**
 * The one reason rule: one sentence per card, for the page's faces, the lead's queue, and
 * the transcript.
 *
 * The body is spliced into the browser bundle as source, so these cases also hold it to
 * that: self-contained, no imports, and answering from the card alone plus a formatter for
 * relative times.
 */

import { describe, expect, test } from "bun:test";
import { CARD_VERSION, type Card } from "./card.ts";
import { reasonFor, REASON_FOR_JS, REASON_KINDS } from "./reason.ts";

const NOW = 1_000_000;
/** The clock a caller supplies: the page passes its own, the transcript the snapshot's. */
const ago = (at: number): string => `${Math.round((NOW - at) / 60_000)}m`;

function card(overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id: "4",
		title: "feature",
		lane: "backlog",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: NOW,
		updatedAt: NOW,
		by: "billing-lead",
		...overrides,
	};
}

const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s" };
const owner = { label: "billing-core" };

describe("reasonFor", () => {
	test("a pool card says its offer's age, or its last note, or nothing", () => {
		expect(reasonFor(card({ offeredAt: NOW - 120_000 }), ago)).toEqual({
			kind: "offered",
			text: "offered 2m ago — nobody took it",
		});
		expect(reasonFor(card({ notes: [{ by: "x", at: NOW, text: "start here" }] }), ago)).toEqual({
			kind: "note",
			text: "start here",
		});
		expect(reasonFor(card(), ago)).toBeUndefined();
	});

	test("a blocked card says what it waits on, and never invents one", () => {
		expect(reasonFor(card({ lane: "blocked", owner, blockedBy: "legal signs" }), ago)).toEqual({
			kind: "blocked",
			text: "legal signs",
		});
		expect(reasonFor(card({ lane: "blocked", owner }), ago)?.text).toBe("blocked, with nothing recorded");
	});

	test("a plan card names the missing contract line, then the approval it needs", () => {
		expect(
			reasonFor(card({ lane: "plan", owner, contract: { goal: "g", acceptance: "", scopeOut: "" } }), ago),
		).toEqual({
			kind: "contract",
			text: "no contract yet — missing acceptance, scopeOut",
		});
		expect(reasonFor(card({ lane: "plan", owner, contract: COMPLETE }), ago)).toEqual({
			kind: "approval",
			text: "contract ready — needs approval",
		});
		expect(
			reasonFor(card({ lane: "plan", owner, contract: { ...COMPLETE, approved: { by: "lead", at: NOW } } }), ago),
		).toEqual({
			kind: "approval",
			text: "contract approved by lead",
		});
	});

	test("an executing card says whether anybody has spot-checked it", () => {
		expect(reasonFor(card({ lane: "execute", owner }), ago)).toEqual({
			kind: "contract",
			text: "no plan recorded",
		});
		expect(reasonFor(card({ lane: "execute", owner, planPath: "p.md" }), ago)?.text).toBe(
			"executing — no spot-check yet",
		);
		expect(reasonFor(card({ lane: "execute", owner, planPath: "p.md", review: { by: "lead", at: NOW } }), ago)).toEqual(
			{
				kind: "review",
				text: "spot-checked by lead",
			},
		);
	});

	test("a finished card says who closed it and with what", () => {
		expect(
			reasonFor(
				card({ lane: "done", owner, review: { by: "lead", at: NOW }, landed: { commit: "4af1b4a", at: NOW } }),
				ago,
			),
		).toEqual({ kind: "done", text: "✓ done by billing-core · landed 4af1b4a" });
	});
});

describe("REASON_FOR_JS", () => {
	test("is the same body, safe to splice into the page's bundle", () => {
		expect(REASON_FOR_JS).toBe(String(reasonFor));
		expect(REASON_FOR_JS).not.toContain("`");
		expect(REASON_FOR_JS).not.toContain("${");
	});

	test("answers what the module answers, with no imports to reach for", () => {
		const browser = new Function(`return (${REASON_FOR_JS});`)() as (
			card: Card,
			ago: (at: number) => string,
		) => { kind: string; text: string } | undefined;
		const blocked = card({ lane: "blocked", owner, blockedBy: "legal signs" });
		expect(browser(blocked, ago)).toEqual(reasonFor(blocked, ago));
		for (const kind of REASON_KINDS) expect(typeof kind).toBe("string");
	});
});
