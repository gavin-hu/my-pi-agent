/**
 * A rollup asked for beside a listing: two answers in one result, in the order they were asked.
 *
 * `tools.test.ts` is named at its height in `test/suite-sizes.test.ts`, so what a narrowed
 * listing keeps when `round` rides along is proved here — the slice in the text, the whole
 * board's rollup after it, and the details carrying both. How the rows draw the pair is
 * `result.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { Actor } from "../../lib/board/rules.ts";
import { boardTool } from "../../test/helpers/board.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/** A session that is not this one: the card it holds is what a `mine` listing must not show. */
const PEER: Actor = { id: "s-peer", label: "api-core" };

/** A card the peer holds: written straight to the store, so the board has an owner besides this session. */
async function peerCard(board: ReturnType<typeof boardTool>["board"], title: string): Promise<void> {
	const store = await board.runtime.store(board.ctx.cwd);
	const card = await store.create({ title, paths: [] }, PEER, NOW);
	await advance(store, card.id, "plan", { owner: PEER }, NOW);
}

/** The two halves one result carries: the listing, and the rollup printed after it. */
function halves(text: string): { listing: string; rollup: string } {
	const [listing = "", ...rest] = text.split("\n\n");
	return { listing, rollup: rest.join("\n\n") };
}

describe("a listing with a rollup", () => {
	test("counts the finished cards the listing leaves out", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "Open one" });
		await call({ action: "add", title: "Finished one" });
		await advance(await board.runtime.store(board.ctx.cwd), "2", "done", { owner: PEER }, NOW);
		const result = await call({ action: "list", round: true });
		expect(result.details.round?.done.map((card) => card.id)).toEqual(["2"]);
		expect(resultText(result)).toContain("2 features");
	});

	test("keeps the cards its filter chose, and follows them with the whole board", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "Mine one" });
		await call({ action: "claim", card: "1" });
		await peerCard(board, "Peer one");

		const result = await call({ action: "list", mine: true, round: true });
		const { listing, rollup } = halves(resultText(result));
		// The listing is the slice that was asked for; the peer's card reaches only the rollup,
		// which is the whole board's answer and says so.
		expect(listing).toStartWith("#1 plan · Mine one");
		expect(listing).not.toContain(PEER.label);
		expect(rollup).toContain(PEER.label);
		expect(rollup).toContain("2 features");
		expect(result.details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect(result.details.narrowed).toBe(true);
		expect(result.details.round?.owners.map((group) => group.label)).toContain(PEER.label);
	});

	test("says a filter matched nothing instead of calling the board empty", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "One" });
		await peerCard(board, "Peer one");

		const result = await call({ action: "list", query: "zzz", round: true });
		const { listing, rollup } = halves(resultText(result));
		// The board has two cards, so "The board is empty." would contradict the rollup under it.
		expect(listing).toBe("No cards match.");
		expect(rollup).toContain(PEER.label);
		expect(rollup).toContain("2 features");
		expect(result.details.cards).toEqual([]);
		expect(result.details.narrowed).toBe(true);
	});

	test("says no open card matched, when the one that did is finished", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "Open one" });
		await call({ action: "add", title: "Finished one" });
		await advance(await board.runtime.store(board.ctx.cwd), "2", "done", { owner: PEER }, NOW);

		const result = await call({ action: "list", query: "Finished" });
		// A filter answered with nothing by the lane rule is not a filter that matched nothing: the
		// count under this line names the card it found, and the old wording contradicted it.
		expect(resultText(result)).toBe('No open cards match.\n1 done card hidden; pass lane: "done" to read it.');
		expect(result.details.cards).toEqual([]);
		expect(result.details.narrowed).toBe(true);
	});

	test("a round with no filter lists the board, then the rollup", async () => {
		const { board, call } = boardTool({ now: NOW, track: temps.track });
		await call({ action: "add", title: "One" });
		await peerCard(board, "Peer one");

		const result = await call({ action: "list", round: true });
		const { listing, rollup } = halves(resultText(result));
		expect(listing).toContain("One");
		expect(listing).toContain("Peer one");
		expect(rollup).toContain("2 features");
		// Nothing was narrowed, so the rows have no slice to draw above the rollup.
		expect(result.details.narrowed).toBeUndefined();
	});
});
