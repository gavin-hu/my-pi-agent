/**
 * The `landed` argument `move` carries (#828): a sha, on a close, and nothing else.
 *
 * Split from `tools.test.ts` rather than grown inside it — that suite is already at its height
 * (1237 lines), which may only fall — and the argument's own boundary is one capability: the tool
 * reads it, refuses a word that is not a sha, refuses it on a move that is not a close, and no
 * other action takes the field at all. The chain's three checks are the rule's
 * (`lib/workflow/landing-declared.test.ts`), and what a close writes is proved there too.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import type { FakeCtxOptions } from "../../test/helpers/context.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** The registered tool and the call it answers, over a board this case owns. */
function harness(options: FakeCtxOptions = {}) {
	const board = boardHarness({ lead: "reviewer", now: NOW, track: temps.track, ...options });
	// A contract names a command, so a spot-check would run one: this answers without a process.
	registerTools(board.fake.pi, board.runtime, {
		verify: async () => ({ exit: 0, output: "", killed: false }),
	});
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		/** Run one action. */
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
			};
		},
	};
}

/** A card in `blocked`, which is where a move that is not a close can land. */
async function blocked(call: ReturnType<typeof harness>["call"]): Promise<void> {
	await call({ action: "add", title: "One" });
	await call({ action: "claim", card: "1" });
}

describe("the landed argument", () => {
	test("is a sha, not a word", async () => {
		const { call } = harness();
		await blocked(call);
		const refused = await call({ action: "move", card: "1", lane: "blocked", blocker: "decision", landed: "main" });
		expect(resultText(refused)).toContain("seven to forty hexadecimal characters");
	});

	test("answers a close, and has nothing to say about a move to another lane", async () => {
		const { call } = harness();
		await blocked(call);
		const refused = await call({ action: "move", card: "1", lane: "blocked", blocker: "decision", landed: "86cb16e" });
		expect(resultText(refused)).toContain("a landing closes a card; it has nothing to say about a move to blocked.");
	});

	test("is a field only `move` reads, so another action carrying it is refused by name", async () => {
		const { call } = harness();
		await blocked(call);
		const refused = await call({ action: "release", card: "1", landed: "86cb16e" });
		expect(resultText(refused)).toContain("release does not act on landed");
	});
});
