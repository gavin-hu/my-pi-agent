/**
 * The one reason rule: one sentence per card, for the page's faces, the lead's queue, and
 * the transcript.
 *
 * The body is spliced into the browser bundle as source, so these cases also hold it to
 * that: self-contained, no imports, and answering from the card alone plus a formatter for
 * relative times.
 */

import { describe, expect, test } from "bun:test";
import { type Card } from "./card.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { reasonFor, REASON_FOR_JS, REASON_KINDS, REASON_LABEL, REASON_LABEL_JS } from "./reason.ts";

const NOW = 1_000_000;
/** The clock a caller supplies: the page passes its own, the transcript the snapshot's. */
const ago = (at: number): string => `${Math.round((NOW - at) / 60_000)}m`;

function card(overrides: Partial<Card> = {}): Card {
	return cardFixture("4", { title: "feature", createdAt: NOW, updatedAt: NOW, ...overrides });
}

const COMPLETE = { goal: "g", acceptance: "a", scopeOut: "s" };
const owner = { label: "billing-core" };

describe("reasonFor", () => {
	test("a pool card says its offer's age, or its last note, or nothing", () => {
		// The age rides as a stamp too: `at` is the moment, and `wording` is the same sentence
		// with the age left as a hole, which is what the page's ticker refills.
		expect(reasonFor(card({ offeredAt: NOW - 120_000 }), ago)).toEqual({
			kind: "offered",
			at: NOW - 120_000,
			wording: "offered {age} — nobody took it",
			text: "offered 2m ago — nobody took it",
		});
		// A card offered this second says "just now", never "now ago".
		expect(reasonFor(card({ offeredAt: NOW }), () => "now")).toEqual({
			kind: "offered",
			at: NOW,
			wording: "offered {age} — nobody took it",
			text: "offered just now — nobody took it",
		});
		expect(reasonFor(card({ notes: [{ by: "x", at: NOW, text: "start here" }] }), ago)).toEqual({
			kind: "note",
			text: "start here",
		});
		expect(reasonFor(card(), ago)).toBeUndefined();
	});

	test("a blocked card says what it waits on, and never invents one", () => {
		expect(
			reasonFor(card({ lane: "blocked", owner, blocked: { kind: "decision", note: "legal signs" } }), ago),
		).toEqual({
			kind: "blocked",
			text: "legal signs",
		});
		expect(reasonFor(card({ lane: "blocked", owner }), ago)?.text).toBe("blocked, with nothing recorded");
		// A kind with no sentence says where the card goes back to; the last note does not
		// override a block that was recorded after it.
		expect(reasonFor(card({ lane: "blocked", owner, blocked: { kind: "dependency" } }), ago)?.text).toBe(
			"blocked on a dependency",
		);
		expect(
			reasonFor(
				card({ lane: "blocked", owner, blocked: { kind: "decision" }, notes: [{ by: "x", at: 1, text: "old" }] }),
				ago,
			)?.text,
		).toBe("blocked on a decision");
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
			reasonFor(
				card({ lane: "plan", owner, planPath: "p.md", contract: { ...COMPLETE, approved: { by: "lead", at: NOW } } }),
				ago,
			),
		).toEqual({
			kind: "approval",
			text: "contract approved by lead",
		});
		// A card planned before the artifact was required: `execute` refuses it, so the line
		// names the missing plan instead of the signature.
		expect(
			reasonFor(card({ lane: "plan", owner, contract: { ...COMPLETE, approved: { by: "lead", at: NOW } } }), ago),
		).toEqual({
			kind: "contract",
			text: "contract approved — no plan recorded",
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

	test("a finished card says who closed it, and whether the gate was asked", () => {
		expect(reasonFor(card({ lane: "done", owner, review: { by: "lead", at: NOW } }), ago)).toEqual({
			kind: "done",
			text: "✓ done by billing-core",
		});
		// A close the gate was not asked for says so: pinned to the sign rather than to the lane,
		// because every finished card is in the lane and only this one was closed by instruction.
		expect(
			reasonFor(
				card({ lane: "done", owner, review: { by: "you", at: NOW, byInstruction: "closed on my instruction" } }),
				ago,
			),
		).toEqual({ kind: "done", text: "✓ done by billing-core · closed by instruction" });
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
		const blocked = card({ lane: "blocked", owner, blocked: { kind: "decision", note: "legal signs" } });
		expect(browser(blocked, ago)).toEqual(reasonFor(blocked, ago));
		for (const kind of REASON_KINDS) expect(typeof kind).toBe("string");
	});
});

describe("a plan that is gone", () => {
	test("outranks the spot-check in execute: a card that cannot land is not a card to sign", () => {
		const executing = card({ lane: "execute", owner, planPath: "/plans/x.md" });
		expect(reasonFor({ ...executing, planGone: true }, ago)).toEqual({
			kind: "contract",
			text: "its plan is gone — move it back to plan, then record it again",
		});
		// The same card with its plan in the store keeps the sentence it had, signed or not.
		expect(reasonFor(executing, ago)).toEqual({ kind: "executing", text: "executing — no spot-check yet" });
		const spotted = { ...executing, review: { by: "lead", at: NOW } };
		expect(reasonFor(spotted, ago)).toEqual({ kind: "review", text: "spot-checked by lead" });
		expect(reasonFor({ ...spotted, planGone: true }, ago)?.kind).toBe("contract");
	});

	test("is read in plan after the approval, because the next move is the one that refuses", () => {
		const approved = card({
			lane: "plan",
			owner,
			planPath: "/plans/x.md",
			contract: { ...COMPLETE, approved: { by: "lead", at: NOW } },
		});
		expect(reasonFor(approved, ago)).toEqual({ kind: "approval", text: "contract approved by lead" });
		expect(reasonFor({ ...approved, planGone: true }, ago)).toEqual({
			kind: "contract",
			text: "contract approved — its plan is gone",
		});
		// A card with no contract yet still asks for the contract: that is its next question, and the
		// plan is not asked about until there is a signature saying it was read.
		const empty = card({ lane: "plan", owner, planPath: "/plans/x.md" });
		expect(reasonFor({ ...empty, planGone: true }, ago)?.text).toContain("no contract yet");
	});

	test("labels every kind it can report, in one word a pill can hold", () => {
		expect(Object.keys(REASON_LABEL).sort()).toEqual([...REASON_KINDS].sort());
		// A pill is a shape, not a sentence: a label with a clause in it is the row's why line.
		for (const kind of REASON_KINDS) {
			expect(REASON_LABEL[kind].length, kind).toBeGreaterThan(0);
			expect(REASON_LABEL[kind], kind).not.toContain("—");
		}
		expect(JSON.parse(REASON_LABEL_JS)).toEqual(REASON_LABEL);
	});
});
