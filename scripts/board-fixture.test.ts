/**
 * The board a capture seeds.
 *
 * `seedStore` goes through the shipped gates — plans written where the records name them,
 * `contract`/`approve`/`move` handed the proof the doors hand them, `announced` after every
 * sign — so this is the one check that the fixture's specs are a board the tools would accept.
 * It used to be nobody's job: the seed ignored a refusal and the page photographed seven
 * unassigned cards after the plan gate learned to prove the file.
 *
 * Both stores are temp directories, so a red here is a fact about the fixture and never about
 * this machine's board or plan store.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { formatCard } from "../extensions/board/format.ts";
import { createStore } from "../lib/board/store.ts";
import { isInside } from "../lib/path.ts";
import { resolvePlanArg } from "../lib/plans/paths.ts";
import { fixturePlanDir } from "./tools/fixtures/board.ts";
import { seedStore } from "./tools/fixtures/board-store.ts";

/** A fixed clock, so two seeds of one board are the same board. */
const NOW = 1_760_000_000_000;

/** A board and a plan store of the fixture's own, both under the temp directory. */
function tempDirs(): { board: string; plans: string } {
	return {
		board: mkdtempSync(join(tmpdir(), "pi-board-seed-")),
		plans: join(mkdtempSync(join(tmpdir(), "pi-board-seed-plans-")), "plans", basename(fixturePlanDir())),
	};
}

describe("the board fixture's seed", () => {
	test("seeds every lane, owner, plan and sign the specs name", async () => {
		const { board, plans } = tempDirs();
		try {
			const seeded = await seedStore(board, plans, NOW);
			const cards = await createStore(board, {}).list();
			// Lane order, then id: the page's trays, read as data.
			expect(cards.map((card) => [card.id, card.lane])).toEqual([
				["6", "backlog"],
				["7", "backlog"],
				["3", "plan"],
				["2", "execute"],
				["1", "execute"],
				["4", "blocked"],
				["5", "done"],
			]);
			expect(cards.map((card) => card.owner?.label)).toEqual([
				undefined,
				undefined,
				"billing-core",
				"billing-core",
				"billing-core",
				"billing-core",
				"billing-other",
			]);
			// Four plans, each written where its record says and nowhere else.
			expect(seeded.plans.length).toBe(4);
			for (const file of seeded.plans) expect(isInside(plans, file), file).toBe(true);
			const recorded = cards.flatMap((card) => (card.planPath === undefined ? [] : [card.planPath]));
			expect(recorded.length).toBe(4);
			expect(new Set(recorded).size, "two cards share a plan").toBe(4);
			for (const path of recorded) expect(isInside(plans, resolvePlanArg(plans, path)), path).toBe(true);
			// The sign one card's owner never heard, and no other: the face draws ` · not told` off it.
			expect(cards.filter((card) => formatCard(card).includes("not told")).map((card) => card.id)).toEqual(["1"]);
		} finally {
			rmSync(board, { recursive: true, force: true });
			rmSync(join(plans, "..", ".."), { recursive: true, force: true });
		}
	});
});
