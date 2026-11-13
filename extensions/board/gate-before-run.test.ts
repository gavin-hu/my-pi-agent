/**
 * A spot-check's gate decides before its command runs.
 *
 * `lib/board/verify.test.ts` proves what a run records; what this suite proves is the order — that
 * the lane, the holder and the signer are asked *before* the shell a contract names is started, so
 * a sign that will be refused spends no process getting there, and that an override on a card whose
 * contract names a command signs with nothing executed. Both doors are driven, because the tool's
 * `review` and the person's `/board review` are two callers of one rule, and the person's is the one
 * that runs as `personActor()`.
 *
 * It is its own suite because the capability is its own: `extensions/board/verify.test.ts` covers
 * what a run records, and `extensions/board/signs.test.ts` is at the 400-line bar.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cardFile } from "../../test/helpers/board.ts";
import {
	agreed,
	claimedWithContract,
	LEAD_ID,
	PEER_ID,
	runner,
	type Session,
	signPlan,
	signSession,
} from "../../test/helpers/board-signs.ts";
import { signingBoard } from "../../test/helpers/board-command.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { VerifyRun } from "../../lib/board/verify.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The command a card's contract names in these cases. */
const VERIFY = "bun run check";

/** The tool's board, with a third session that neither leads nor holds the card. */
interface Board {
	lead: Session;
	peer: Session;
	other: Session;
}

/** One board, three sessions on it, and the run seam every case reads. */
function board(verify: VerifyRun): Board {
	const cwd = temps.track(tempDir("pi-repo-"));
	const agentDir = temps.track(tempDir("pi-agent-"));
	const session = (sessionId: string): Session => signSession({ cwd, agentDir, sessionId, deps: { verify } });
	return { lead: session(LEAD_ID), peer: session(PEER_ID), other: session("s-other") };
}

/** A card claimed by the peer with a contract that names `verify`, still in `plan`. */
async function promised(who: Board): Promise<void> {
	await claimedWithContract(who);
	await agreed(who.peer.call({ action: "contract", card: "1", path: await signPlan(who.peer), verify: VERIFY }));
}

/** The same card taken through both gates, so it sits in `execute` with the peer holding it. */
async function reviewable(who: Board): Promise<void> {
	await promised(who);
	await agreed(who.lead.call({ action: "approve", card: "1" }));
	await agreed(who.peer.call({ action: "move", card: "1", lane: "execute" }));
}

describe("a review that will be refused", () => {
	test("runs nothing for a card the lane cannot spot-check", async () => {
		const run = runner();
		const who = board(run);
		await promised(who);
		const refused = await who.lead.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("finished work is spot-checked in execute");
		// The store still decides the sentence; the gate's only word here is "no process".
		expect(run.ran).toEqual([]);
	});

	test("runs nothing for the card's own holder", async () => {
		const run = runner();
		const who = board(run);
		await reviewable(who);
		const refused = await who.peer.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("who does not hold it");
		expect(run.ran).toEqual([]);
	});

	test("runs nothing for a session that is not the lead", async () => {
		const run = runner();
		const who = board(run);
		await reviewable(who);
		const refused = await who.other.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("is spot-checked by the lead");
		expect(run.ran).toEqual([]);
	});

	test("still runs it once when the gate allows the sign", async () => {
		const run = runner();
		const who = board(run);
		await reviewable(who);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		expect(reviewed.isError).toBeFalsy();
		expect(run.ran).toEqual([VERIFY]);
	});
});

describe("the person's door", () => {
	/** A card finished by hand: `done`, its contract naming a command, and no spot-check on it. */
	async function closedByHand(next: Awaited<ReturnType<typeof signingBoard>>): Promise<void> {
		const person = { id: "person:you", label: "you" };
		const at = 1_000;
		await next.store.mutate(
			next.id,
			{ kind: "contract", artifact: { path: next.plan }, goal: "g", acceptance: "a", scopeOut: "s", verify: VERIFY },
			next.me,
			at,
		);
		await next.store.mutate(next.id, { kind: "approve", artifact: { path: next.plan } }, person, at);
		await next.store.mutate(next.id, { kind: "move", lane: "execute", artifact: { path: next.plan } }, next.me, at);
		// The run is the fixture's: this suite is about the door starting none, not about the seam.
		await next.store.mutate(
			next.id,
			{ kind: "review", verified: { cmd: VERIFY, exit: 0, at, root: next.cwd } },
			person,
			at,
		);
		await next.store.mutate(next.id, { kind: "move", lane: "done", artifact: { path: next.plan } }, next.me, at + 1);
		const file = cardFile(next.agentDir, next.id);
		const card = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		delete card.review;
		writeFileSync(file, JSON.stringify(card));
	}

	test("runs nothing for a card the lane cannot spot-check", async () => {
		const run = runner();
		const next = await signingBoard({ verify: run });
		await next.store.mutate(
			next.id,
			{ kind: "contract", artifact: { path: next.plan }, goal: "g", acceptance: "a", scopeOut: "s", verify: VERIFY },
			next.me,
			1_000,
		);
		expect(await next.say("review 1")).toContain("finished work is spot-checked in execute");
		expect(run.ran).toEqual([]);
		next.temps.flush();
	});

	test("signs an override on a card that names a command, and runs nothing", async () => {
		const run = runner();
		const next = await signingBoard({ verify: run });
		await closedByHand(next);
		// The contradiction this closes: the door used to run the command and then refuse the sign it
		// carried, so the one card a close by instruction exists for could never be closed.
		expect(await next.say("review 1 --override the check is broken")).toContain("closed by instruction");
		expect(run.ran).toEqual([]);
		expect((await next.store.read(next.id))?.review?.byInstruction).toBe("the check is broken");
		next.temps.flush();
	});
});
