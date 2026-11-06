/**
 * A card id as a caller writes it: `4`, `#4`, and the file name's own `0004`.
 *
 * The id a record carries is unpadded — the *file name* is what pads to four digits — so a
 * padded spelling that reached a comparison unchanged missed the board's own listing while
 * the store's read, which pads the name back up, found the card: two reads by id, two
 * contradictory answers, and nothing written that could self-correct.
 *
 * `tools.test.ts` is named at its height in `test/suite-sizes.test.ts`, so the spelling is
 * proved here. What a card reads as is `result.test.ts`; the rule itself is `card.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardTool } from "../../test/helpers/board.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 60_000;

/** The lane a seeded card reaches, through the gate, on this board. */
async function seed(board: ReturnType<typeof boardTool>["board"], id: string, lane: "done"): Promise<void> {
	const store = await board.runtime.store(board.ctx.cwd);
	const me = await board.runtime.who(board.ctx, board.ctx.cwd);
	await advance(store, id, lane, { owner: me }, NOW);
}

describe("a zero-padded card id", () => {
	test("reads the card its digits name, from the board and from the archive", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "Open one" });
		await call({ action: "add", title: "Finished one" });
		await seed(board, "2", "done");
		const open = await call({ action: "list", card: "0001" });
		expect(open.details.card?.id).toBe("1");
		expect(resultText(open)).toContain("#1 backlog · Open one");
		// One answer, whichever pile was asked about: card 1 is on the board.
		expect((await call({ action: "list", archived: true, card: "0001" })).details.error).toBe(
			"#1 is on the board, not in the archive.",
		);
		await call({ action: "archive", card: "2" });
		const aside = await call({ action: "list", archived: true, card: "0002" });
		expect(aside.details.card?.id).toBe("2");
		expect(resultText(aside)).toContain("#2 done · Finished one");
		// And the board answers with the archive's own sentence, rather than denying it is there.
		expect((await call({ action: "list", card: "0002" })).details.error).toBe(
			"#2 is archived; pass archived: true to read it.",
		);
	});

	test("writes the card its digits name", async () => {
		const { call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "One" });
		const noted = await call({ action: "note", card: "#0001", text: "padded" });
		expect(noted.details.card?.id).toBe("1");
		expect(noted.details.card?.notes.at(-1)?.text).toBe("padded");
	});
});
