/**
 * The `board` block as the transcript draws it: which render option decides whether the
 * rows appear.
 *
 * A `list` is the one action with rows, so the collapsed block is the line that counts the
 * cards and expanding is what adds them — the picture `docs/extensions/board.md` describes
 * under `result.ts` and the gallery fixtures are labelled with. The rows themselves are
 * `result.test.ts`'s subject; what is pinned here is that the tool asks for them only when
 * the block is open, which is the boundary between the two.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The registered tool, and the two calls a case needs to make a board worth listing. */
function harness() {
	const board = boardHarness({ now: 50_000, track: temps.track });
	registerTools(board.fake.pi, board.runtime, {});
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	const call = async (args: Record<string, unknown>) =>
		(await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
			content: Array<{ text: string }>;
			details: BoardDetails;
		};
	return { tool, call };
}

describe("the block a listing draws", () => {
	test("is one line collapsed, and the rows only when expanded", async () => {
		const { tool, call } = harness();
		await call({ action: "add", title: "Billing webhook accepts orders" });
		const listed = await call({ action: "list" });
		const result = { content: [], details: listed.details };
		const collapsed = tool.renderResult(result, { expanded: false }, fakeTheme).render(80).join("\n");
		const expanded = tool.renderResult(result, { expanded: true }, fakeTheme).render(80).join("\n");
		expect(collapsed.split("\n")).toHaveLength(1);
		expect(collapsed).toContain("1 card");
		expect(collapsed).not.toContain("#1");
		expect(expanded).toContain("#1 Billing webhook accepts orders");
	});

	test("draws the line for the one card a listing was narrowed to", async () => {
		const { tool, call } = harness();
		await call({ action: "add", title: "Billing webhook accepts orders" });
		const listed = await call({ action: "list", card: "1" });
		const result = { content: [], details: listed.details };
		const collapsed = tool.renderResult(result, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(collapsed).toContain("#1 backlog");
	});
});
