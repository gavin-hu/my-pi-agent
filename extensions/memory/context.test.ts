/**
 * When the memory store is read, and who waits for it.
 *
 * A session start starts the read and returns — the reload does not pay for a scan nobody has
 * asked for yet — so the other half needs its own cases: the first turn, and the command that
 * can arrive before one, wait for it rather than reading an empty store.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";

let suite: MemorySuite;

beforeEach(() => {
	suite = memorySuite();
});

afterEach(() => {
	suite.dispose();
});

describe("the store read the session starts", () => {
	test("is awaited by the first turn, which therefore sees the notes", async () => {
		suite.write("global", "- late note\n");
		await suite.emit("session_start", { reason: "startup" });
		const [injected] = await suite.emit("before_agent_start", {});
		expect(injected.message.content).toContain("- late note");
	});

	test("is awaited by a command that arrives before any turn", async () => {
		suite.write("global", "- typed before a turn\n");
		await suite.emit("session_start", { reason: "startup" });
		const command = suite.pi.commands.get("memory");
		if (!command) throw new Error("the memory command was not registered");
		await command.handler("list", suite.ctx);
		expect(suite.notices.at(-1)).toContain("typed before a turn");
	});
});
