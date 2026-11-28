/**
 * `/board` — the words it knows, the flags each declares, and what a line it cannot read is told.
 *
 * The vocabulary is the user-facing contract: one table carries each word's spelling, its card slot
 * and its flags, and the help, the completer and the parser read that one table. A flag a row does
 * not declare is refused **by name** — the case that matters, because the hand-counted scan this
 * replaced read a mistyped flag as the card's tail and dropped it, so `/board review 4 --rote x`
 * signed the card while the person believed the line had been refused.
 *
 * Its own suite because `commands.test.ts`, which held both the words and the page's lifecycle,
 * crossed the 400-line bar doing it; `test/suite-manifest.ts` declares this one and the page suite
 * keeps the cases that touch the page.
 */

import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import {
	fakeBoardSession,
	fakeLeadDoor,
	pageWithNoRecording,
	runBoard as run,
} from "../../test/helpers/board-command.ts";
import { BOARD_COMMAND, BOARD_WORDS, type BoardWord, registerCommands } from "./commands.ts";

/** The card slot a word takes, as a user writes it: the signs are the two that take one. */
const slot = (entry: BoardWord): string => (entry.sign === undefined ? "" : " <id>");
/** A word as the warning lists it: the word and its card slot, never its flags. */
const short = (entry: BoardWord): string => `/board ${entry.word}${slot(entry)}`;
/** A word as the description carries it: the same, with its flags spelled out. */
const long = (entry: BoardWord): string =>
	`${entry.word}${slot(entry)}${(entry.flags ?? []).map((flag) => ` ${flag.name} ${flag.slot}`).join("")}`;

describe("/board's words", () => {
	test("names every word it accepts, in the order a user meets them", () => {
		// The vocabulary is the user-facing contract, so it is literal here: the card verb, the sweep
		// flag, the two signs with theirs, then the page's own words. The sign is the card slot, so a
		// row that names one names the other.
		expect(BOARD_WORDS.map((entry) => long(entry))).toEqual([
			"next",
			"archive --older-than <age>",
			"approve <id>",
			"review <id> --root <tree> --override <why>",
			"status",
			"stop",
			"team",
		]);
	});

	test("no longer knows the word exit, and lists the ones it has", async () => {
		const lead = fakeLeadDoor(true);
		const { calls, notifications } = await run("exit", { lead });
		expect(calls).toEqual([]);
		expect(lead.calls).toEqual([]);
		expect(notifications.at(-1)).toBe(
			`board: "exit" is not a word this command knows — try ${BOARD_WORDS.map(short).join(", ")}`,
		);
	});

	test("refuses a flag the word does not declare, naming the ones it has", async () => {
		// The scan is the row's, so a mistyped flag is refused rather than read as a card's tail and
		// silently dropped: the sign would go through while the person believed it had applied.
		const { notifications } = await run("review 4 --rote x");
		expect(notifications.at(-1)).toBe("board: review takes no --rote — try --root <tree>, --override <why>");
	});

	test("refuses any flag on a word that declares none", async () => {
		// What the two bespoke refusals used to say, from the row: a word with no flags takes none.
		const { notifications } = await run("approve 4 --root ./tree");
		expect(notifications.at(-1)).toBe("board: approve takes no --root — it takes none: /board approve <id>");
	});

	test("refuses a flag whose value was left off, before any store is opened", async () => {
		const { notifications } = await run("review 4 --root");
		expect(notifications.at(-1)).toBe("board: review --root needs a tree");
	});

	test("refuses a word the row does not take", async () => {
		const { notifications } = await run("status now");
		expect(notifications.at(-1)).toBe("board: status takes no words — try /board status");
	});

	test("refuses a sweep whose bound lost its flag, and sweeps nothing", async () => {
		// `/board archive 30d` is the case: a bare word that looks exactly like a card id.
		const { notifications, calls } = await run("archive 30d");
		const line = notifications.at(-1) ?? "";
		expect(line).toContain("--older-than <age>");
		expect(line).toContain("Nothing was swept.");
		expect(calls).toEqual([]);
	});

	test("refuses a bound that is not an age, in the words the tool also uses", async () => {
		const { notifications } = await run("archive --older-than 30");
		expect(notifications.at(-1)).toContain('"30" is not an age');
	});

	test("warns about a word it does not know, and lists the ones it does", async () => {
		const { calls, notifications } = await run("scrub");
		expect(calls).toEqual([]);
		expect(notifications.at(-1)).toContain(`try ${BOARD_WORDS.map(short).join(", ")}`);
	});

	test("completes only the words it has, whatever case it is typed in", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, fakeBoardSession(), pageWithNoRecording());
		const command = fake.commands.get(BOARD_COMMAND);
		const complete = (prefix: string) => command.getArgumentCompletions(prefix);
		const values = (prefix: string) => complete(prefix)?.map((item: { value: string }) => item.value);
		expect(values("st")).toEqual(["status", "stop"]);
		expect(values("t")).toEqual(["team"]);
		expect(complete("x")).toBeNull();
		expect(complete("st more")).toBeNull();
		// The handler lowercases what it parses, so `/board ST 4` signs: the completion agrees.
		expect(values("St")).toEqual(["status", "stop"]);
		expect(values("ST")).toEqual(["status", "stop"]);
		expect(values("  T")).toEqual(["team"]);
	});

	test("names itself in the command table", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, fakeBoardSession(), pageWithNoRecording());
		const description = fake.commands.get(BOARD_COMMAND)?.description ?? "";
		// The words are parsed by this suite and described here, so the table says which of them the
		// lead's session is for: a description that offers a peer the sign contradicts the gate.
		expect(description).toContain("sign its two gates as the lead");
		// The usage tail is the table's, in its order and with its flags: one word, one spelling.
		expect(description).toContain(`: /board [${BOARD_WORDS.map(long).join(" | ")}]`);
	});
});
