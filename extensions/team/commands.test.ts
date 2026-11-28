/**
 * `/team`'s words: what the command is called, and the block a reader gets after a typo.
 *
 * The round it prints is `round.test.ts`'s subject. What is here mounts the command and asks only
 * what a person types — the description a lead reads in the command list, and the usage block that
 * answers `help` and a word it does not know.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { teamCommandHarness } from "../../test/helpers/team.ts";
import { TEAM_USAGE } from "./commands.ts";
import { LEAD_ROUND } from "../../lib/workflow/round-text.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

/** The command on a board of this suite's; the wiring is `test/helpers/team.ts`, shared with the
 * completer's suite. */
const mount = teamCommandHarness(NOW, temps.track);

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
});
