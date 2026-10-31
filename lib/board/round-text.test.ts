/**
 * The rollup as text: the headline a lead reads first, then one line per group.
 *
 * These sentences are shown twice — in the `board` tool's result and in `team`'s
 * `/team` — so the cases here are about the facts they carry and the order they carry
 * them in, not about spacing.
 */

import { describe, expect, test } from "bun:test";
import { buildRound } from "./round.ts";
import { minuteOldCards } from "../../test/helpers/fixtures/board.ts";
import {
	formatRound,
	HISTORY_LINE_JS,
	HISTORY_OWNER_JS,
	historyLine,
	isHistoryOwner,
	PLURAL_JS,
	plural,
	type RosterLabel,
} from "./round-text.ts";

const NOW = 1_760_000_000_000;
const IDLE_MS = 30 * 60 * 1_000;

// A card a minute old, as the store would have written it.
const card = minuteOldCards(NOW);

describe("formatRound", () => {
	test("counts what a lead decides on, then names each group's cards", () => {
		const cards = [
			card("1"),
			card("2", { lane: "execute", owner: { label: "billing-core" } }),
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
			"2 owners · 4 features · 1 unassigned · 0 unplanned · 0 awaiting approval · 1 awaiting review · 1 blocked · 0 idle · 1 done",
			"billing-core (2): #2 execute unplanned, #3 blocked",
			"billing-other (0 live, 1 done)",
			"unassigned (1): #1 backlog",
			"unreviewed (1): #2 execute unplanned",
			"blocked (1): #3 blocked — gateway",
			"done (1): #4 done",
		]);
	});

	test("an owner who finished everything keeps its line and its count", () => {
		const cards = [card("4", { lane: "done", owner: { label: "billing-other" } })];
		const lines = formatRound(cards, buildRound(cards, NOW)).split("\n");
		expect(lines).toContain("billing-other (0 live, 1 done)");
	});

	test("names a contract that is still missing a line, which is the one a lead looks at", () => {
		const cards = [card("2", { lane: "plan", owner: { label: "billing-core" } })];
		expect(formatRound(cards, buildRound(cards, NOW))).toContain("unplanned (1): #2 plan");
	});

	test("names a complete contract nobody has read, as its own queue", () => {
		const cards = [
			card("2", {
				lane: "plan",
				owner: { label: "billing-core" },
				planPath: "plans/demo.md",
				contract: { goal: "g", acceptance: "a", scopeOut: "s" },
			}),
		];
		expect(formatRound(cards, buildRound(cards, NOW))).toContain("unapproved (1): #2 plan");
	});

	test("an untouched card in flight is idle, not unplanned-by-accident", () => {
		const stale = card("2", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });
		const aged = { ...stale, updatedAt: NOW - IDLE_MS - 1 };
		expect(formatRound([aged], buildRound([aged], NOW))).toContain("idle (1): #2 execute planned");
	});

	test("names an executing card nobody has spot-checked, before the card is idle", () => {
		// The lead's half of the flow is two signatures, so the text states both queues: this one
		// is owed from the minute the card enters `execute`.
		const fresh = card("2", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });
		const lines = formatRound([fresh], buildRound([fresh], NOW)).split("\n");
		expect(lines).toContain("unreviewed (1): #2 execute planned");
		expect(lines[0]).toContain("1 awaiting review");
		expect(lines).not.toContain("idle (1): #2 execute planned");
	});

	test("an empty board is a headline of zeroes, not a refusal", () => {
		expect(formatRound([], buildRound([], NOW))).toBe(
			"0 owners · 0 features · 0 unassigned · 0 unplanned · 0 awaiting approval · 0 awaiting review · 0 blocked · 0 idle · 0 done",
		);
	});
});

