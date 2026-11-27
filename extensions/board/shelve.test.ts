/**
 * `shelve` and `unshelve` through the tool: what a caller sees, and what the round says next.
 *
 * The operation's gates and its clearing are `lib/workflow/shelved.test.ts`; what is here is the
 * wiring — the two verbs are published, the bound a person writes reaches the record as a moment,
 * and the board's own read is where the shelf becomes a count a lead acts on. The action lives in
 * its own suite because `tools.test.ts` is named at its height in `test/suite-sizes.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardTool } from "../../test/helpers/board.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;
const DAY = 86_400_000;

/** A tool on a board of its own, and one card in the pool. */
async function pooled() {
	const harness = boardTool({ now: NOW, track: temps.track });
	const added = await harness.call({ action: "add", title: "Pin the wasm build", paths: ["src/wasm"] });
	return { ...harness, id: added.details.card?.id ?? "" };
}

describe("shelve", () => {
	test("sets a pool card aside, and the row says why", async () => {
		const { call, id } = await pooled();
		const result = await call({ action: "shelve", card: id, note: "waiting on pi 1.7 to publish" });
		expect(result.details.error).toBeUndefined();
		expect(result.details.card?.lane).toBe("backlog");
		expect(result.details.card?.shelved).toEqual({
			at: NOW,
			by: result.details.me.label,
			note: "waiting on pi 1.7 to publish",
		});
		// The card is still on the board, and the reason is on the line a reader gets.
		expect(resultText(result)).toContain(`shelved: waiting on pi 1.7 to publish`);
		expect(resultText(await call({ action: "list" }))).toContain(`shelved: waiting on pi 1.7 to publish`);
	});

	test("records the bound a person wrote as a moment, not as a spelling", async () => {
		const { call, id } = await pooled();
		const result = await call({ action: "shelve", card: id, note: "until the release", until: "30d" });
		expect(result.details.card?.shelved?.until).toBe(NOW + 30 * DAY);
		expect(resultText(await call({ action: "list", card: id }))).toContain("due in 30d");
	});

	test("refuses a bound it cannot read, and says nothing was shelved", async () => {
		const { call, id } = await pooled();
		const result = await call({ action: "shelve", card: id, note: "later", until: "30" });
		expect(result.details.error).toBe('"30" is not an age — write one like 30d, 12h, or 90m. Nothing was shelved.');
		// Refused before the write: the card reads exactly as it did.
		expect((await call({ action: "list", card: id })).details.card?.shelved).toBeUndefined();
	});

	test("refuses a one-line reason a row cannot hold", async () => {
		const { call, id } = await pooled();
		const result = await call({ action: "shelve", card: id, note: "x".repeat(201) });
		expect(result.details.error).toContain("the limit is 200");
	});

	test("refuses a card somebody holds, and names the way back to the pool", async () => {
		const { call, id } = await pooled();
		await call({ action: "claim", card: id });
		const result = await call({ action: "shelve", card: id, note: "later" });
		expect(result.details.error).toBe(
			`#${id} is in plan; only a pool card can be shelved — \`board release ${id}\` puts it back.`,
		);
	});
});

describe("the shelf in the round", () => {
	test("counts it apart from unassigned, and prints it beside the pool", async () => {
		const { call, id } = await pooled();
		await call({ action: "add", title: "Retry the gateway" });
		await call({ action: "shelve", card: id, note: "waiting on the release" });
		const listed = await call({ action: "list", round: true });
		expect(listed.details.round?.shelved.map((card) => card.id)).toEqual([id]);
		expect(listed.details.round?.unassigned.map((card) => card.id)).toEqual(["2"]);
		const text = resultText(listed);
		expect(text).toContain("1 unassigned · 1 shelved");
		expect(text).toContain(`shelved (1): #${id} backlog`);
	});

	test("unshelve puts it back, and a claim clears it too", async () => {
		const { call, id } = await pooled();
		await call({ action: "shelve", card: id, note: "not now" });
		const back = await call({ action: "unshelve", card: id });
		expect(back.details.card?.shelved).toBeUndefined();
		expect(back.details.card?.lane).toBe("backlog");
		// Taken is the same answer: a claimed card belongs to somebody, and the shelf said nobody's.
		await call({ action: "shelve", card: id, note: "not now" });
		expect((await call({ action: "claim", card: id })).details.card?.shelved).toBeUndefined();
	});
});
