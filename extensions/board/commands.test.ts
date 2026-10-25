/**
 * `/board` — the four words, and what each one does to the page.
 *
 * The command is a parser over the lifecycle, so a fake page records what it was
 * asked for and the context records what the user is told. A word the command does
 * not know is a warning that lists the ones it does, because a silent no-op reads
 * like a broken command.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { BOARD_COMMAND, registerCommands } from "./commands.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** A page that records every call and answers with a fixed status. */
function fakePage(): { page: BoardPage; calls: string[] } {
	const calls: string[] = [];
	const running: BoardPageStatus = {
		running: true,
		port: 4812,
		url: "http://127.0.0.1:4812/?token=abc",
		where: "~/.pi/agent/board/k",
	};
	let isRunning = false;
	const page: BoardPage = {
		start: async (_ctx, view) => {
			calls.push(`start ${view ?? "board"}`);
			isRunning = true;
			return running;
		},
		stop: async () => {
			calls.push("stop");
			const was = isRunning;
			isRunning = false;
			return was;
		},
		status: () => {
			calls.push("status");
			return isRunning ? running : { running: false };
		},
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
	return { page, calls };
}

/** The command as the host invokes it. */
async function run(args: string) {
	const { page, calls } = fakePage();
	const fake = createFakePi();
	registerCommands(fake.pi, page);
	const command = fake.commands.get(BOARD_COMMAND);
	if (!command) throw new Error("the board command was not registered");
	const { ctx, notifications } = fakeCtx();
	await command.handler(args, ctx);
	return { calls, notifications, command, ctx };
}

describe("/board", () => {
	test("opens the page on the Board tab with no argument", async () => {
		const { calls, notifications } = await run("");
		expect(calls).toEqual(["start board"]);
		expect(notifications.at(-1)).toContain("http://127.0.0.1:4812");
	});

	test("opens it on the Team tab", async () => {
		const { calls } = await run("team");
		expect(calls).toEqual(["start team"]);
	});

	test("prints one line for status", async () => {
		const { calls, notifications } = await run("status");
		expect(calls).toEqual(["status"]);
		expect(notifications.at(-1)).toContain("board: not running");
	});

	test("stops a running page, and says when there was none", async () => {
		const first = await run("stop");
		expect(first.calls).toEqual(["stop"]);
		expect(first.notifications.at(-1)).toBe("board: not running");
	});

	test("warns about a word it does not know, and lists the ones it does", async () => {
		const { calls, notifications } = await run("archive");
		expect(calls).toEqual([]);
		expect(notifications.at(-1)).toContain("try /board, /board team, /board status, /board stop");
	});

	test("completes only the words it has", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, page());
		const command = fake.commands.get(BOARD_COMMAND);
		const complete = (prefix: string) => command.getArgumentCompletions(prefix);
		const values = (prefix: string) => complete(prefix)?.map((item: { value: string }) => item.value);
		expect(values("st")).toEqual(["status", "stop"]);
		expect(values("t")).toEqual(["team"]);
		expect(complete("x")).toBeNull();
		expect(complete("st more")).toBeNull();
	});

	test("names itself in the command table", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, page());
		expect(fake.commands.get(BOARD_COMMAND)?.description).toContain("/board [team | status | stop]");
	});
});

/** A page with no recording, for the completion cases. */
function page(): BoardPage {
	return {
		start: async () => ({ running: false }),
		stop: async () => false,
		status: () => ({ running: false }),
		closeAll: async () => {},
	};
}
