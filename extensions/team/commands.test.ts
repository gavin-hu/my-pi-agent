/**
 * `/team` — the round in the terminal.
 *
 * The command reads the same rollup the Team tab draws, so the cases are about what a
 * line says and how many of them a notify may carry: an empty board, a round longer
 * than the cap, and a roster that is there and one that is not.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { CARD_VERSION, type Card } from "../../lib/board/card.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { MAX_ROUND_LINES, registerCommands, roundText, TEAM_COMMAND } from "./commands.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

/** A card built the way the store holds it. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id,
		title: `feature ${id}`,
		status: "todo",
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

/** A bus record. */
function mate(label: string, lastSeen: number): RosterSession {
	return { id: `s-${label}`, label, mode: "tui", lastSeen, mail: 0 };
}

describe("roundText", () => {
	test("an empty board is one sentence, not a headline of zeroes", () => {
		expect(roundText([], NOW)).toBe("team: nothing to report — the board is empty");
	});

	test("prints the rollup, then who is live and who has gone quiet", () => {
		const cards = [
			card("1"),
			card("2", { status: "doing", owner: { label: "billing-core" } }),
			card("3", {
				status: "blocked",
				owner: { label: "billing-core" },
				notes: [{ by: "x", at: NOW, text: "gateway" }],
			}),
		];
		const roster = [mate("billing-lead", NOW), mate("ops-helper", NOW - 20 * 60_000)];
		expect(roundText(cards, NOW, roster).split("\n")).toEqual([
			"1 owner · 3 features · 1 unassigned · 1 unplanned · 1 blocked · 0 idle · 0 done",
			"billing-core (2): #2 doing unplanned, #3 blocked",
			"unassigned (1): #1 todo",
			"unplanned (1): #2 doing unplanned",
			"blocked (1): #3 blocked — gateway",
			"live: billing-lead · quiet: ops-helper",
		]);
	});

	test("says nothing about who is here when the bus has recorded nobody", () => {
		expect(roundText([card("1")], NOW)).not.toContain("live:");
		expect(roundText([card("1")], NOW, [])).not.toContain("live:");
	});

	test("caps a long round and says how many lines it left out", () => {
		const cards = Array.from({ length: 20 }, (_, index) =>
			card(String(index + 1), { status: "doing", owner: { label: `owner-${index}` } }),
		);
		const lines = roundText(cards, NOW).split("\n");
		expect(lines).toHaveLength(MAX_ROUND_LINES + 1);
		expect(lines.at(-1)).toMatch(/^… \d+ lines more$/);
	});
});

describe("the command", () => {
	test("is registered under its own name, and prints the board it reads", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		expect(command.description).toContain("round");
		// An empty board through the real store, so the command's three reads (cards, bus,
		// clock) are the shipped ones.
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("", ctx);
		expect(notifications.at(-1)).toBe("team: nothing to report — the board is empty");
	});
});
