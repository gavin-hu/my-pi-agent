/**
 * `/board`'s lead gate: the three words that write, and the sessions they are not for.
 *
 * A sign and a sweep are read off the label of the session that typed the line — the page's session
 * is the lead — and a board naming no lead keeps the person's sign as its only door. What is pinned
 * here is the refusal itself: the sentence, the write that did not happen, and the run that started
 * no process. The line a sign prints belongs to `sign.test.ts`, and the sweep's own report to
 * `record.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { advance } from "../../test/helpers/board-flow.ts";
import { runner } from "../../test/helpers/board-signs.ts";
import { executableWith, SIGNING_LEAD, signingBoard } from "../../test/helpers/board-command.ts";

/** The four lines a contract carries, as the door reads them. */
const LINES = { goal: "g", acceptance: "a", scopeOut: "s", verify: "bun run check" };

/** What a peer session is told, in the one sentence all three words share. */
function refused(word: string): string {
	return `board: /board ${word} is the lead's: this session is api-core and team.lead is ${SIGNING_LEAD} — ask ${SIGNING_LEAD} with \`session send\``;
}

describe("/board's lead gate", () => {
	test("refuses an approval typed where the lead is not, and writes nothing", async () => {
		const board = await signingBoard({ seat: "api-core" });
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { record: board.plan }, ...LINES },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe(refused("approve"));
		expect((await board.store.read(board.id))?.contract?.approved).toBeUndefined();
		board.temps.flush();
	});

	test("starts no process for a spot-check it refuses", async () => {
		const run = runner();
		const board = await signingBoard({ seat: "api-core", verify: run });
		await executableWith(board);
		expect(await board.say("review 1")).toBe(refused("review"));
		// The one fact a sentence cannot prove: the gate stands before the run, so a refused signer
		// costs no process and writes no evidence.
		expect(run.ran).toEqual([]);
		expect((await board.store.read(board.id))?.review).toBeUndefined();
		board.temps.flush();
	});

	test("refuses the sweep typed where the lead is not, and folds nothing away", async () => {
		const board = await signingBoard({ seat: "api-core" });
		const finished = await board.store.create({ title: "Finished", paths: [] }, board.me, 1_000);
		await advance(board.store, finished.id, "done", { owner: board.me }, 1_000);
		expect(await board.say("archive")).toBe(refused("archive"));
		expect((await board.store.list()).map((card) => card.id)).toContain(finished.id);
		board.temps.flush();
	});

	test("sweeps as the person on a board that names no lead", async () => {
		const board = await signingBoard({ lead: "" });
		const finished = await board.store.create({ title: "Finished", paths: [] }, board.me, 1_000);
		await advance(board.store, finished.id, "done", { owner: board.me }, 1_000);
		// The same word, the one board with no lead to check: the person is every actor it has.
		expect(await board.say("archive")).toContain(`1 card archived: #${finished.id}`);
		expect((await board.store.list()).map((card) => card.id)).not.toContain(finished.id);
		board.temps.flush();
	});
});
