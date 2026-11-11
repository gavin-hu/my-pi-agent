/**
 * The two signs, over the tool: the note each one carries, and where it lands.
 *
 * The state machine's answer is `lib/board/signs.test.ts`; what this suite proves is the
 * wiring a model sees — that `text` reaches `approve` and `review` at all, that the note is
 * on the card the result returns, and that a signer's caveat does not stand in the way of the
 * move the sign unlocked. It is its own suite because `tools.test.ts` is named at its height
 * in `test/suite-sizes.test.ts`, and a named suite may not gain a line.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { cardFile } from "../../test/helpers/board.ts";
import {
	signBus as bus,
	bench,
	claimedWithContract,
	flushFixture,
	LEAD,
	NOW,
	onBus,
	PEER,
	PEER_ID,
	type Sent,
	type Session,
} from "../../test/helpers/board-signs.ts";
import { presetNameFor } from "../../lib/session-label.ts";
import type { Notify } from "./announce.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";

afterAll(flushFixture);

describe("a sign's note", () => {
	test("approve records what the lead saw, in the same write", async () => {
		const board = bench();
		await claimedWithContract(board);
		const signed = await board.lead.call({ action: "approve", card: "1", text: "The scope out is doing real work." });
		expect(signed.details.card?.contract?.approved?.by).toBe(LEAD);
		expect(signed.details.card?.notes.at(-1)).toMatchObject({ by: LEAD, text: "The scope out is doing real work." });
	});

	test("review records what the lead checked, and the card can still be finished", async () => {
		const board = bench();
		await claimedWithContract(board);
		await board.lead.call({ action: "approve", card: "1" });
		await board.peer.call({ action: "move", card: "1", lane: "execute" });
		const checked = await board.lead.call({ action: "review", card: "1", text: "Checked: the gate bites." });
		expect(checked.details.card?.review?.by).toBe(LEAD);
		expect(checked.details.card?.notes.at(-1)).toMatchObject({ by: LEAD, text: "Checked: the gate bites." });
		expect((await board.peer.call({ action: "move", card: "1", lane: "done" })).details.card?.lane).toBe("done");
	});
});

describe("an approval covers the plan", () => {
	test("refuses the card whose plan is gone, before the move that would say so", async () => {
		const board = bench();
		await claimedWithContract(board);
		const listed = await board.lead.call({ action: "list", card: "1" });
		const plan = listed.details.card?.planPath;
		if (plan === undefined) throw new Error("the contract recorded no plan");
		// The file the wording is executed against is deleted underneath the card: the approval is
		// the first door that can say so, and it says what the move would have said later.
		rmSync(plan);
		const refused = await board.lead.call({ action: "approve", card: "1" });
		expect(refused.isError).toBe(true);
		expect(refused.details.error).toContain("is gone");
		// And nothing was signed: the refusal half-applies nothing.
		expect((await board.lead.call({ action: "list", card: "1" })).details.card?.contract?.approved).toBeUndefined();
	});
});

describe("a sign tells the other side", () => {
	test("approve sends the owner one event: who signed, and the lane it opened", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		const signed = await board.lead.call({ action: "approve", card: "1" });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.kind).toBe("event");
		expect(sent[0]?.to).toBe("s-peer");
		expect(sent[0]?.text ?? "").toContain(`approved by ${LEAD}`);
		expect(sent[0]?.text ?? "").toContain('lane "execute"');
		expect(resultText(signed)).toContain(`told ${signed.details.card?.owner?.label}`);
		// The same sentence without the text's continuation indent, so the transcript block draws
		// it instead of dropping the one fact the bus produced.
		expect(signed.details.told).toBe(`told ${signed.details.card?.owner?.label}`);
	});

	test("review names the lane that finishing the card needs", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		await board.lead.call({ action: "approve", card: "1" });
		await board.peer.call({ action: "move", card: "1", lane: "execute" });
		sent.length = 0;
		await board.lead.call({ action: "review", card: "1" });
		expect(sent[0]?.text ?? "").toContain(`spot-checked by ${LEAD}`);
		expect(sent[0]?.text ?? "").toContain('lane "done"');
	});

	test("a repeated sign writes nothing, so the owner is not told twice", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		await board.lead.call({ action: "approve", card: "1" });
		sent.length = 0;
		const again = await board.lead.call({ action: "approve", card: "1" });
		expect(again.details.card?.contract?.approved?.by).toBe(LEAD);
		expect(sent).toHaveLength(0);
		// Nothing was said, so there is no line for the block to draw.
		expect(again.details.told).toBeUndefined();
	});

	test("a bus that cannot answer costs a line on the result, never the signature", async () => {
		const board = bench({ notify: bus({ fail: "the session bus is not loaded" }) });
		await claimedWithContract(board);
		const signed = await board.lead.call({ action: "approve", card: "1" });
		expect(signed.isError).toBeFalsy();
		expect(signed.details.card?.contract?.approved?.by).toBe(LEAD);
		expect(resultText(signed)).toContain("was not told (the session bus is not loaded)");
		expect(signed.details.told).toContain("was not told (the session bus is not loaded)");
	});

	test("says the owner is not listening, which is the one thing a lead can act on", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		// The page's Team tab already draws this, and the handoff reports it: a watch that is off
		// means mail waits for the owner's next turn instead of raising one.
		await onBus(board.peer, { id: PEER_ID, label: PEER, watching: { armed: false, wake: false } });
		const signed = await board.lead.call({ action: "approve", card: "1" });
		expect(signed.details.told).toBe(`told ${PEER} (not listening: it reads this at its next turn)`);
		expect(sent).toHaveLength(1);
	});

	test("a sign the owner never heard is sent again when its signer says it again", async () => {
		// A bus that fails once, then answers: the first send left the sign unstamped, and the repeat
		// is the only thing that can put the message on the wire again.
		const sent: Sent[] = [];
		let failed = false;
		const notify: Notify = async (_ctx, input) => {
			if (!failed) {
				failed = true;
				return { ok: false, error: "the session bus is not loaded" };
			}
			sent.push(input);
			return { ok: true, delivered: [presetNameFor(input.to) ?? input.to], failed: [] };
		};
		const board = bench({ notify });
		await claimedWithContract(board);
		const first = await board.lead.call({ action: "approve", card: "1" });
		expect(resultText(first)).toContain("was not told");
		expect(first.details.card?.contract?.approved?.told).toBeUndefined();

		const again = await board.lead.call({ action: "approve", card: "1" });
		// No second stamp: the same sign, announcing itself — and now the card says it was heard.
		expect(again.details.card?.contract?.approved?.at).toBe(first.details.card?.contract?.approved?.at);
		expect(sent).toHaveLength(1);
		expect(again.details.told).toContain("told ");
		expect(again.details.card?.contract?.approved?.told).toEqual({ at: NOW });

		// Told once is told: a third call writes nothing and says nothing.
		sent.length = 0;
		const third = await board.lead.call({ action: "approve", card: "1" });
		expect(sent).toHaveLength(0);
		expect(third.details.told).toBeUndefined();
	});

	test("says the owner is quiet, because a wrote message is not a heard one", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		// A heartbeat past the bus's window: the file is written, and nothing says the session is
		// still there to read it.
		await onBus(board.peer, { id: PEER_ID, label: PEER }, NOW - 11 * 60_000);
		const signed = await board.lead.call({ action: "approve", card: "1" });
		expect(signed.details.told).toBe(`told ${PEER} (quiet: nothing says it is still there)`);
		expect(sent).toHaveLength(1);
	});

	test("reaches the session that holds the label when the card's id names nobody", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent, delivered: PEER }) });
		await claimedWithContract(board);
		// The holder's process is gone and a later session took its name. The bus refuses an
		// unknown id rather than trying the label, so the roster is the only way there.
		await onBus(board.lead, { id: "s-new", label: PEER, watching: { armed: true, wake: false } });
		const signed = await board.lead.call({ action: "approve", card: "1" });
		expect(sent[0]?.to).toBe("s-new");
		expect(signed.details.told).toBe(`told ${PEER}`);
	});

	test("a repeated sign that only added a note says nothing", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await claimedWithContract(board);
		await board.lead.call({ action: "approve", card: "1" });
		sent.length = 0;
		const again = await board.lead.call({ action: "approve", card: "1", text: "Read it again; still fine." });
		// The note landed, so the card moved — but the signature did not, and the message a sign
		// sends is about the stamp rather than about the file.
		expect(again.details.card?.notes.at(-1)?.text).toBe("Read it again; still fine.");
		expect(sent).toHaveLength(0);
		expect(again.details.told).toBeUndefined();
	});
});

describe("a close made by instruction", () => {
	/** A card finished through the gate with its sign taken back off: what a close outside it leaves on disk. */
	async function closedByHand(who: { lead: Session; peer: Session }): Promise<void> {
		await claimedWithContract(who);
		await who.lead.call({ action: "approve", card: "1" });
		await who.peer.call({ action: "move", card: "1", lane: "execute" });
		await who.lead.call({ action: "review", card: "1" });
		await who.peer.call({ action: "move", card: "1", lane: "done" });
		const file = cardFile(who.peer.board.agentDir, "1");
		const card = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		delete card.review;
		writeFileSync(file, JSON.stringify(card));
	}

	test("signs a finished card, and both the result and the owner say how it was closed", async () => {
		const sent: Sent[] = [];
		const board = bench({ notify: bus({ sent }) });
		await closedByHand(board);
		sent.length = 0;
		const signed = await board.lead.call({ action: "review", card: "1", override: "Closed on my instruction." });
		expect(signed.isError).toBeFalsy();
		expect(signed.details.card?.review).toMatchObject({ by: LEAD, byInstruction: "Closed on my instruction." });
		expect(resultText(signed)).toContain(`reviewed: ${LEAD} · by instruction: Closed on my instruction.`);
		// The owner hears the close it can act on, and not the move it can no longer make.
		expect(sent[0]?.text ?? "").toContain("closed by instruction");
		expect(sent[0]?.text ?? "").not.toContain('lane "done"');
	});

	test("refuses it without a reason, and never over a sign that is already there", async () => {
		const board = bench();
		await closedByHand(board);
		expect(resultText(await board.lead.call({ action: "review", card: "1", override: "   " }))).toContain(
			"override needs the one line saying why.",
		);
		// A card that finished through the gate keeps the sign it was given: an override records a
		// close that happened, not a second signature on one that did not.
		const gated = bench();
		await claimedWithContract(gated);
		await gated.lead.call({ action: "approve", card: "1" });
		await gated.peer.call({ action: "move", card: "1", lane: "execute" });
		await gated.lead.call({ action: "review", card: "1" });
		await gated.peer.call({ action: "move", card: "1", lane: "done" });
		expect(
			resultText(await gated.lead.call({ action: "review", card: "1", override: "closed on my instruction" })),
		).toContain(`already spot-checked by ${LEAD}`);
	});
});
