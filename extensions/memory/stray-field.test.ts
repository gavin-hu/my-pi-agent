/**
 * The `memory` tool refuses a field its action never reads.
 *
 * `add` with a `to` used to answer success and write only the note — the replacement was
 * `update`'s field, dropped in silence. The table is `types.ts`'s, `scope` is in every row
 * because `list` reads it too, and this suite holds both directions.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { MemoryParams } from "./schema.ts";
import { TOOL_NAME } from "./tools.ts";
import { ACTION_FIELDS } from "./types.ts";

let suite: MemorySuite;

beforeEach(() => {
	suite = memorySuite();
});

afterEach(() => {
	suite.dispose();
});

function execute(args: Record<string, unknown>) {
	return suite.pi.tools.get(TOOL_NAME).execute("call", args, undefined, undefined);
}

describe("memory tool: a stray field", () => {
	test("refuses a field the action never reads, naming the action that takes it", async () => {
		const refused = await execute({ action: "add", text: "x", to: "y" });
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toBe("Error: add does not act on to: `update` takes it.");
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const published = Object.keys(MemoryParams.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(ACTION_FIELDS).flat());
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});
