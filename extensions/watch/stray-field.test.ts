/**
 * The `watch` tool refuses a field its action never reads.
 *
 * The guard sits in the tool rather than in `schema.ts` because `normalizeCall`'s job is parsing
 * and the refusal is policy: a `logs` call carrying `path` used to answer success with the path
 * dropped. The table is `types.ts`'s, beside the action list, and this suite holds both directions.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import { WatchParams } from "./schema.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";
import { WATCH_FIELDS } from "./types.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function setup(mode = "print") {
	const h = suite.makeHarness();
	const { pi, tools } = createFakePi();
	registerTools(pi, h.runtime);
	const { ctx } = makeCtx({ cwd: h.dir, mode });
	h.runtime.load(ctx);
	return { ctx, tool: tools.get(TOOL_NAME) };
}

describe("watch tool: a stray field", () => {
	test("refuses a field the action never reads, naming the action that takes it", async () => {
		const { ctx, tool } = setup();
		// The id is the verb's own requirement and is checked first; the stray field is what this case is about.
		const refused = await tool.execute("t", { action: "logs", id: "w1", path: "app.log" }, undefined, undefined, ctx);
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("logs does not act on path: `add` takes it");
	});

	test("does not refuse a field the caller left out", async () => {
		// The host's schema makes an unset field `undefined`; a codemod caller may spell it out.
		const { ctx, tool } = setup();
		const result = await tool.execute("t", { action: "list", id: undefined }, undefined, undefined, ctx);
		expect(result.isError).toBeUndefined();
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const published = Object.keys(WatchParams.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(WATCH_FIELDS).flat());
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});
