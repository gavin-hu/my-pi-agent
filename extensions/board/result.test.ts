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
import { type Card, CARD_VERSION } from "../../lib/board/card.ts";
import { LANE_RULES } from "../../lib/board/lanes.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { RoundSummary } from "../../lib/board/round.ts";
import { REASON_TONE } from "../../lib/board/tone.ts";
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

/** One card, as a file would carry it. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id: "4",
		title: "Billing webhook accepts orders",
		lane: "plan",
		paths: [],
		priority: "normal",
		owner: { label: PEER.label, id: PEER.id },
		rev: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		log: [],
		notes: [],
		...overrides,
	} as Card;
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

	test("gives an unplanned card the warn the page gives the same fact", () => {
		const line = boardRowLineFor()(card({ lane: "execute" }), WIDTH, coloringTheme);
		expect(REASON_TONE.contract).toBe("warn");
		expect(line).toContain(`${colour(TONE_ROLE.warn)}unplanned`);
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
});

describe("the rows a mine listing draws", () => {
	test("marks them only for the read that asked for them", () => {
		const mine = card({ owner: { label: ME.label, id: ME.id } });
		const marked = resultInput({ action: "list", me: ME, mine: true, cards: [mine] });
		const plain = resultInput({ action: "list", me: ME, cards: [mine] });
		const rowOf = (input: typeof marked): string => {
			if (input?.kind !== "list") throw new Error("a list of one card is a list");
			return input.rowLine(mine, WIDTH, coloringTheme);
		};
		expect(rowOf(marked)).toContain(`${colour("accent")}#4`);
		expect(rowOf(plain)).toContain(`${colour("label")}#4`);
	});
});

describe("the rollup's sections", () => {
	test("draws every group the round reports, in the order the text prints it", () => {
		// Every group carries one card, and the group it belongs to is the assertion: a
		// rollup group that loses its section is invisible in the text above it.
		const round: RoundSummary = {
			owners: [{ label: PEER.label, cards: [card()], done: [] }],
			unassigned: [card({ id: "1", lane: "backlog", owner: undefined })],
			unplanned: [card({ id: "2" })],
			unapproved: [card({ id: "3" })],
			blocked: [card({ id: "4", lane: "blocked", blocked: { kind: "decision" } })],
			idle: [card({ id: "5", lane: "execute" })],
			done: [card({ id: "6", lane: "done" })],
		};
		const input = resultInput({ action: "list", me: ME, round, cards: [] });
		if (input?.kind !== "sections") throw new Error("a rollup is sections");
		expect(input.sections.map((entry) => entry.label)).toEqual([
			PEER.label,
			"Unassigned",
			"Unplanned",
			"Awaiting approval",
			"Blocked",
			"Idle",
			"Done",
		]);
		// The lead's queue is the one group a reader acts on, so the card is named there.
		const approval = input.sections.find((entry) => entry.label === "Awaiting approval");
		expect(approval?.rows.map((row) => row.id)).toEqual(["3"]);
	});
});
