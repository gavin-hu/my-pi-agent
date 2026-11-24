/**
 * `/board`'s lead gate: the three words that write, and the sessions they are not for.
 *
 * A sign and a sweep are read off the label of the session that typed the line — the page's session
 * is the lead — and a board naming no lead keeps the person's sign as its only door. What is pinned
 * here is the refusal itself: the sentence, the write that did not happen, and the run that started
 * no process. The line a sign prints belongs to `sign.test.ts`, and the sweep's own report to
 * `record.test.ts`.
 *
 * The seat's own two refusals live here as well — a claim, and `execute` on a card the seat holds —
 * because they are the same question one level down: what a session may do with a card it is not
 * able to work. They are driven through the `board` tool, since the verdicts sit in the state machine
 * and every door inherits them.
 */

import { describe, expect, test } from "bun:test";
import { advance } from "../../test/helpers/board-flow.ts";
import { runner } from "../../test/helpers/board-signs.ts";
import { executableWith, SIGNING_LEAD, signingBoard } from "../../test/helpers/board-command.ts";
import { boardTool } from "../../test/helpers/board.ts";
import { boardCard, resultText } from "../../test/helpers/fixtures/board.ts";
import { mayMove, seatCannot } from "../../lib/workflow/lead.ts";
import { modeRefusal } from "../../lib/mode-entry.ts";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";

/** The branch a session holding the seat carries, as the actor's `seat` fact is read off it. */
const SEAT = [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }];

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

describe("the seat's own work", () => {
	/** A seat in a temp board: the tool the model calls, and the store behind it. */
	async function seated() {
		const tool = boardTool({ branch: SEAT, now: 1_000 });
		const store = await tool.board.runtime.store(tool.board.ctx.cwd);
		return { tool, store };
	}

	test("refuses a claim, and takes nothing", async () => {
		const { tool, store } = await seated();
		const card = await store.create({ title: "Somebody's work", paths: [] }, { id: "peer", label: "api-core" }, 1_000);
		const text = resultText(await tool.call({ action: "claim", card: card.id }));
		expect(text).toContain("Lead mode holds the seat: `/board exit` before taking a card.");
		const after = await store.read(card.id);
		expect(after?.lane).toBe("backlog");
		expect(after?.owner).toBeUndefined();
		// The refusal wrote nothing, so the same card is still there for a session that can work it.
		await store.mutate(card.id, { kind: "claim" }, { id: "peer", label: "api-core" }, 1_000);
		expect((await store.read(card.id))?.owner?.label).toBe("api-core");
	});

	test("refuses opening execute on a card the seat holds, and leaves it in plan", async () => {
		const { tool, store } = await seated();
		const holder = { id: "s-lead", label: "gavin" };
		const card = await store.create({ title: "Claimed before the seat", paths: [] }, holder, 1_000);
		await store.mutate(card.id, { kind: "claim" }, holder, 1_000);
		const text = resultText(await tool.call({ action: "move", card: card.id, lane: "execute" }));
		expect(text).toContain("before opening `execute` on a card this session holds");
		const after = await store.read(card.id);
		expect(after?.lane).toBe("plan");
		// A refused lane change claims nothing: the card's paths are the ones it recorded.
		expect(after?.paths).toEqual([]);
	});

	test("keeps the seat's one move open: execute on a card it does not hold", () => {
		const card = boardCard("4", { lane: "plan", owner: { id: "peer", label: "api-core" } });
		expect(mayMove(card, { id: "s-lead", label: "gavin", seat: true }, "execute", "gavin")).toBeUndefined();
	});

	test("writes the seat's sentence the way the mode's owner writes it", () => {
		// The duplication is priced by board's static graph (64/64, with `mode-entry.ts` outside it);
		// this case is what keeps the copy from drifting away from the owner.
		expect(seatCannot("taking a card")).toBe(modeRefusal("lead", "taking a card"));
	});
});
