/**
 * A card whose recorded plan is gone, through the snapshot the page draws.
 *
 * The face cannot stat anything — the reason body is spliced into the browser — so the fact is the
 * server's: `snapshot.ts` asks `artifact.ts` once per frame and the view puts it on the card. These
 * cases are the whole of that wire, and the signature one is why it exists: a plan removed while
 * the page is open moves no card's revision, so the frame has to move on its own.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardView } from "../../lib/board/view.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { viewOf } from "./snapshot.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;
const ME = { id: "s-lead", label: "billing-lead" };

/** The card `id` as the frame draws it, whichever lane it is in. */
function drawnOf(view: BoardView, id: string): BoardView["lanes"][number]["cards"][number] | undefined {
	return view.lanes.flatMap((lane) => lane.cards).find((card) => card.id === id);
}

describe("a plan that is gone", () => {
	test("reads on the card the page draws, and moves the frame's signature", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const store = await board.runtime.store(board.cwd);
		const planDir = await board.runtime.planDir(board.cwd);
		mkdirSync(planDir, { recursive: true });
		const path = join(planDir, "webhook.md");
		writeFileSync(path, "# Plan\n");
		const card = await store.create({ title: "Planned", paths: [] }, ME, NOW);
		await advance(store, card.id, "execute", { owner: ME, planPath: path }, NOW);
		const snapshot = () => viewOf({ store, actor: () => ME, now: () => NOW, roster: async () => undefined });

		const before = await snapshot();
		expect(drawnOf(before, card.id)?.planGone).toBeUndefined();

		rmSync(path, { force: true });
		const after = await snapshot();
		expect(drawnOf(after, card.id)?.planGone).toBe(true);
		// No card was written, so no revision moved: a frame that did not carry this would leave the
		// tab saying the plan is there until something else happened.
		expect(after.sig).not.toBe(before.sig);
	});

	test("a finished card on a dead plan is history, and draws nothing", async () => {
		// `done` and the pool are not stat'ed: a finished card is finished, and a pooled one re-plans
		// on its next claim, so the answer could not change what a reader does.
		const board = boardHarness({ now: NOW, track: temps.track });
		const store = await board.runtime.store(board.cwd);
		const planDir = await board.runtime.planDir(board.cwd);
		mkdirSync(planDir, { recursive: true });
		const path = join(planDir, "shipped.md");
		writeFileSync(path, "# Plan\n");
		const card = await store.create({ title: "Shipped", paths: [] }, ME, NOW);
		await advance(store, card.id, "done", { owner: ME, planPath: path }, NOW);
		rmSync(path, { force: true });

		const view = await viewOf({ store, actor: () => ME, now: () => NOW, roster: async () => undefined });
		expect(drawnOf(view, card.id)?.lane).toBe("done");
		expect(drawnOf(view, card.id)?.planGone).toBeUndefined();
	});
});
