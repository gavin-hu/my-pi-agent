/**
 * The number a session's row shows, and the calls that move it.
 *
 * `N unread` is the mail a session has *not been told about*: a notice marks a burst told, a
 * read marks what it showed, and `inbox` is the one call that also deletes. These cases drive
 * the tool, the record it writes, and the count a peer's row reads — the count falling while
 * the body stays on disk is the whole of the card.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import {
	type BusToolSession,
	busToolSession as session,
	joinBusSession as joins,
} from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The number this session's own row carries: what a peer and the page both draw. */
async function unreadOf(target: BusToolSession): Promise<number | undefined> {
	const status = await target.bus.status();
	return status.sessions.find((row) => row.id === status.me.id)?.unread;
}

describe("the mail a session has not been told about", () => {
	test("a read shows the mail, keeps it, and stops the row counting it", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "contract v2" });
		await frontend.bus.send({ to: "backend", text: "and the paths" });
		expect(await unreadOf(backend)).toBe(2);

		const read = await backend.tool.execute("call", { action: "read" }, undefined, undefined, backend.ctx);
		expect(read.isError).toBeFalsy();
		expect(read.details.messages).toHaveLength(2);
		expect(read.content[0]?.text).toContain("contract v2");
		expect(read.content[0]?.text).toContain("Kept in the inbox");

		// Told, not consumed: the count is the peer's, and the bodies are still the inbox's to give.
		expect(await unreadOf(backend)).toBe(0);
		expect((await backend.bus.inbox()).map((message) => message.text)).toEqual(["contract v2", "and the paths"]);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("a read past its limit leaves the rest counted for the next one", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		await frontend.bus.send({ to: "backend", text: "one" });
		await frontend.bus.send({ to: "backend", text: "two" });
		await frontend.bus.send({ to: "backend", text: "three" });

		const read = await backend.tool.execute("call", { action: "read", limit: 1 }, undefined, undefined, backend.ctx);
		expect(read.details.messages.map((message: { text: string }) => message.text)).toEqual(["one"]);
		expect(read.content[0]?.text).toContain("2 more in the inbox");
		expect(await unreadOf(backend)).toBe(2);
		await frontend.bus.stop();
		await backend.bus.stop();
	});
});
