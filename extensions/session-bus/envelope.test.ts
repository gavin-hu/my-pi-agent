/**
 * The envelope's two references: an id a message answers, and what it is about.
 *
 * They are one capability because they are one addition: a reply a reader can follow, and a card a
 * message can be filed under. Each keeps its own rule: `replyTo` is an id this bus minted, so it is
 * one word on `key`'s alphabet, while `about` names something another domain built — a card is
 * `#673` on the board — so it is one bounded line in the sender's own spelling. This suite is the
 * door: what the tool writes, what it refuses, and the schema that publishes the same rules before
 * a call runs. The rows that print them are `format.test.ts`'s, and the nested call that carries
 * them is `lib/session-tool-send.test.ts`'s.
 *
 * It is its own suite because `tools.test.ts` is at the suite bar, and the two references are the
 * one thing this card adds to the wire.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import { busToolSession as session, joinBusSession as joins } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { normalizeKey, normalizeReplyTo } from "./protocol.ts";
import { SessionParams } from "./tools.ts";

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
		expect(refused.content[0]?.text).toContain('replyTo "two words" may hold letters, digits');
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("carries a card's own spelling and a phrase, which the alphabet used to refuse", async () => {
		const dir = scratchDir(temps, "pi-envelope-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);

		// `#673` is the board's own spelling (`cardRef`), and a phrase is what a person has to hand when
		// the thing is not a card at all: both are the sender's word, and the bus keeps it.
		for (const about of ["#673", "dev stack restart"]) {
			const sent = await frontend.tool.execute(
				"call",
				{ action: "send", to: "backend", text: "fyi", about },
				undefined,
				undefined,
				frontend.ctx,
			);
			expect(sent.details.delivered).toEqual(["backend"]);
			const read = await backend.tool.execute("call", { action: "read" }, undefined, undefined, backend.ctx);
			expect(read.details.messages.at(-1)).toMatchObject({ about });
		}
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("publishes in the schema exactly the words the guards refuse", () => {
		// TypeBox's wrapper type does not surface the JSON Schema keywords, while the schema the host
		// validates with does; that published schema is what this pins.
		const keywords = (schema: unknown) => schema as { pattern?: string; maxLength?: number };
		const key = keywords(SessionParams.properties.key);
		const about = keywords(SessionParams.properties.about);
		const pattern = new RegExp(key.pattern ?? "");
		// The words a sender writes, and the two forms the alphabet turns away. A schema that drifted
		// from the guard would be the refusal discovered by failing again, one layer earlier.
		for (const word of ["a1b2c3", "board.667", "release.0.28.0", "card-659-cut", "#673", "two words"]) {
			expect("error" in normalizeKey(word)).toBe(!pattern.test(word));
			expect("error" in normalizeReplyTo(word)).toBe(!pattern.test(word));
		}
		// `about` publishes a length and no alphabet: its spelling belongs to the domain that made it.
		expect(about.pattern).toBeUndefined();
		expect(about.maxLength).toBe(key.maxLength);
	});
});
