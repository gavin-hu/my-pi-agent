/**
 * The rollup as text: the headline a lead reads first, then one line per group.
 *
 * These sentences are shown twice — in the `board` tool's result and in `team`'s
 * `/team` — so the cases here are about the facts they carry and the order they carry
 * them in, not about spacing.
 */

import { describe, expect, test } from "bun:test";
import { CARD_VERSION, type Card } from "./card.ts";
import { buildRound } from "./round.ts";
import { formatRound, PLURAL_JS, plural } from "./round-text.ts";

const NOW = 1_760_000_000_000;
const IDLE_MS = 30 * 60 * 1_000;

/** A card built the way the store would hold it. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id,
		title: `feature ${id}`,
		lane: "todo",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		by: "billing-lead",
		...overrides,
	};
}

describe("formatRound", () => {
	test("counts what a lead decides on, then names each group's cards", () => {
		const cards = [
			card("1"),
			card("2", { lane: "doing", owner: { label: "billing-core" } }),
			card("3", {
				lane: "blocked",
				owner: { label: "billing-core" },
				notes: [{ by: "x", at: NOW, text: "gateway" }],
			}),
			card("4", { lane: "done", owner: { label: "billing-other" } }),
		];
		// The groups overlap on purpose: #2 is live for its owner and unplanned for the
		// lead, and one line each is what says both.
		expect(formatRound(cards, buildRound(cards, NOW)).split("\n")).toEqual([
			"2 owners · 4 features · 1 unassigned · 1 unplanned · 1 blocked · 0 idle · 1 done",
			"billing-core (2): #2 doing unplanned, #3 blocked",
			"billing-other (0 live, 1 done)",
			"unassigned (1): #1 todo",
			"unplanned (1): #2 doing unplanned",
			"blocked (1): #3 blocked — gateway",
			"done (1): #4 done",
		]);
	});

	test("an owner who finished everything keeps its line and its count", () => {
		const cards = [card("4", { lane: "done", owner: { label: "billing-other" } })];
		const lines = formatRound(cards, buildRound(cards, NOW)).split("\n");
		expect(lines).toContain("billing-other (0 live, 1 done)");
	});

	test("names an unfinished plan, which is the one a lead looks at", () => {
		const cards = [card("2", { lane: "doing", owner: { label: "billing-core" } })];
		expect(formatRound(cards, buildRound(cards, NOW))).toContain("#2 doing unplanned");
	});

	test("an untouched card in flight is idle, not unplanned-by-accident", () => {
		const stale = card("2", { lane: "doing", owner: { label: "billing-core" }, plan: "p.md" });
		const aged = { ...stale, updatedAt: NOW - IDLE_MS - 1 };
		expect(formatRound([aged], buildRound([aged], NOW))).toContain("idle (1): #2 doing planned");
	});

	test("an empty board is a headline of zeroes, not a refusal", () => {
		expect(formatRound([], buildRound([], NOW))).toBe(
			"0 owners · 0 features · 0 unassigned · 0 unplanned · 0 blocked · 0 idle · 0 done",
		);
	});
});

describe("PLURAL_JS", () => {
	test("is the same body, safe to splice into a script", () => {
		// The page's bundle carries this string; a backtick or an interpolation would end
		// the template it lands in, and the failure would be a blank board.
		expect(PLURAL_JS).toBe(String(plural));
		expect(PLURAL_JS).not.toContain("`");
		expect(PLURAL_JS).not.toContain("${");
	});

	test("answers what the module answers", () => {
		const browserPlural = new Function(`return (${PLURAL_JS});`)() as (count: number, noun: string) => string;
		for (const [count, noun] of [
			[0, "note"],
			[1, "card"],
			[2, "cards"],
		] as const) {
			expect(browserPlural(count, noun)).toBe(plural(count, noun));
		}
	});
});

describe("plural", () => {
	test("adds one s, and only one", () => {
		expect(plural(1, "owner")).toBe("1 owner");
		expect(plural(0, "note")).toBe("0 notes");
	});
});
