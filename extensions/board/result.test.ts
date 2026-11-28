/**
 * The transcript side of the board: the row grammar and the collapsed line.
 *
 * The page and the terminal read one tone table, so what is pinned here is that the terminal
 * asks it: a lane wears its own colour rather than one accent for all five, a card that owes
 * a plan wears the same warn the page gives the same fact, and a listing narrowed to this
 * session's own cards marks them.
 */

import { describe, expect, test } from "bun:test";
import { coloringTheme } from "../../test/helpers/fakes.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { type Card } from "../../lib/workflow/card.ts";
import { LANE_RULES } from "../../lib/workflow/lanes.ts";
import { GATES, GATE_WORD } from "../../lib/workflow/tone.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import type { RoundSummary } from "../../lib/workflow/round.ts";
import { REASON_TONE } from "../../lib/workflow/tone.ts";
import { collapsedLine, resultInput } from "./result.ts";
import { boardRowLineFor } from "./rows.ts";
import { TUI_TOKENS, type TuiRole } from "../../lib/tui/tokens.ts";
import { TONE_ROLE } from "./tone.ts";

/** The colour the fake theme prints for a role, so a test can name the tone it expects. */
function colour(role: TuiRole): string {
	return `[${TUI_TOKENS[role]}]`;
}

const ME: Actor = { id: "s-me", label: "billing-core" };
const PEER: Actor = { id: "s-peer", label: "api-core" };

/** One card, as a file would carry it: claimed, because the row shows its owner. */
function card(overrides: Partial<Card> = {}): Card {
	return cardFixture("4", {
		lane: "plan",
		priority: "normal",
		owner: { label: PEER.label, id: PEER.id },
		log: [],
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides,
	});
}

/** The narrowest width that still shows a card's facts, so a clipped row cannot hide one. */
const WIDTH = 120;

describe("the transcript row", () => {
	test("paints a lane in its own role, not in one accent for all five", () => {
		const planning = boardRowLineFor()(card({ lane: "plan" }), WIDTH, coloringTheme);
		const blocked = boardRowLineFor()(card({ lane: "blocked" }), WIDTH, coloringTheme);
		expect(planning).toContain(`${colour(TONE_ROLE[LANE_RULES.plan.role])}plan`);
		expect(blocked).toContain(`${colour(TONE_ROLE[LANE_RULES.blocked.role])}blocked`);
		// The two lanes are two colours: the defect this replaces painted both `accent`.
		expect(LANE_RULES.plan.role).not.toBe(LANE_RULES.blocked.role);
	});

	test("gives a card that still owes its contract the warn the page gives the same fact", () => {
		// A `plan` card with a plan file and no contract owes the contract, and the row says the word
		// the Team queue's pill uses for it rather than calling the card planned.
		const line = boardRowLineFor()(card({ lane: "plan", planPath: "plans/4.md" }), WIDTH, coloringTheme);
		expect(GATE_WORD.contract).toBe("no contract");
		expect(REASON_TONE.contract).toBe("warn");
		expect(line).toContain(`${colour(TONE_ROLE.warn)}no contract`);
	});

	test("names the spot-check an executing card has not had, and says nothing when it owes none", () => {
		const owed = boardRowLineFor()(
			card({ lane: "execute", planPath: "plans/4.md", log: [{ lane: "execute", at: 2_000, by: "billing-core" }] }),
			WIDTH,
			coloringTheme,
		);
		expect(owed).toContain(`${colour(TONE_ROLE.warn)}needs review`);
		// A signed spot-check of this execution is a card that owes nothing, and a row with nothing
		// to owe says nothing: `planned` used to be printed whatever a card still had to wait for.
		const clear = boardRowLineFor()(
			card({
				lane: "execute",
				planPath: "plans/4.md",
				review: { by: "billing-lead", at: 3_000 },
				log: [{ lane: "execute", at: 2_000, by: "billing-core" }],
			}),
			WIDTH,
			coloringTheme,
		);
		// The absence is the half a reader notices, so it is asserted for every word a gate can
		// wear and for the one this replaced: a clear card's row is its owner, its lane and its age.
		for (const gate of GATES) expect(clear).not.toContain(GATE_WORD[gate]);
		expect(clear).not.toContain("planned");
	});

	test("says nothing for a signed plan card either, which is the case `planned` was printed for", () => {
		const signed = boardRowLineFor()(
			card({
				lane: "plan",
				planPath: "plans/4.md",
				contract: {
					goal: "g",
					acceptance: "a",
					scopeOut: "s",
					verify: "bun run check",
					approved: { by: "billing-lead", at: 2_000 },
				},
			}),
			WIDTH,
			coloringTheme,
		);
		for (const gate of GATES) expect(signed).not.toContain(GATE_WORD[gate]);
		expect(signed).not.toContain("planned");
	});

	test("keeps the separator between two painted words painted too", () => {
		// A bare separator falls back to the terminal's default foreground between two
		// coloured words, which reads as a gap in the row.
		const line = boardRowLineFor()(card(), WIDTH, coloringTheme);
		expect(line).toContain(`${colour(TONE_ROLE.muted)} · `);
	});

	test("marks the holder's own rows only when the read was narrowed to them", () => {
		const mine = card({ owner: { label: ME.label, id: ME.id } });
		expect(boardRowLineFor(ME)(mine, WIDTH, coloringTheme)).toContain(`${colour("accent")}#4`);
		// Everyone else's row is a row: the accent means "this is yours", not "this is a card".
		expect(boardRowLineFor(PEER)(mine, WIDTH, coloringTheme)).toContain(`${colour("label")}#4`);
	});
});

