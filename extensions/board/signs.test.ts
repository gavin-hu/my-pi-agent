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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { boardHarness, cardFile } from "../../test/helpers/board.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { presetNameFor } from "../../lib/session-label.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const LEAD_ID = "s-lead";
/** The name a session with that id joins under, which is the label the board signs with. */
const LEAD = presetNameFor(LEAD_ID) ?? LEAD_ID;
const NOW = 50_000;

/** The board tool's dependency seam, as `registerTools` takes it. */
type BoardDeps = NonNullable<Parameters<typeof registerTools>[2]>;

/** The bus a sign sends on, as that seam describes it. */
type Notify = NonNullable<BoardDeps["notify"]>;

/** One message the tool sent, which is what a case asks about. */
interface Sent {
	kind: "event";
	to: string;
	text: string;
}

/** The bus, recorded: what a sign sent, or the sentence a bus that cannot answer gives. */
function bus(options: { sent?: Sent[]; fail?: string } = {}): Notify {
	return async (_ctx, input) => {
		if (options.fail !== undefined) return { ok: false, error: options.fail };
		options.sent?.push(input);
		return { ok: true, delivered: [input.to], failed: [] };
	};
}

/** One repository, its agent directory, and the two sessions that act on one board. */
function bench(deps: BoardDeps = {}): { lead: Session; peer: Session } {
	const cwd = temps.track(tempDir("pi-repo-"));
	const agentDir = temps.track(tempDir("pi-agent-"));
	return {
		lead: session({ cwd, agentDir, sessionId: LEAD_ID, deps }),
		peer: session({ cwd, agentDir, sessionId: "s-peer", deps }),
	};
}

/** One session on the bench's board, and the one action call a case needs. */
function session(options: { cwd: string; agentDir: string; sessionId: string; deps?: BoardDeps }) {
	const { deps, ...rest } = options;
	const board = boardHarness({ ...rest, lead: LEAD, now: NOW });
	registerTools(board.fake.pi, board.runtime, deps);
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		board,
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		},
	};
}

type Session = ReturnType<typeof session>;

/** A plan file in this repository's store, which is the only path `contract` takes. */
async function writePlan(who: Session): Promise<string> {
	const dir = await who.board.runtime.planDir(who.board.ctx.cwd);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "one.md");
	writeFileSync(path, "# One\n");
	return path;
}

/** A card claimed by the peer, its contract written — the state a sign acts on. */
async function claimedWithContract(who: { lead: Session; peer: Session }): Promise<void> {
	await who.peer.call({ action: "add", title: "One" });
	await who.peer.call({ action: "claim", card: "1" });
	await who.peer.call({
		action: "contract",
		card: "1",
		path: await writePlan(who.peer),
		goal: "g",
		acceptance: "a",
		scopeOut: "s",
	});
}

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
