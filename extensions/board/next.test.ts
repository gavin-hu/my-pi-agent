/**
 * `/board next` — the boundary's one word, and the reasons it says no.
 *
 * The command replaces the host session, which is the one call a suite cannot make for itself: the
 * context double records what was asked and in which order, so "it refused" and "it waited first" are
 * facts the file can check rather than intentions. The wording is `nextRefusal`'s, a pure function,
 * because the gate is about the cards a session holds and not about a context.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness, boardTool } from "../../test/helpers/board.ts";
import { pageWithNoRecording } from "../../test/helpers/board-command.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { Card } from "../../lib/workflow/card.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import { BOARD_COMMAND, NEXT_CANCELLED, nextRefusal, registerCommands } from "./commands.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000;

describe("the boundary's answer", () => {
	test("refuses a card typed after the word, because the session it starts reads its own", () => {
		expect(nextRefusal({ argued: "916" })).toBe(
			"board: /board next takes no card — the session it starts finds yours on its first turn",
		);
	});

	test("refuses a board it could not read, and names the door that skips the gate", () => {
		const line = nextRefusal({ unreadable: true }) ?? "";
		expect(line).toContain("could not read the board");
		// The gate proves nothing is open; a session that must move anyway has `/new`, unadorned.
		expect(line).toContain("/new starts a session anyway");
	});

	test("names the card in design, and the release that clears the door", () => {
		expect(nextRefusal({ held: [numberedCard("916", { lane: "plan" })] })).toBe(
			"board: #916 in plan is still yours — close it, or `board release 916` to start fresh",
		);
	});

	test("holds an executing card too, since a boundary is not a way out of work in flight", () => {
		expect(nextRefusal({ held: [numberedCard("917", { lane: "execute" })] })).toContain("#917 in execute");
	});

	test("lets a parked card through: it waits on somebody else, and the next line names it", () => {
		expect(nextRefusal({ held: [numberedCard("918", { lane: "blocked" })] })).toBeUndefined();
	});

	test("lists every open card rather than the first, so releasing one is not a guess", () => {
		const held: Card[] = [numberedCard("916", { lane: "plan" }), numberedCard("917", { lane: "execute" })];
		expect(nextRefusal({ held })).toBe(
			"board: #916 in plan, #917 in execute are still yours — close each, or `board release <id>` to start fresh",
		);
	});
});

/**
 * The command over a real board: the answer has to come from the store, because the gate reads the
 * same pile every other door writes. `tainted` is a session whose store cannot answer, which is the
 * one way to tell "it refused before reading" from "it read and refused".
 */
function commandBoard(options: { tainted?: boolean } = {}) {
	const harness = boardHarness({ now: NOW, track: temps.track });
	const tool = boardTool({ cwd: harness.cwd, agentDir: harness.agentDir, now: NOW });
	const session: BoardSession =
		options.tainted === true
			? {
					...harness.runtime,
					store: () => {
						throw new Error("the store must not be opened for a word it refuses");
					},
				}
			: harness.runtime;
	/** The order the restart was asked in, which is the half a single boolean cannot show. */
	const order: string[] = [];
	const run = async (args: string, answers: { idle?: boolean; cancelled?: boolean } = {}) => {
		// One list per run: two lines typed in one case are two boundaries, not one long one.
		order.length = 0;
		const fake = createFakePi();
		registerCommands(fake.pi, session, pageWithNoRecording());
		const command = fake.commands.get(BOARD_COMMAND);
		if (!command) throw new Error("the board command was not registered");
		const { ctx, notices } = fakeCtx({
			cwd: harness.cwd,
			sessionId: "s-lead",
			sessionName: "billing-lead",
			isIdle: () => answers.idle ?? true,
			extra: {
				waitForIdle: async () => void order.push("wait"),
				newSession: async () => {
					order.push("new");
					return { cancelled: answers.cancelled ?? false };
				},
			},
		});
		// A command's context has no `executeTool`: this door is not a tool.
		delete ctx.executeTool;
		await command.handler(args, ctx);
		return { notifications: notices, order };
	};
	return { run, call: tool.call };
}

describe("/board next", () => {
	test("refuses while this session's card is still in design, and starts nothing", async () => {
		const board = commandBoard();
		await board.call({ action: "add", title: "One", paths: [] });
		await board.call({ action: "claim", card: "1" });
		const { notifications, order } = await board.run("next");
		expect(notifications.at(-1)).toEqual({
			message: "board: #1 in plan is still yours — close it, or `board release 1` to start fresh",
			kind: "warning",
		});
		expect(order).toEqual([]);
	});

	test("goes ahead when the only card is parked on a decision", async () => {
		const board = commandBoard();
		await board.call({ action: "add", title: "One", paths: [] });
		await board.call({ action: "claim", card: "1" });
		await board.call({
			action: "move",
			card: "1",
			lane: "blocked",
			blocker: "decision",
			blockedBy: "waiting on the API owner",
		});
		const { notifications, order } = await board.run("next");
		expect(notifications).toEqual([]);
		expect(order).toEqual(["new"]);
	});

	test("waits for the turn to settle before it replaces it, and not at all when it already has", async () => {
		const board = commandBoard();
		expect((await board.run("next", { idle: false })).order).toEqual(["wait", "new"]);
		expect((await board.run("next", { idle: true })).order).toEqual(["new"]);
	});

	test("says a replacement the host cancelled, so the one silent failure is not silent", async () => {
		const board = commandBoard();
		const { notifications } = await board.run("next", { cancelled: true });
		expect(notifications.at(-1)).toEqual({ message: NEXT_CANCELLED, kind: "warning" });
	});

	test("refuses a card named after the word without reading the board at all", async () => {
		const board = commandBoard({ tainted: true });
		const { notifications, order } = await board.run("next 916");
		expect(notifications.at(-1)?.message).toContain("takes no card");
		expect(order).toEqual([]);
	});
});