describe("the collapsed line", () => {
	test("names the lane in its own colour, which is what the page draws", () => {
		const line = collapsedLine(coloringTheme, { action: "list", me: ME, card: card({ lane: "blocked" }) });
		expect(line).toContain(`${colour(TONE_ROLE.danger)}blocked`);
	});

	test("names the archive outcome, so a no-op is not a listing count", () => {
		// The defect: `archive card:"1"` twice drew `0 cards` over a sentence that said the card
		// was already aside, because the details carried nothing the line could read.
		const moved = collapsedLine(coloringTheme, {
			action: "archive",
			me: ME,
			archive: { moved: ["4"], kept: [], held: [], failed: [] },
		});
		expect(moved).toContain(`${colour("label")}#4 archived`);
		expect(moved).toContain(ME.label);
		const already = collapsedLine(coloringTheme, {
			action: "archive",
			me: ME,
			archive: { moved: [], kept: [], held: [], failed: [], already: "4" },
		});
		expect(already).toContain(`${colour("meta")}#4 already archived`);
		for (const line of [moved, already]) expect(line).not.toContain("0 cards");
	});

	test("names what a sweep kept and what it failed on", () => {
		const line = collapsedLine(coloringTheme, {
			action: "archive",
			me: ME,
			archive: {
				moved: ["4"],
				kept: ["5"],
				held: [],
				failed: [{ card: "6", error: "#6 kept changing while it was written." }],
			},
		});
		// Three outcomes at once, each in its own tone: a move, the hold a live link is, and a refusal.
		expect(line).toContain("#4 archived");
		expect(line).toContain(`${colour("meta")}1 card kept: still waited on`);
		expect(line).toContain(`${colour("bad")}#6 not archived`);
		// The reason stays in the result's text: this line names what to read, not why.
		expect(line).not.toContain("kept changing");
	});

	test("draws an empty sweep as an answer rather than as a count", () => {
		const line = collapsedLine(coloringTheme, {
			action: "archive",
			me: ME,
			archive: { moved: [], kept: [], held: [], failed: [] },
		});
		expect(line).toContain("no finished cards to archive");
	});

	test("draws who a sign told, after the card and the actor", () => {
		const line = collapsedLine(coloringTheme, { action: "approve", me: ME, card: card(), told: "told api-core" });
		expect(line).toContain(`${colour("meta")}told api-core`);
		// The person's command prints the clause after its card; the block keeps that order, so a
		// sign reads the same way whichever door made it.
		expect(line.indexOf("told api-core")).toBeGreaterThan(line.indexOf(ME.label));
	});

	test("draws a drop's clause too, which only the text used to carry", () => {
		// The defect: the `dropped` arm returned before the clause, so a release the bus refused was
		// in the result's text and nowhere in the block a reader sees without expanding.
		const held = "paths not released (the bus refused the write)";
		const line = collapsedLine(coloringTheme, { action: "drop", me: ME, dropped: "4", held });
		expect(line).toContain(held);
		expect(line.indexOf(held)).toBeGreaterThan(line.indexOf(ME.label));
		// The ordinary drop says nothing more than it did: a release that worked has no clause.
		expect(collapsedLine(coloringTheme, { action: "drop", me: ME, dropped: "4" })).not.toContain("not released");
	});

	test("draws a sign that reached nobody, which only the text used to carry", () => {
		const told = "api-core was not told (the session bus is not loaded)";
		const line = collapsedLine(coloringTheme, { action: "review", me: ME, card: card(), told });
		expect(line).toContain(told);
	});
});

