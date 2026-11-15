/**
 * The envelope's two references: an id a message answers, and what it is about.
 *
 * They are one capability because they are one addition: a reply a reader can follow, and a card a
 * message can be filed under. The bus keeps both opaque — `replyTo`/`about` are one word each, on
 * the same alphabet as `key` — and this suite is the door: what the tool writes, and what it
 * refuses. The row that prints `re: <id>` is `format.test.ts`'s, and the nested call that carries
 * them is `lib/session-tool-send.test.ts`'s.
 *
 * It is its own suite because `tools.test.ts` is at the suite bar, and the two references are the
 * one thing this card adds to the wire.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import { busToolSession as session, joinBusSession as joins } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("a message's references", () => {
	test("a reply carries the id it answers and the card it is about", async () => {
		const dir = scratchDir(temps, "pi-envelope-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);

		const sent = await frontend.tool.execute(
			"call",
			{ action: "send", to: "backend", text: "yes", replyTo: "a1b2c3", about: "4" },
			undefined,
			undefined,
			frontend.ctx,
		);
		expect(sent.details.delivered).toEqual(["backend"]);
		// The recipient reads them back from the file, not from the sender's word.
		const read = await backend.tool.execute("call", { action: "read" }, undefined, undefined, backend.ctx);
		expect(read.details.messages[0]).toMatchObject({ replyTo: "a1b2c3", about: "4" });
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("refuses a reply id that is not one word", async () => {
		const dir = scratchDir(temps, "pi-envelope-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);

		const refused = await frontend.tool.execute(
			"call",
			{ action: "send", to: "backend", text: "yes", replyTo: "two words" },
			undefined,
			undefined,
			frontend.ctx,
		);
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("replyTo may hold letters, digits");
		await frontend.bus.stop();
		await backend.bus.stop();
	});
});
