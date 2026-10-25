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
import type { JoinResult, TeamJoin } from "../../lib/session-tool.ts";
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

/** A record whose process is gone: no host runs a pid that high. */
function dead(label: string): RosterSession {
	return { ...mate(label, NOW - 60_000), pid: 999_999_999 };
}

describe("roundText", () => {
	test("an empty board is one sentence, not a headline of zeroes", () => {
		expect(roundText([], NOW)).toBe("team: nothing to report — the board is empty");
	});

	test("names a dead owner's cards, and says who is gone rather than quiet", () => {
		const cards = [
			card("1", { status: "doing", owner: { label: "billing-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("2", { status: "blocked", owner: { label: "billing-core" } }),
			card("3", { status: "done", owner: { label: "billing-core" } }),
			card("4", { status: "doing", owner: { label: "ops-helper" }, updatedAt: NOW - 2 * 60_000 }),
		];
		const roster = [mate("billing-lead", NOW), dead("billing-core"), mate("ops-helper", NOW - 20 * 60_000)];
		const lines = roundText(cards, NOW, roster).split("\n");
		// The instruction comes before the presence line: who died is the quieter fact.
		expect(lines).toContain("reclaim #1, #2 — billing-core is not running");
		expect(lines.at(-1)).toBe("live: billing-lead · quiet: ops-helper · gone: billing-core");
		// A card finished by a dead owner is history, not work to reclaim.
		const reclaim = lines.find((line) => line.startsWith("reclaim "));
		expect(reclaim).not.toContain("#3");
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

	test("names a live peer that is not listening, and only when its record says so", () => {
		const cards = [card("1")];
		const roster = [
			{ id: "s-lead", label: "billing-lead", mode: "tui", lastSeen: NOW, mail: 0 },
			{
				id: "s-core",
				label: "billing-core",
				mode: "tui",
				lastSeen: NOW,
				mail: 0,
				watching: { armed: false, wake: false },
			},
			{
				id: "s-old",
				label: "ops-helper",
				mode: "tui",
				lastSeen: NOW - 20 * 60_000,
				mail: 0,
				watching: { armed: false, wake: false },
			},
		];
		expect(roundText(cards, NOW, roster).split("\n").at(-1)).toBe(
			"live: billing-lead, billing-core · not listening: billing-core · quiet: ops-helper",
		);
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

/** A team join that records what it was asked and answers with `answer`. */
function fakeTeam(
	answer: (label?: string) => JoinResult = (label) => ({
		ok: true,
		label: label ?? "billing-lead",
		watching: { armed: true, wake: false },
	}),
) {
	const labels: Array<string | undefined> = [];
	const team: TeamJoin = {
		join: async (_ctx, label) => {
			labels.push(label);
			return answer(label);
		},
	};
	return { team, labels };
}

describe("/team join", () => {
	test("joins under the label it was given, and says where it landed", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const { team, labels } = fakeTeam();
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime, { team });
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join billing-core", ctx);
		expect(labels).toEqual(["billing-core"]);
		expect(notifications.at(-1)).toBe("team: on the team as billing-core, listening for handoffs.");
	});

	test("a bare join lands on the label the bus already has", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const { team, labels } = fakeTeam();
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime, { team });
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join", ctx);
		expect(labels).toEqual([undefined]);
		expect(notifications.at(-1)).toContain("on the team as billing-lead");
	});

	test("a refused join says why, and claims nothing", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const { team } = fakeTeam(() => ({ ok: false, error: 'the label "core" is already in use.' }));
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime, { team });
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join core", ctx);
		expect(notifications.at(-1)).toBe('team: not on the team — the label "core" is already in use.');
	});

	test("answers the bus's own sentence when there is no bus to join", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const fake = createFakePi();
		// No `session` tool is registered, which is how `board` and `team` loaded alone look.
		registerCommands(fake.pi, board.runtime);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join billing-core", ctx);
		expect(notifications.at(-1)).toBe("team: not on the team — the session bus is not loaded");
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

describe("its words", () => {
	test("warns about a word it does not know, and says which it does", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("leave", ctx);
		expect(notifications.at(-1)).toContain("try /team, or /team join [<label>]");
	});

	test("completes join, and stops once an argument starts", () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		expect(command.getArgumentCompletions?.("j")).toEqual([{ value: "join", label: "join" }]);
		expect(command.getArgumentCompletions?.("join ")).toBeNull();
		expect(command.getArgumentCompletions?.("x")).toBeNull();
	});
});
