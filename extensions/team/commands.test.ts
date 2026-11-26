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
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { minuteOldCards } from "../../test/helpers/fixtures/board.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { openBoardSession } from "../../lib/workflow/session.ts";
import {
	MAX_ROUND_LINES,
	type PresenceRow,
	registerCommands,
	roundText,
	TEAM_COMMAND,
	TEAM_USAGE,
	whoIsHere,
	whoText,
} from "./commands.ts";
import { LEAD_ROUND } from "../../lib/workflow/round-text.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

// A card a minute old, as the store would have written it.
const card = minuteOldCards(NOW);

/** A bus record. */
function mate(label: string, lastSeen: number): RosterSession {
	return { id: `s-${label}`, label, mode: "tui", lastSeen, mail: 0 };
}

/** A record whose process is gone: no host runs a pid that high. */
function dead(label: string): RosterSession {
	return { ...mate(label, NOW - 60_000), pid: 999_999_999 };
}

/** The `- ` rows under one section head, and nothing when the section is not there. */
function rowsOf(listing: string, label: string): string[] {
	const lines = listing.split("\n");
	const at = lines.findIndex((line) => line.startsWith(`${label} (`));
	if (at < 0) return [];
	const rows: string[] = [];
	for (const line of lines.slice(at + 1)) {
		if (!line.startsWith("- ")) break;
		rows.push(line);
	}
	return rows;
}

/** The rows a group prints, as the listing spells them. */
function rowLines(group: readonly PresenceRow[]): string[] {
	return group.map((row) => `- ${row.line}${row.silent ? " · not listening" : ""}`);
}

