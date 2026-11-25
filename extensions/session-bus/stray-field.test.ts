/**
 * The `session` tool refuses a field its action never reads.
 *
 * One flat parameter object offers every field to every action, so a `status` call carrying `to`
 * looked like a send that named a peer and was dropped in silence. The table is `protocol.ts`'s,
 * beside the action list and its normalizer, and this suite holds both directions: a published
 * field that no action claims, and a claimed field the schema does not publish.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import { busToolSession as session } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { ACTION_FIELDS } from "./protocol.ts";
import { SessionParams } from "./tools.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("session tool: a stray field", () => {
	test("refuses a field the action never reads, naming the action that takes it", async () => {
		const me = session(scratchDir(temps, "pi-session-bus-"), "/repo", "s1", "lily");
		const refused = await me.tool.execute("call", { action: "status", to: "peer" }, undefined, undefined, me.ctx);
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toBe("Error: status does not act on to: `send` takes it.");
		await me.bus.stop();
	});

	test("does not refuse a field the caller left out", async () => {
		// The host's schema makes an unset field `undefined`; a codemod caller may spell it out.
		const me = session(scratchDir(temps, "pi-session-bus-"), "/repo", "s1", "lily");
		const result = await me.tool.execute("call", { action: "status", to: undefined }, undefined, undefined, me.ctx);
		expect(result.isError).toBeUndefined();
		await me.bus.stop();
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const published = Object.keys(SessionParams.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(ACTION_FIELDS).flat());
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});