describe("the owners who are only history", () => {
	/** A bus that has recorded `labels`. */
	const bus = (...labels: string[]): RosterLabel[] => labels.map((label) => ({ label }));
	const finished = [
		card("1", { lane: "done", owner: { label: "billing-old" } }),
		card("2", { lane: "done", owner: { label: "billing-older" } }),
		card("3", { lane: "done", owner: { label: "billing-older" } }),
	];
	const working = card("4", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });

	test("are one line, in the Team tab's own words, where they were a line each", () => {
		const cards = [...finished, working];
		const lines = formatRound(cards, buildRound(cards, NOW), bus("billing-core")).split("\n");
		expect(lines).toContain("2 owners with no record · 3 done");
		expect(lines.some((line) => line.startsWith("billing-old"))).toBe(false);
		// The fold is a line of the owner block, so the queue still follows it.
		expect(lines.indexOf("2 owners with no record · 3 done")).toBeLessThan(
			lines.indexOf("done (3): #1 done, #2 done, #3 done"),
		);
	});

	test("are named one at a time when the bus has no record of nobody", () => {
		// No roster is "we cannot say", not "there is no record": a board with the bus unloaded
		// prints what it printed before the fold existed.
		const cards = [...finished, working];
		const lines = formatRound(cards, buildRound(cards, NOW)).split("\n");
		expect(lines.some((line) => line.startsWith("billing-old (0 live, 1 done)"))).toBe(true);
		expect(lines.some((line) => line.startsWith("2 owners with no record"))).toBe(false);
	});

	test("keep a row when the bus knows them, even holding nothing", () => {
		const lines = formatRound(finished, buildRound(finished, NOW), bus("billing-old", "billing-older")).split("\n");
		expect(lines).toContain("billing-old (0 live, 1 done)");
		expect(lines).toContain("billing-older (0 live, 2 done)");
		expect(lines.some((line) => line.includes("with no record"))).toBe(false);
	});

	test("keep a row when they hold a card, because the queue is reporting its work", () => {
		// An owner the bus has no record of and that holds nothing is history; one holding a card
		// is the row a lead acts on, and folding it would hide a free card behind a count.
		const lines = formatRound([working], buildRound([working], NOW), bus()).split("\n");
		expect(lines).toContain("billing-core (1): #4 execute planned");
	});

	test("read as one owner when there is only one", () => {
		const one = [card("1", { lane: "done", owner: { label: "billing-old" } })];
		expect(formatRound(one, buildRound(one, NOW), bus())).toContain("1 owner with no record · 1 done");
	});

	test("are counted once, whatever they finished", () => {
		expect(isHistoryOwner("billing-old", 0, bus())).toBe(true);
		expect(isHistoryOwner("Billing-Old", 0, bus("billing-old"))).toBe(false);
		expect(isHistoryOwner("billing-core", 1, bus())).toBe(false);
		expect(isHistoryOwner("billing-old", 0, undefined)).toBe(false);
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

describe("the history line the browser receives", () => {
	test("is the same body, safe to splice into a script", () => {
		// The page's history row and this line are one sentence, so the count of owners and the
		// work they finished cannot read two ways.
		expect(HISTORY_LINE_JS).toBe(String(historyLine));
		expect(HISTORY_OWNER_JS).toBe(String(isHistoryOwner));
		for (const source of [HISTORY_LINE_JS, HISTORY_OWNER_JS]) {
			expect(source).not.toContain("`");
			expect(source).not.toContain("${");
		}
	});

	test("answers what the module answers, with `plural` in the fragment's scope", () => {
		// The body calls `plural` rather than carrying a second wording for `1 owner`, the same
		// way the fragment it is spliced into holds one `plural` for the whole page.
		const browserLine = new Function("plural", `return (${HISTORY_LINE_JS});`)(plural) as (
			owners: number,
			done: number,
		) => string;
		const browserPlural = new Function(`return (${PLURAL_JS});`)() as (count: number, noun: string) => string;
		expect(browserLine(1, 1)).toBe(historyLine(1, 1));
		expect(browserLine(2, 3)).toBe("2 owners with no record · 3 done");
		expect(historyLine(1, 1)).toContain(browserPlural(1, "owner"));
		const browserHistory = new Function(`return (${HISTORY_OWNER_JS});`)() as (
			label: string,
			held: number,
			roster: readonly RosterLabel[] | undefined,
		) => boolean;
		for (const [label, held, roster] of [
			["billing-old", 0, []],
			["billing-core", 0, [{ label: "billing-core" }]],
			["billing-old", 2, []],
			["billing-old", 0, undefined],
		] as const) {
			expect(browserHistory(label, held, roster)).toBe(isHistoryOwner(label, held, roster));
		}
	});
});
