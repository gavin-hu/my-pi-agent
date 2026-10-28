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
	DECISION_KINDS,
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
		// `idle`, because the rank and the colour were two lists in two files.
		expect(DECISION_KINDS.indexOf("gone")).toBeLessThan(DECISION_KINDS.indexOf("idle"));
		expect(DECISION_TONE.gone).toBe("danger");
		expect(DECISION_TONE.idle).toBe("warn");
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
		expect(JSON.parse(REASON_TONE_JS)).toEqual(REASON_TONE);
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
});
