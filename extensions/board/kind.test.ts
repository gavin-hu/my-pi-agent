/**
 * The card's kind through the tool: `add` and `edit` write the two facts, leave either
 * alone when they do not name it, and clear the marker with `false`.
 *
 * A suite of its own because `tools.test.ts` is at its size bar and this is one capability
 * rather than another action; the harness is the tool's own, driven the way Pi drives it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;
const LEAD = "billing-lead";

/** The tool, over one temporary board with `billing-lead` as its lead. */
function harness() {
	const board = boardHarness({ lead: LEAD, now: NOW, track: temps.track });
	registerTools(board.fake.pi, board.runtime, {});
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		},
	};
}

describe("the card's kind through the tool", () => {
	test("add writes a kind and a breaking marker, and neither when it names neither", async () => {
		const { call } = harness();
		const added = await call({ action: "add", title: "Billing webhook", type: "feature", breaking: true });
		expect(added.details.card).toMatchObject({ type: "feature", breaking: true });
		const plain = await call({ action: "add", title: "Plain" });
		expect(plain.details.card).not.toHaveProperty("type");
		expect(plain.details.card).not.toHaveProperty("breaking");
	});

	test("refuses a kind it does not know and a marker that is not a boolean", async () => {
		const { call } = harness();
		expect(resultText(await call({ action: "add", title: "T", type: "perf" }))).toContain(
			"type must be one of feature, bug, refactor, docs, test, chore.",
		);
		expect(resultText(await call({ action: "add", title: "T", breaking: "yes" }))).toContain(
			"breaking must be true or false.",
		);
		const refused = await call({ action: "add", title: "T", type: "perf" });
		expect(refused.isError).toBe(true);
		expect(refused.details.error).toContain("type must be one of");
	});

	test("edit records a kind, leaves it alone when another field is named, and clears the marker", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Billing webhook" });
		const typed = await call({ action: "edit", card: "1", type: "bug", breaking: true });
		expect(typed.details.card).toMatchObject({ type: "bug", breaking: true });
		const retitled = await call({ action: "edit", card: "1", title: "Billing webhook stores orders" });
		expect(retitled.details.card).toMatchObject({ type: "bug", breaking: true });
		const cleared = await call({ action: "edit", card: "1", breaking: false });
		expect(cleared.details.card).not.toHaveProperty("breaking");
		expect(cleared.details.card?.type).toBe("bug");
	});

	test("edit refuses a kind it does not know and keeps the card it did not change", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Billing webhook", type: "bug" });
		const refused = await call({ action: "edit", card: "1", type: "perf" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("type must be one of feature, bug, refactor, docs, test, chore.");
		expect(refused.details.card?.type).toBe("bug");
	});
});