describe("the rows a mine listing draws", () => {
	test("marks them only for the read that asked for them", () => {
		const mine = card({ owner: { label: ME.label, id: ME.id } });
		const marked = resultInput({ action: "list", me: ME, mine: true, cards: [mine] });
		const plain = resultInput({ action: "list", me: ME, cards: [mine] });
		const rowOf = (input: typeof marked): string => {
			if (input?.kind !== "list") throw new Error("a list of one card is a list");
			const drawn = input.rowLine(mine, WIDTH, coloringTheme);
			return typeof drawn === "string" ? drawn : drawn.join("\n");
		};
		expect(rowOf(marked)).toContain(`${colour("accent")}#4`);
		expect(rowOf(plain)).toContain(`${colour("label")}#4`);
	});
});

describe("the line a rollup draws", () => {
	/** One card in each group a reader acts on, so every count on the line is the round's own fact. */
	const asking: RoundSummary = {
		owners: [{ label: PEER.label, cards: [], done: [] }],
		unassigned: [],
		shelved: [],
		unplanned: [],
		unapproved: [card({ id: "3" })],
		unreviewed: [card({ id: "7", lane: "execute" })],
		untold: [],
		blocked: [card({ id: "4", lane: "blocked" })],
		unwritten: [],
		done: [],
		archivable: [],
	};

	test("counts what the rollup asks a reader for, not what the board is made of", () => {
		const line = collapsedLine(coloringTheme, { action: "list", me: ME, cards: [], round: asking });
		expect(line).toContain("1 awaiting approval");
		expect(line).toContain("1 awaiting review");
		expect(line).toContain("1 blocked");
		// In the order the model's own first line prints them, so one board counts one way.
		expect(line.indexOf("awaiting approval")).toBeLessThan(line.indexOf("awaiting review"));
		expect(line.indexOf("awaiting review")).toBeLessThan(line.indexOf("1 blocked"));
		// A count of owners is what the board is made of, not what it asks: the line it used to lead
		// with is gone the moment the rollup names something to decide.
		expect(line).not.toContain("owner");
	});

	test("falls back to the board's size when the rollup asks nobody for anything", () => {
		const settled: RoundSummary = { ...asking, unapproved: [], unreviewed: [], blocked: [] };
		const line = collapsedLine(coloringTheme, { action: "list", me: ME, cards: [], round: settled });
		expect(line).toContain("1 owner");
		expect(line).not.toContain("awaiting");
	});
});

describe("a rollup under a narrowed listing", () => {
	/** A rollup holding one card, owned by the peer: the whole board's answer, which is not this session's. */
	const round: RoundSummary = {
		owners: [{ label: PEER.label, cards: [card({ id: "4" })], done: [] }],
		unassigned: [],
		shelved: [],
		unplanned: [],
		unapproved: [],
		unreviewed: [],
		blocked: [],
		untold: [],
		unwritten: [],
		done: [],
		archivable: [],
	};

	test("draws the slice first, unlabelled, and marks only its rows", () => {
		const mine = card({ id: "1", owner: { label: ME.label, id: ME.id } });
		const input = resultInput({ action: "list", me: ME, mine: true, narrowed: true, cards: [mine], round });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		// The listing came first in the text, so it comes first here, and it is a listing rather
		// than a group of one: no label above it.
		expect(input.sections[0]?.label).toBeUndefined();
		expect(input.sections[0]?.rows.map((row) => row.id)).toEqual(["1"]);
		expect(input.sections[1]?.label).toBe(`${PEER.label} · 1`);
		// The accent means "this row is yours": the slice that asked for `mine` wears it, and the
		// rollup that answers for the whole board does not, even inside the same result.
		expect(input.sections[0]?.rowLine(mine, WIDTH, coloringTheme)).toContain(`${colour("accent")}#1`);
		expect(input.sections[1]?.rowLine(card({ id: "4" }), WIDTH, coloringTheme)).toContain(`${colour("label")}#4`);
	});

	test("draws the rollup alone when nothing was narrowed", () => {
		const input = resultInput({ action: "list", me: ME, cards: [card()], round });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		// A bare `round` already draws every one of those cards in a group below, so a slice
		// above it would be the same rows twice.
		expect(input.sections.map((entry) => entry.label)).toEqual([`${PEER.label} · 1`]);
	});
});

