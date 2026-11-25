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
		// `unwritten`, because the rank and the colour were two lists in two files. The gap is now
		// two steps of tone — a loss, then advice — which is the ranking a flat list reads.
		expect(DECISION_KINDS.indexOf("gone")).toBeLessThan(DECISION_KINDS.indexOf("unwritten"));
		expect(DECISION_TONE.gone).toBe("danger");
		expect(DECISION_TONE.unwritten).toBe("dim");
		// `dim` is quieter than the gates, which is the whole of what the ranking now says.
		expect(BOARD_TONES.indexOf("dim")).toBeLessThan(BOARD_TONES.indexOf("warn"));
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

	test("ranks the queue's four kinds by precedence, and names each one", () => {
		// The page's queue files four kinds; their rank is what orders a flat list, since the bands
		// that used to order it are gone. A loss outranks a gate, and a gate outranks advice.
		const filed = ["gone", "untold", "approval", "unwritten"] as const;
		const rank = (kind: string) => DECISION_KINDS.indexOf(kind as (typeof DECISION_KINDS)[number]);
		expect(filed).toEqual([...filed].sort((a, b) => rank(a) - rank(b)));
		expect(DECISION_TONE.gone).toBe("danger");
		expect(DECISION_TONE.approval).toBe("warn");
		expect(DECISION_TONE.untold).toBe("warn");
		// Advice rather than a gate: a card nobody has written to may be chased or spot-checked.
		expect(DECISION_TONE.unwritten).toBe("dim");
		for (const kind of filed) expect(DECISION_LABEL[kind].length, kind).toBeGreaterThan(0);
	});

	test("gives the unwritten row its own word, because `quiet` is a session state here", () => {
		// One word for two facts is what a pill must not do: the roster already prints `quiet`
		// beside a holder's name, so the card's row counts writes instead.
		expect(DECISION_LABEL.unwritten).toBe("no writes");
		for (const word of Object.values(DECISION_LABEL)) expect(word).not.toBe("quiet");
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
