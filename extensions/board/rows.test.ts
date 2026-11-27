/**
 * The card row's geometry: what a row keeps when the terminal is narrower than its two cells.
 *
 * A card row carries an identity — its number and title — and a suffix of facts. The tone of both
 * is `result.test.ts`'s subject; this file is the width they are drawn at, because a row that fits
 * its width can still stop saying which card it is, and only an exact row shows the difference.
 */

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { type Card } from "../../lib/workflow/card.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import type { RoundSummary } from "../../lib/workflow/round.ts";
import { resultInput } from "./result.ts";
import { boardRowLineFor } from "./rows.ts";

const ME: Actor = { id: "s-me", label: "billing-core" };

/** One card, as a file would carry it: claimed, because the row shows its owner. */
function card(overrides: Partial<Card> = {}): Card {
	return cardFixture("4", {
		lane: "plan",
		priority: "normal",
		owner: { label: "api-core", id: "s-peer" },
		log: [],
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides,
	});
}

/**
 * A row's lines as the terminal shows them, however many lines it took: a folded row is a list,
 * and `toContain` on a list checks a member rather than a substring. Stripped because a cut
 * re-asserts the terminal's own reset after the clipped cell.
 */
function rowLines(drawn: string | readonly string[]): string[] {
	const lines = typeof drawn === "string" ? [drawn] : [...drawn];
	return lines.map((line) => stripTerminalSequences(line));
}

/**
 * A card whose title outgrows the head floor, so its row has a budget to lose: the head is 41
 * columns, the facts 29, and the floor 24 — which is why 54 is the last one-row width.
 */
function longCard(overrides: Partial<Card> = {}): Card {
	return card({
		lane: "plan",
		planPath: "plans/4.md",
		title: "Retry branches merge cleanly into main",
		...overrides,
	});
}

/** Its facts as one cell: the owner, the lane, and the contract a plan file with no signature owes. */
const FACTS = "api-core · plan · no contract";
const LONG_HEAD = "#4 Retry branches merge cleanly into main";

describe("a card row at a narrow width", () => {
	test("is one row, byte for byte, while the head keeps its floor", () => {
		// The floor is 24 columns, and 29 columns of facts plus the gap leave exactly that at 54:
		// the row is the one `splitRow` has always drawn, with the title clipped to its budget.
		const drawn = boardRowLineFor()(longCard(), 54, fakeTheme);
		expect(typeof drawn).toBe("string");
		expect(rowLines(drawn)).toEqual([`#4 Retry branches merge… ${FACTS}`]);
	});

	test("folds one column below the floor, keeping the number and the whole title", () => {
		const lines = rowLines(boardRowLineFor()(longCard(), 53, fakeTheme));
		expect(lines).toEqual([LONG_HEAD, `  ${FACTS}`]);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(53);
	});

	test("draws a wide row exactly as it drew before the fold existed", () => {
		// The pair to the fold above: at 80 the row pads and clips as it always has, so a change
		// that folded early — or padded differently — fails here instead of passing on a contains.
		expect(rowLines(boardRowLineFor()(longCard(), 80, fakeTheme))).toEqual([
			"#4 Retry branches merge cleanly into main          api-core · plan · no contract",
		]);
	});

	test("spends the continuation indent only when it costs no column", () => {
		// 29 columns of facts in a 30-column row: a two-column indent would eat their last
		// character, so they keep the margin and stay whole, the rule `fitCells` uses for a separator.
		const lines = rowLines(boardRowLineFor()(longCard(), 30, fakeTheme));
		expect(lines).toEqual(["#4 Retry branches merge clean…", FACTS]);
	});

	test("names the card in the section that already says what it owes", () => {
		const due = longCard({ id: "7" });
		const round: RoundSummary = {
			owners: [],
			unassigned: [],
			shelved: [],
			unplanned: [],
			unapproved: [],
			unreviewed: [due],
			blocked: [],
			untold: [],
			unwritten: [],
			done: [],
			archivable: [],
		};
		const input = resultInput({ action: "list", me: ME, round, cards: [] });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		const section = input.sections.find((entry) => entry.label === "Awaiting review");
		expect(section, "the rollup draws the queue it was asked for").toBeDefined();
		if (!section) return;
		// Wide, the section row is unchanged; narrow, it is where the defect read as facts alone.
		expect(rowLines(section.rowLine(due, 80, fakeTheme))).toEqual([
			"#7 Retry branches merge cleanly into main          api-core · plan · no contract",
		]);
		const narrow = rowLines(section.rowLine(due, 38, fakeTheme));
		expect(narrow[0]).toContain("#7");
		expect(narrow[0]).toContain("Retry");
		for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(38);
	});
});
