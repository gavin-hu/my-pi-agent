/**
 * Whose name a holder's sentence prints: the bus's, not the one the card's record kept.
 *
 * One session id can answer to more than one name over its life — a card recorded `billing-core`
 * when it was claimed, the bus shows the same id as `renamed-core` now — and the sentences that
 * name a holder are where a reader decides whether the holder is alive. #847 was refused a `done`
 * with *"held by mike"* for a session the bus called `bob`, and the door had admitted it: the id was
 * right and the name was history.
 *
 * The mismatched pair is the fixture, and what a case asserts is which of the two names a reader
 * sees. Nothing stored is rewritten, so the record keeps its label as the fallback for an id the bus
 * has dropped.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { writeJoinedRecord } from "../../test/helpers/bus.ts";
import { agentLabel } from "../../lib/session-label.ts";
import { mutate } from "./write.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const NOW = 100_000;
const CORE = "s-core";
const CORE_NAME = agentLabel(CORE);

/** A registered tool, its board, and the two reads a case makes: `call`, and the store behind it. */
function harness() {
	const board = boardHarness({ lead: agentLabel("s-lead"), now: NOW });
	registerTools(board.fake.pi, board.runtime, { verify: async () => ({ exit: 0, output: "", killed: false }) });
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		ctx: board.ctx,
		runtime: board.runtime,
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		},
		/** The bus's record for one id, under a name the card's record does not know. */
		async rename(id: string, label: string) {
			await writeJoinedRecord(await board.runtime.busDir(board.ctx.cwd), { id, label, lastSeen: NOW });
		},
	};
}

const temps = { flush: () => undefined };
afterAll(() => temps.flush());

describe("a holder's name", () => {
	/** The card is claimed by `billing-core`, and the bus calls that id `renamed-core`. */
	test("a refusal names the bus's label for the id, not the record's", async () => {
		const board = harness();
		const store = await board.runtime.store(board.ctx.cwd);
		const core = { id: CORE, label: CORE_NAME };
		const card = await store.create(
			{ title: "a card", paths: [], type: "bug", breaking: false, priority: "normal" },
			core,
			NOW,
		);
		await store.mutate(card.id, { kind: "claim" }, core, NOW);
		await board.rename(CORE, "renamed-core");

		// The lead may not move another session's card anywhere but the two doors it owns, so this is
		// the sentence #847 met: the holder is alive under a name the record has never heard.
		const refused = await board.call({ action: "move", card: card.id, lane: "blocked", blocker: "decision" });
		expect(refused.isError).toBe(true);
		expect(refused.content[0].text).toContain("is held by renamed-core.");
		// And nothing was rewritten: the record keeps the name its claim captured.
		expect((await store.read(card.id))?.owner).toEqual(core);
	});

	test("falls back to the record's label when the bus has no record of the id", async () => {
		const board = harness();
		const store = await board.runtime.store(board.ctx.cwd);
		const core = { id: CORE, label: CORE_NAME };
		const card = await store.create(
			{ title: "a card", paths: [], type: "bug", breaking: false, priority: "normal" },
			core,
			NOW,
		);
		await store.mutate(card.id, { kind: "claim" }, core, NOW);
		const refused = await board.call({ action: "move", card: card.id, lane: "blocked", blocker: "decision" });
		expect(refused.content[0].text).toContain(`is held by ${CORE_NAME}.`);
	});

	/** The row a write returns is a reading too: it prints the name it is handed. */
	test("the row a write returns names the holder the caller resolved, and stores nothing", async () => {
		const board = harness();
		const store = await board.runtime.store(board.ctx.cwd);
		const me = await board.runtime.who(board.ctx, board.ctx.cwd);
		const card = await store.create(
			{ title: "a card", paths: [], type: "bug", breaking: false, priority: "normal" },
			me,
			NOW,
		);
		await store.mutate(card.id, { kind: "claim" }, me, NOW);
		const written = await mutate(
			store,
			"note",
			me,
			NOW,
			{ action: "note", card: card.id, note: "one line" },
			{ kind: "note", text: "one line" },
			{ ownerLabel: "renamed-lead" },
		);
		expect(written.content[0].text).toContain("owner: renamed-lead");
		expect((await store.read(card.id))?.owner?.label).toBe(me.label);
	});
});