describe("roundText", () => {
	test("an empty board is one sentence, not a headline of zeroes", () => {
		expect(roundText([], NOW)).toBe("team: nothing to report — the board is empty");
	});

	test("names a dead owner's cards, and says who is gone rather than quiet", () => {
		const cards = [
			card("1", { lane: "execute", owner: { label: "billing-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("2", { lane: "blocked", owner: { label: "billing-core" } }),
			card("3", { lane: "done", owner: { label: "billing-core" } }),
			card("4", { lane: "execute", owner: { label: "ops-helper" }, updatedAt: NOW - 2 * 60_000 }),
		];
		const roster = [mate("billing-lead", NOW), dead("billing-core"), mate("ops-helper", NOW - 20 * 60_000)];
		const lines = roundText(cards, NOW, roster).split("\n");
		// The instruction comes before the tail: who died is the quieter fact.
		expect(lines).toContain("board reclaim #1, #2 — billing-core is not running");
		// The tail counts what it can point at, rather than naming every session a second time.
		expect(lines.at(-1)).toBe("1 of 3 sessions live — /team who lists them");
		// A card finished by a dead owner is history, not work to reclaim.
		const reclaim = lines.find((line) => line.startsWith("board reclaim "));
		expect(reclaim).not.toContain("#3");
	});

	test("prints the rollup, then the count of who is live", () => {
		const cards = [
			card("1"),
			card("2", { lane: "execute", owner: { label: "billing-core" } }),
			card("3", {
				lane: "blocked",
				owner: { label: "billing-core" },
				notes: [{ by: "x", at: NOW, text: "gateway" }],
			}),
		];
		const roster = [mate("billing-lead", NOW), mate("ops-helper", NOW - 20 * 60_000)];
		expect(roundText(cards, NOW, roster).split("\n")).toEqual([
			"1 owner · 3 features · 1 unassigned · 0 unplanned · 0 awaiting approval · 1 awaiting review · 0 untold · 1 blocked · 0 unwritten · 0 done",
			"billing-core (2): #2 execute, #3 blocked",
			"unassigned (1): #1 backlog",
			"unreviewed (1): #2 execute",
			"blocked (1): #3 blocked — gateway",
			"1 of 2 sessions live — /team who lists them",
		]);
	});

	test("names an owner by the record the bus holds, so a rename reads once", () => {
		// The card records the name its claim wrote; `/team join billing-core` moved the bus record and
		// no card, so the round has to ask the roster before it groups or compares a label.
		const cards = [card("1", { lane: "execute", owner: { id: "s-core", label: "team-agent-score" } })];
		const lines = roundText(cards, NOW, [{ ...mate("billing-core", NOW), id: "s-core" }]).split("\n");
		expect(lines).toContain("billing-core (1): #1 execute");
		// One owner, and no second one for the name the card kept — not even in the tail's count.
		expect(lines.some((line) => line.includes("team-agent-score"))).toBe(false);
		expect(lines.at(-1)).toBe("1 of 1 session live — /team who lists them");
	});

	test("names a quiet owner's cards, and leaves an owner with no record to the fact line", () => {
		const cards = [
			card("1", { lane: "execute", owner: { label: "ops-helper" } }),
			card("2", { lane: "plan", owner: { label: "nobody-home" } }),
		];
		const lines = roundText(cards, NOW, [mate("ops-helper", NOW - 20 * 60_000)]).split("\n");
		// Quiet is one of the two states the board lets a peer take a card from. A label the bus has no
		// record of is not: a live session that never joined looks exactly the same.
		expect(lines).toContain("board reclaim #1 — ops-helper has gone quiet");
		expect(lines.some((line) => line.startsWith("board reclaim ") && line.includes("nobody-home"))).toBe(false);
		// No live session, and the owner with no record is not one: the count says so before the rows do.
		expect(lines.at(-1)).toBe("0 of 1 session live — /team who lists them");
	});

	test("says nothing about who is here when the bus has recorded nobody", () => {
		expect(roundText([card("1")], NOW)).not.toContain("/team who");
		expect(roundText([card("1")], NOW, [])).not.toContain("/team who");
	});

	test("folds the owners a bus has no record of, so the queue keeps its lines", () => {
		// The round's cap is a notify's limit, and one line per finished owner used to spend it:
		// the owners nobody answers for are one line now, and the cards that need a decision are
		// the lines a lead reads.
		const cards = [
			card("1", { lane: "done", owner: { label: "billing-old" } }),
			card("2", { lane: "done", owner: { label: "billing-older" } }),
			card("3", { lane: "done", owner: { label: "billing-older" } }),
			card("4"),
		];
		const lines = roundText(cards, NOW, [mate("billing-lead", NOW)]).split("\n");
		expect(lines).toContain("2 owners with no record · 3 done");
		expect(lines).toContain("unassigned (1): #4 backlog");
		expect(lines.some((line) => line.startsWith("billing-older"))).toBe(false);
	});

	test("prints its tail on top of the cap, which counts the rollup's own lines", () => {
		const cards = Array.from({ length: 20 }, (_, index) =>
			card(String(index + 1), { lane: "execute", owner: { label: `owner-${index}` } }),
		);
		cards.push(card("21", { lane: "execute", owner: { label: "ops-helper" } }));
		const lines = roundText(cards, NOW, [dead("ops-helper")]).split("\n");
		// The cap holds the rollup, and the two lines that say what to do about dead work ride on top:
		// the count in "… N more" is the rollup's overflow alone, so a reader can act on it.
		expect(lines).toHaveLength(MAX_ROUND_LINES + 3);
		// The overflow names the surface that draws the rest: a count with no door was a dead end.
		expect(lines[MAX_ROUND_LINES]).toMatch(/^… \d+ lines more — \/board draws the whole round$/);
		expect(lines[MAX_ROUND_LINES + 1]).toBe("board reclaim #21 — ops-helper is not running");
		expect(lines.at(-1)).toBe("0 of 1 session live — /team who lists them");
	});

	test("caps a long round and says how many lines it left out", () => {
		const cards = Array.from({ length: 20 }, (_, index) =>
			card(String(index + 1), { lane: "execute", owner: { label: `owner-${index}` } }),
		);
		const lines = roundText(cards, NOW).split("\n");
		expect(lines).toHaveLength(MAX_ROUND_LINES + 1);
		expect(lines.at(-1)).toMatch(/^… \d+ lines more — \/board draws the whole round$/);
	});
});

describe("whoText", () => {
	test("is one sentence when the repository has no bus at all", () => {
		expect(whoText([card("1")], NOW)).toBe("team: no session bus on this repository — nobody has joined");
	});

	test("prints a row per session, grouped, with a zero group drawn rather than left out", () => {
		const cards = [
			card("1", { lane: "execute", owner: { label: "billing-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("2", { lane: "blocked", owner: { label: "billing-core" } }),
			card("3", { lane: "execute", owner: { label: "ops-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("4", { lane: "plan", owner: { label: "nobody-home" } }),
			card("5"),
		];
		const roster = [mate("billing-lead", NOW), dead("billing-core"), mate("ops-core", NOW - 20 * 60_000)];
		expect(whoText(cards, NOW, roster).split("\n")).toEqual([
			"team: 3 sessions on the bus",
			"live (1)",
			"- billing-lead — idle",
			"quiet (1)",
			"- ops-core — #3 execute",
			"not on the bus (1)",
			"- nobody-home — #4 plan",
			"gone (1)",
			"- billing-core — #1 execute +1",
		]);
	});

	test("draws an empty group, so a missing state is not read as a clean team", () => {
		expect(whoText([], NOW, [mate("billing-lead", NOW)]).split("\n")).toEqual([
			"team: 1 session on the bus",
			"live (1)",
			"- billing-lead — idle",
			"quiet (0)",
			"- none",
			"not on the bus (0)",
			"- none",
			"gone (0)",
			"- none",
		]);
	});

	test("flags a peer that is not listening on its own row, and prints it once", () => {
		const roster = [
			mate("billing-lead", NOW),
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
		const cards = [card("1", { lane: "execute", owner: { label: "billing-core" } })];
		const listing = whoText(cards, NOW, roster);
		expect(rowsOf(listing, "live")).toEqual(["- billing-lead — idle", "- billing-core — #1 execute · not listening"]);
		// A quiet record that is disarmed is not flagged: the flag marks a live peer whose mail waits for
		// its next turn, and a session that has gone quiet is already the louder fact about it.
		expect(rowsOf(listing, "quiet")).toEqual(["- ops-helper — idle"]);
		// A paragraph named a silent peer twice by design — under `live:` and under `not listening:` — but
		// one row per session cannot: the flag rides the row that already names it.
		expect(listing.split("\n").filter((line) => line.includes("billing-core"))).toHaveLength(1);
	});

	test("names an owner the bus has no record of, which the roster cannot answer", () => {
		// The group that regresses the first time somebody simplifies the read to the roster alone:
		// these owners come from `round.owners`, a session holding cards the bus has never heard of.
		const cards = [card("2", { lane: "plan", owner: { label: "nobody-home" } })];
		const listing = whoText(cards, NOW, [mate("billing-lead", NOW)]);
		expect(rowsOf(listing, "not on the bus")).toEqual(["- nobody-home — #2 plan"]);
	});

	test("elides nothing, however long the team", () => {
		const roster = Array.from({ length: 30 }, (_, index) => mate(`session-${index}`, NOW));
		const listing = whoText([], NOW, roster);
		expect(rowsOf(listing, "live")).toHaveLength(30);
		// The word exists because `/team`'s notify cannot say this: no cap, and no "… N more".
		expect(listing.split("\n").some((line) => line.endsWith("more"))).toBe(false);
	});

	test("reads the grouping the round's tail counts, so the two cannot disagree", () => {
		// The assertion is against the grouping itself — `whoIsHere` — not a restatement of its group
		// names: a change to one surface that stops reading it fails the other's rows here.
		const cards = [
			card("1", { lane: "execute", owner: { label: "billing-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("2", { lane: "blocked", owner: { label: "billing-core" } }),
			card("3", { lane: "execute", owner: { label: "ops-core" }, updatedAt: NOW - 2 * 60_000 }),
			card("4", { lane: "plan", owner: { label: "nobody-home" } }),
			card("5", { lane: "execute", owner: { label: "ops-helper" }, updatedAt: NOW - 2 * 60_000 }),
		];
		const roster = [
			mate("billing-lead", NOW),
			{
				id: "s-helper",
				label: "ops-helper",
				mode: "tui",
				lastSeen: NOW,
				mail: 0,
				watching: { armed: false, wake: false },
			},
			mate("ops-core", NOW - 20 * 60_000),
			dead("billing-core"),
		];
		const here = whoIsHere(cards, NOW, roster);
		const listing = whoText(cards, NOW, roster);
		expect(rowsOf(listing, "live")).toEqual(rowLines(here.live));
		expect(rowsOf(listing, "quiet")).toEqual(rowLines(here.quiet));
		expect(rowsOf(listing, "not on the bus")).toEqual(rowLines(here.absent));
		expect(rowsOf(listing, "gone")).toEqual(rowLines(here.gone));
		// The round no longer names a session at all: it counts the live ones and points at these rows.
		expect(roundText(cards, NOW, roster).split("\n").at(-1)).toBe("2 of 4 sessions live — /team who lists them");
	});

	test("answers about one session when a label is named, an owner with no record included", () => {
		const cards = [card("4", { lane: "execute", owner: { label: "nobody-home" } })];
		const roster = [mate("billing-lead", NOW), dead("billing-core")];
		expect(whoText(cards, NOW, roster, "billing-lead")).toBe("team: billing-lead — idle · live");
		expect(whoText(cards, NOW, roster, "billing-core")).toBe("team: billing-core — idle · gone");
		// The owner the board names and the bus has no record of is still a session a lead asks about.
		expect(whoText(cards, NOW, roster, "nobody-home")).toBe("team: nobody-home — #4 execute · not on the bus");
		// The label is compared the way the board compares it, so a typed case still finds the record.
		expect(whoText(cards, NOW, roster, "Billing-Lead")).toBe("team: billing-lead — idle · live");
	});

	test("carries the not-listening flag into a single answer", () => {
		const roster = [
			{
				id: "s-core",
				label: "billing-core",
				mode: "tui",
				lastSeen: NOW,
				mail: 0,
				watching: { armed: false, wake: false },
			},
		];
		expect(whoText([], NOW, roster, "billing-core")).toBe("team: billing-core — idle · live · not listening");
	});

	test("says so when the label names nobody, and points at the listing", () => {
		expect(whoText([], NOW, [mate("billing-lead", NOW)], "ghost")).toBe(
			'team: no session or owner named "ghost" — /team who lists who is here',
		);
	});
});

/** The command mounted over a harness, with the notifications it writes. */
function mount(options: Parameters<typeof boardHarness>[0] = {}) {
	const board = boardHarness({ now: NOW, track: temps.track, ...options });
	const fake = createFakePi();
	registerCommands(fake.pi, board.runtime);
	const command = fake.commands.get(TEAM_COMMAND);
	if (!command) throw new Error("the team command was not registered");
	const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
	return { fake, command, ctx, notifications };
}

describe("the command", () => {
	test("is registered under its own name, and prints the board it reads", async () => {
		const { command, ctx, notifications } = mount();
		// The round's own line, from `lib/workflow/round-text.ts`: `team`'s lead guideline says the same
		// sentence, so the two surfaces that name the round cannot describe it differently.
		expect(command.description).toContain(LEAD_ROUND);
		// An empty board through the real store, so the command's three reads (cards, bus,
		// clock) are the shipped ones.
		await command.handler("", ctx);
		expect(notifications.at(-1)).toBe("team: nothing to report — the board is empty");
	});

	test("prints the rows, which say so when this repository has no bus", async () => {
		const { command, ctx, notifications } = mount();
		await command.handler("who", ctx);
		// The word reads the same store and roster the round does, through the shipped readers: a
		// harness with no bus directory is the fact the word must state rather than a failure.
		expect(notifications.at(-1)).toBe("team: no session bus on this repository — nobody has joined");
	});
});

describe("its words", () => {
	test("warns about a word it does not know, and prints the words it does", async () => {
		const { command, ctx, notifications } = mount();
		await command.handler("leave", ctx);
		// The warning carries the block rather than a sentence of its own, so the words a reader is
		// offered are the words the description above it names.
		expect(notifications.at(-1)).toBe(`team: "leave" is not a word this command knows\n${TEAM_USAGE}`);
	});

	test("prints the same block when it is asked for it", async () => {
		const { command, ctx, notifications } = mount();
		await command.handler("help", ctx);
		expect(notifications.at(-1)).toBe(TEAM_USAGE);
	});

	test("completes the words, and the team's names after the two that take a label", async () => {
		const { fake, command, ctx } = mount({ teammates: ["billing-core", "ops-core"] });
		// The words are static, so they complete before a session has started; a label is read from the
		// repository, and a completion with no root to read has nothing to offer.
		expect(await command.getArgumentCompletions?.("j")).toEqual([{ value: "join ", label: "join" }]);
		expect(await command.getArgumentCompletions?.("join ")).toBeNull();
		await emit(fake.pi, "session_start", {}, ctx);
		expect(await command.getArgumentCompletions?.("w")).toEqual([{ value: "who ", label: "who" }]);
		expect(await command.getArgumentCompletions?.("h")).toEqual([{ value: "help", label: "help" }]);
		expect(await command.getArgumentCompletions?.("x")).toBeNull();
		// The labels are the project's team: the list a bare join draws a name from, so a completion is a
		// name the join will take.
		expect(await command.getArgumentCompletions?.("join ")).toEqual([
			{ value: "billing-core", label: "billing-core" },
			{ value: "ops-core", label: "ops-core" },
		]);
		expect(await command.getArgumentCompletions?.("join o")).toEqual([{ value: "ops-core", label: "ops-core" }]);
		// `help` takes no argument, so a completion after it stops rather than offering names.
		expect(await command.getArgumentCompletions?.("help ")).toBeNull();
	});

	test("answers nothing when the store cannot open, rather than throwing at the editor", async () => {
		// The editor awaits a completer with no catch, so a rejection here is the whole process's
		// autocomplete; a store that cannot open is a repository this command cannot name.
		const fake = createFakePi();
		const unreachable = openBoardSession(fake.pi, {
			open: async () => {
				throw new Error("git is not on PATH");
			},
		});
		registerCommands(fake.pi, unreachable);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx } = fakeCtx({ cwd: "/repo" });
		await emit(fake.pi, "session_start", {}, ctx);
		// `resolves` rather than a null read off a settled call: without the guard this promise
		// rejects, so the case fails on the rejection the editor would have met, not on a shape.
		await expect(command.getArgumentCompletions?.("who ")).resolves.toBeNull();
		// The words are static and read no store: the keystroke after a failed one still completes.
		expect(await command.getArgumentCompletions?.("w")).toEqual([{ value: "who ", label: "who" }]);
	});
});
