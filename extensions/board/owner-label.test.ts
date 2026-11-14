/**
 * The name a card shows for its owner: the record the session's id carries now, not the label
 * the write left behind — and the name that write leaves when the bus holds no record, which is
 * the first free name the project's team lists before the id-derived one.
 *
 * `tools.test.ts` is named at its height in `test/suite-sizes.test.ts`, so what a `list` says
 * about a holder after that session renamed is proved here. The rule itself — and the page's
 * half of it — is `lib/board/round-text.test.ts`; these cases are the tool's reads and the one
 * fact a read must not quietly write.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardTool } from "../../test/helpers/board.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { agentLabel } from "../../lib/session-label.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;
const PEER_ID = "s-peer";
/** The name the claim writes: what this session's id derives while the bus holds no record. */
const DERIVED = agentLabel(PEER_ID);

/** A board worked as `s-peer`, and the bus record that renames it afterwards. */
function peerBoard() {
	const { board, call } = boardTool({ now: NOW, sessionId: PEER_ID, track: temps.track });
	/** `/team join core-claims`: the record moves, and no card does. */
	const rename = async (label: string) => {
		writeBusRecord(await board.runtime.busDir(board.ctx.cwd), { id: PEER_ID, label, lastSeen: NOW });
	};
	return { board, call, rename };
}

describe("a listing's owner label", () => {
	test("is the record's name, while the card keeps the label its claim wrote", async () => {
		const { board, call, rename } = peerBoard();
		const store = await board.runtime.store(board.ctx.cwd);
		await call({ action: "add", title: "One" });
		const claimed = await call({ action: "claim", card: "1" });
		expect(claimed.details.card?.owner).toEqual({ id: PEER_ID, label: DERIVED });
		await rename("core-claims");
		const listed = await call({ action: "list" });
		expect(resultText(listed)).toContain("· core-claims");
		expect(resultText(listed)).not.toContain(`· ${DERIVED}`);
		expect(listed.details.cards?.[0]?.owner).toEqual({ id: PEER_ID, label: "core-claims" });
		// A read resolves the name and nothing writes it: the file holds the label the claim wrote,
		// at the revision the claim left, so a rename never touches a card.
		const stored = await store.read("1");
		expect(stored?.owner).toEqual({ id: PEER_ID, label: DERIVED });
		expect(stored?.rev).toBe(claimed.details.card?.rev);
	});

	test("is the card's own label when the bus holds no record of the owner", async () => {
		const { call } = boardTool({ now: NOW, sessionId: PEER_ID, track: temps.track });
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		expect(resultText(await call({ action: "list" }))).toContain(`· ${DERIVED}`);
	});

	test("matches a query against the name that answers, so the dead one matches nothing", async () => {
		const { call, rename } = peerBoard();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		await rename("core-claims");
		expect(resultText(await call({ action: "list", query: "core-claims" }))).toContain("#1 plan");
		// The rename is the board saying it no longer answers to that name: a listing that matched the
		// old one would quote a name a send refuses.
		expect(resultText(await call({ action: "list", query: DERIVED }))).toContain("No cards match.");
	});

	test("is the first free name the team lists, before the id-derived one", async () => {
		const { call } = boardTool({
			now: NOW,
			sessionId: PEER_ID,
			lead: "gavin",
			teammates: ["gavin", "tom", "sam"],
			track: temps.track,
		});
		await call({ action: "add", title: "One" });
		const claimed = await call({ action: "claim", card: "1" });
		// `gavin` is the lead's own name, so `tom` is the first this session may take: the card and
		// the join a peer answers are that word, not the id's tail.
		expect(claimed.details.card?.owner).toEqual({ id: PEER_ID, label: "tom" });
		expect(resultText(await call({ action: "list" }))).toContain("· tom");
	});

	test("names an archived card's owner the same way", async () => {
		const { board, call, rename } = peerBoard();
		const store = await board.runtime.store(board.ctx.cwd);
		const card = await store.create({ title: "Shipped", paths: [] }, { id: PEER_ID, label: DERIVED }, NOW);
		await advance(store, card.id, "done", { owner: { id: PEER_ID, label: DERIVED } }, NOW);
		await store.mutate(card.id, { kind: "archive" }, { id: PEER_ID, label: DERIVED }, NOW);
		await rename("core-claims");
		// The pile is read by the same person asking the same question about a name.
		expect(resultText(await call({ action: "list", archived: true }))).toContain("core-claims");
	});
});
