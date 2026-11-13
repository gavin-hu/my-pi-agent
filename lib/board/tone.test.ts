/**
 * The tone table: what colour a lane, a reason, and a Team decision row wear.
 *
 * What is pinned here is the shape that keeps the two surfaces honest — one tone per kind,
 * the decision order being the queue's rank, and every tone being a property the page's kit
 * already defines, so no surface has to invent a colour of its own.
 */

import { describe, expect, test } from "bun:test";
import { LANES, LANE_RULES } from "./lanes.ts";
import { REASON_KINDS } from "./reason.ts";
import {
	BOARD_TONES,
	GATE_WORD,
	GATES,
	DECISION_BAND,
	DECISION_BAND_JS,
	DECISION_BAND_LABEL,
	DECISION_BANDS,
	DECISION_KINDS,
	DECISION_LABEL,
	DECISION_LABEL_JS,
	DECISION_RANK_JS,
	DECISION_TONE,
	DECISION_TONE_JS,
	REASON_TONE,
	REASON_TONE_JS,
} from "./tone.ts";

describe("the tone table", () => {
	test("answers for every reason kind the rule can report, and nothing else", () => {
		expect(Object.keys(REASON_TONE).sort()).toEqual([...REASON_KINDS].sort());
		for (const kind of REASON_KINDS) expect(BOARD_TONES).toContain(REASON_TONE[kind]);
	});

	test("answers for every decision kind, and only those", () => {
		expect(Object.keys(DECISION_TONE).sort()).toEqual([...DECISION_KINDS].sort());
	});

	test("ranks a gone owner above a card merely sitting still, and colours it as the loss it is", () => {
		// The defect this table exists for: `gone` was ranked second and drawn quieter than
		// `unwritten`, because the rank and the colour were two lists in two files.
		expect(DECISION_KINDS.indexOf("gone")).toBeLessThan(DECISION_KINDS.indexOf("unwritten"));
		expect(DECISION_TONE.gone).toBe("danger");
		expect(DECISION_TONE.unwritten).toBe("warn");
	});

	test("gives a lane its own role, and never the page's accent for all of them", () => {
		const roles = LANES.map((lane) => LANE_RULES[lane].role);
		expect(new Set(roles).size).toBeGreaterThan(1);
		for (const role of roles) expect(BOARD_TONES).toContain(role);
	});

	test("splices the same tables into the browser, rather than a second copy", () => {
		// The page is a string: its order and its tones travel as source, and what travels is
		// the tuple itself.
		expect(JSON.parse(DECISION_RANK_JS)).toEqual([...DECISION_KINDS]);
		expect(JSON.parse(DECISION_TONE_JS)).toEqual(DECISION_TONE);
		expect(JSON.parse(DECISION_LABEL_JS)).toEqual(DECISION_LABEL);
		expect(JSON.parse(DECISION_BAND_JS)).toEqual({
			order: [...DECISION_BANDS],
			of: DECISION_BAND,
			label: DECISION_BAND_LABEL,
		});
		expect(JSON.parse(REASON_TONE_JS)).toEqual(REASON_TONE);
	});

	test("wears the queue's own words for the three gates, so one state is spelled once", () => {
		// The route gates are the queue's words, not a second table: a card waiting for a signature
		// reads `needs approval` in the pane and in a transcript row.
		expect(Object.keys(GATE_WORD).sort()).toEqual([...GATES].sort());
		expect(GATE_WORD.contract).toBe(DECISION_LABEL.unplanned);
		expect(GATE_WORD.approval).toBe(DECISION_LABEL.approval);
		expect(GATE_WORD.review).toBe(DECISION_LABEL.review);
		for (const gate of GATES) expect(GATE_WORD[gate].length, gate).toBeGreaterThan(0);
		// Each gate is a reason kind too, which is what makes the row's tone a lookup rather than a
		// second table: `factsOf` paints `REASON_TONE[gate]`.
		for (const gate of GATES) expect(REASON_TONE[gate], gate).toBe("warn");
	});

	test("files every kind under a band, and names every band it files one under", () => {
		// Exhaustive both ways: a kind with no band would draw under the last band it was
		// written beside, and a band no kind files under is a heading over nothing.
		expect(Object.keys(DECISION_BAND).sort()).toEqual([...DECISION_KINDS].sort());
		expect([...new Set(Object.values(DECISION_BAND))].sort()).toEqual([...DECISION_BANDS].sort());
		for (const band of DECISION_BANDS) expect(DECISION_BAND_LABEL[band].length, band).toBeGreaterThan(0);
	});

	test("puts the lead's own gates first, then what is nobody's, then what an owner owes", () => {
		// The order is the redesign's whole point: a lead opens the pane for the two things only
		// it can do, and the backlog pool must not outrank them.
		expect(DECISION_BANDS).toEqual(["signature", "claim", "stalled"]);
		expect(DECISION_BAND.approval).toBe("signature");
		expect(DECISION_BAND.review).toBe("signature");
		expect(DECISION_BAND.unassigned).toBe("claim");
		expect(DECISION_BAND.gone).toBe("claim");
		expect(DECISION_BAND.unwritten).toBe("stalled");
		// A blocked card is not the lead's own work to sign, and it is not nobody's: its
		// blocker is a decision somebody already owes.
		expect(DECISION_BAND.blocked).toBe("stalled");
	});

	test("keeps a merely-true reason quiet, so a card is not shouted at", () => {
		for (const kind of ["waiting", "offered", "executing", "done", "note"] as const) {
			expect(REASON_TONE[kind], kind).toBe("muted");
		}
	});

	test("marks a reason a person must act on as warn, and a refusal as danger", () => {
		expect(REASON_TONE.contract).toBe("warn");
		expect(REASON_TONE.approval).toBe("warn");
		expect(REASON_TONE.review).toBe("warn");
		expect(REASON_TONE.blocked).toBe("danger");
	});

	test("gives every kind a pill of its own, and no kind a label it does not have", () => {
		// One entry per kind, both ways: a kind with no label draws an empty pill, and a label
		// for a kind the table does not rank is a word nothing can wear.
		expect(Object.keys(DECISION_LABEL).sort()).toEqual([...DECISION_KINDS].sort());
		for (const kind of DECISION_KINDS) expect(DECISION_LABEL[kind].length, kind).toBeGreaterThan(0);
	});
});
