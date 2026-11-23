/**
 * The seat's per-turn line: what it owes, who is listening, and the hatch.
 *
 * The cases are the budget and the clauses: the hatch is on every turn, a board
 * with nothing to sign says so instead of an empty list, and a busy round clips a
 * clause rather than cutting the line.
 */

import { describe, expect, test } from "bun:test";
import { buildLeadContext, LEAD_CONTEXT_MARKER, MAX_LEAD_CHARS, MAX_LEAD_LINES, type LeadFacts } from "./context.ts";

const EMPTY: LeadFacts = { approve: [], review: [], unclaimed: [], peers: [] };

describe("buildLeadContext", () => {
	test("opens with the marker and always names the hatch", () => {
		const lines = buildLeadContext(EMPTY).split("\n");
		expect(lines[0]).toStartWith(LEAD_CONTEXT_MARKER);
		expect(lines.at(-1)).toContain("/board exit");
		expect(lines.length).toBeLessThanOrEqual(MAX_LEAD_LINES);
	});

	test("says nothing to sign and no peers live rather than naming empty lists", () => {
		const text = buildLeadContext(EMPTY);
		expect(text).toContain("Yours: nothing to sign.");
		expect(text).toContain("Peers: no peers live.");
	});

	test("folds the unclaimed cards into the seat's own clause", () => {
		const text = buildLeadContext({ approve: ["#12"], review: ["#9"], unclaimed: ["#15", "#18"], peers: ["tom"] });
		expect(text).toContain("Yours: approve #12 · review #9 · unclaimed #15, #18.");
		expect(text).toContain("Peers: tom.");
		expect(text.split("\n")).toHaveLength(4);
	});

	test("clips a busy round inside the ceiling instead of cutting the hatch off", () => {
		const many = Array.from({ length: 40 }, (_, index) => `#${100 + index}`);
		const text = buildLeadContext({ approve: many, review: many, unclaimed: many, peers: many });
		expect(text.length).toBeLessThanOrEqual(MAX_LEAD_CHARS);
		expect(text.split("\n")).toHaveLength(4);
		// The lists clip, and the line that says how to leave is still the last one.
		expect(text).toContain("…");
		expect(text.split("\n").at(-1)).toContain("/board exit");
	});
});