describe("the rollup's sections", () => {
	test("names what needs a decision in ids, then draws every card once", () => {
		// The groups overlap by design — #3 is its owner's work and the lead's signature — so the
		// index says what to sign and the body says who holds what, without drawing one card twice.
		const held = (id: string, more: Partial<Card> = {}): Card =>
			card({ id, owner: { label: PEER.label, id: PEER.id }, ...more });
		const approval = held("3");
		const blocked = held("10", { lane: "blocked", blocked: { kind: "decision" } });
		const pool = card({ id: "1", lane: "backlog", owner: undefined });
		const shelf = card({
			id: "9",
			lane: "backlog",
			owner: undefined,
			shelved: { at: 1, by: "lead", note: "waiting on the release" },
		});
		const finished = card({ id: "6", lane: "done", owner: { label: "billing-other", id: "s-other" } });
		const round: RoundSummary = {
			owners: [
				{ label: PEER.label, cards: [held("4"), approval, blocked], done: [] },
				{ label: "billing-other", cards: [], done: [finished] },
			],
			unassigned: [pool],
			shelved: [shelf],
			unplanned: [],
			unapproved: [approval],
			unreviewed: [],
			untold: [],
			blocked: [blocked],
			unwritten: [],
			done: [finished],
			archivable: [finished],
		};
		const input = resultInput({ action: "list", me: ME, round, cards: [] });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		expect(input.sections.map((entry) => entry.label)).toEqual([
			"awaiting approval · #3",
			"blocked · #10",
			`${PEER.label} · 3`,
			"Unassigned · 1",
			"Shelved · 1",
			"Done · 1",
		]);
		// An index line answers what to sign and nothing else: it carries no row, which is why the
		// card below it is drawn once rather than once per group it belongs to.
		expect(input.sections[0]?.rows).toEqual([]);
		// Every body row is a different card, and the heading counts what the section holds.
		const rows = input.sections.flatMap((entry) => entry.rows).map((row) => row.id);
		expect(rows).toEqual(["4", "3", "10", "1", "9", "6"]);
		expect(new Set(rows).size).toBe(rows.length);
	});

	test("stops a long section at its rows and names the rest by id", () => {
		const held = Array.from({ length: 20 }, (_, index) => card({ id: String(index + 1) }));
		const round: RoundSummary = {
			owners: [{ label: PEER.label, cards: held, done: [] }],
			unassigned: [],
			shelved: [],
			unplanned: [],
			unapproved: [],
			unreviewed: [],
			blocked: [],
			untold: [],
			unwritten: [],
			done: [],
			archivable: [],
		};
		const input = resultInput({ action: "list", me: ME, round, cards: [] });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		expect(input.sections[0]?.label).toBe(`${PEER.label} · 20`);
		expect(input.sections[0]?.rows).toHaveLength(8);
		// The twelve it could not draw are named by id: the title is one call away, and the id is
		// the half of the row a reader acts on.
		expect(input.sections[1]?.label).toBe("… 12 more: #9 #10 #11 #12 #13 #14 #15 #16 #17 #18 #19 #20");
		expect(input.sections[1]?.rows).toEqual([]);
	});

	test("leaves out an owner whose only card is finished, which `Done` already draws", () => {
		// `buildRound` keeps that owner's group on purpose: the round's text line counts what it
		// finished, so the group is the kit's answer and the empty heading is this caller's bug.
		const finished = card({ id: "8", lane: "done", owner: { label: "billing-other", id: "s-other" } });
		const round: RoundSummary = {
			owners: [
				{ label: PEER.label, cards: [card()], done: [] },
				{ label: "billing-other", cards: [], done: [finished] },
			],
			unassigned: [],
			shelved: [],
			unplanned: [],
			unapproved: [],
			unreviewed: [],
			blocked: [],
			untold: [],
			unwritten: [],
			done: [finished],
			archivable: [finished],
		};
		const input = resultInput({ action: "list", me: ME, round, cards: [] });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		expect(input.sections.map((entry) => entry.label)).toEqual([`${PEER.label} · 1`, "Done · 1"]);
		// The finished card is not lost with the heading: it is the `Done` section's row.
		expect(input.sections[1]?.rows.map((row) => row.id)).toEqual(["8"]);
	});
});
