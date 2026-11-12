/**
 * `/board approve` and `/board review` — the person's door to the board's two gates.
 *
 * The sign is the same `mutate` the tool makes, with the person as the actor, so a session
 * that holds a card can still have it signed. What this suite pins is the line the door
 * prints: the state machine's own refusal, the failure a throwing store becomes, and the
 * half that says who was or was not told — a command context cannot make a nested
 * `session send`, so `announce` asks the bus and this harness answers for it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cardFile } from "../../test/helpers/board.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { fakeBoardSession, pageWithNoRecording, signingBoard } from "../../test/helpers/board-command.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { runner } from "../../test/helpers/board-signs.ts";
import type { Notify } from "./announce.ts";
import { BOARD_COMMAND, registerCommands } from "./commands.ts";

/**
 * The clause a sign carries when nobody could be told: this harness registers no
 * `session-bus`, so nothing answers the request and the line says so instead of claiming a
 * message that was never written.
 */
const NOT_TOLD = " · team-agent-slead was not told (the session bus is not loaded)";

/** A `notify` that answers with `answer`, recording what it was asked to send. */
function toldBy(answer: { ok: true } | { ok: false; error: string }) {
	const sent: Array<{ kind: string; to: string; text: string }> = [];
	const notify: Notify = async (_ctx, input) => {
		sent.push(input);
		return answer.ok ? { ok: true, delivered: ["team-agent-slead"], failed: [] } : answer;
	};
	return { notify, sent };
}

/** The command a card's contract names in the cases about the person's run. */
const VERIFY = "bun run check";

/** The card the person signs, taken through the store to `execute` with a command on its contract. */
async function executableWith(board: Awaited<ReturnType<typeof signingBoard>>): Promise<void> {
	await board.store.mutate(
		board.id,
		{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s", verify: VERIFY },
		board.me,
		1_000,
	);
	await board.store.mutate(board.id, { kind: "approve", artifact: { path: board.plan } }, { label: "lead" }, 1_000);
	await board.store.mutate(
		board.id,
		{ kind: "move", lane: "execute", artifact: { path: board.plan } },
		board.me,
		1_000,
	);
}

describe("/board approve and /board review", () => {
	test("signs the contract as the person, not as the session that holds the card", async () => {
		const board = await signingBoard();
		const store = board.store;
		await store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe(`board: #1 approved by you${NOT_TOLD}`);
		// The line is the person's own, and a pronoun; the card records a name and the mark that
		// says the key wrote it, never the label the line prints.
		expect((await store.read(board.id))?.contract?.approved).toEqual({ by: "lead", at: 1_000, person: true });
		board.temps.flush();
	});

	test("says nothing about a close when the word is an approval", async () => {
		const board = await signingBoard();
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		reviewedInPlan(board);
		// An approval has no instruction to record, so the clause is the review's alone: the line
		// prints the sign the person made and nothing about a gate it never used.
		expect(await board.say("approve 1")).toBe(`board: #1 approved by you${NOT_TOLD}`);
		board.temps.flush();
	});

	test("runs the contract's command as the person, and says what ran", async () => {
		const run = runner();
		const board = await signingBoard({ verify: run });
		await executableWith(board);
		// The tree rides the line too: a person signing from a worktree needs to see which tree ran.
		const root = board.store.root();
		expect(await board.say("review 1")).toBe(
			`board: #1 reviewed by you · ran \`${VERIFY}\` in ${root} (exit 0)${NOT_TOLD}`,
		);
		expect(run.ran).toEqual([VERIFY]);
		// The record is the run's, written by the person's own door, and it names the tree.
		expect((await board.store.read(board.id))?.review?.verified).toEqual({ cmd: VERIFY, exit: 0, at: 1_000, root });
		board.temps.flush();
	});

	test("a red command is a line, not a sign, and the card is left alone", async () => {
		const run = runner({ exit: 1, output: "3 tests failed" });
		const board = await signingBoard({ verify: run });
		await executableWith(board);
		const line = await board.say("review 1");
		expect(line).toContain(`\`${VERIFY}\` exited 1`);
		expect((await board.store.read(board.id))?.review).toBeUndefined();
		board.temps.flush();
	});

	test("walks a one-session card past both gates, which the holder alone could not", async () => {
		const board = await signingBoard();
		const store = board.store;
		await store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		// The holder's own approval is refused, which is why the person has a door.
		const own = await store.mutate(board.id, { kind: "approve", artifact: { path: board.plan } }, board.me, 1_000);
		expect(own.ok).toBe(false);
		expect(await board.say("approve 1")).toContain("approved by you");
		expect(
			(await store.mutate(board.id, { kind: "move", lane: "execute", artifact: { path: board.plan } }, board.me, 1_000))
				.ok,
		).toBe(true);
		expect(await board.say("review 1")).toBe(`board: #1 reviewed by you${NOT_TOLD}`);
		expect((await store.read(board.id))?.review).toEqual({ by: "lead", at: 1_000, person: true });
		const done = await store.mutate(
			board.id,
			{ kind: "move", lane: "done", artifact: { path: board.plan } },
			board.me,
			1_000,
		);
		expect(done.ok).toBe(true);
		board.temps.flush();
	});

	test("refuses a sign in the lane the gate does not live in", async () => {
		const board = await signingBoard();
		const store = board.store;
		const pool = await store.create({ title: "Two", paths: [] }, board.me, 1_000);
		expect(await board.say(`approve ${pool.id}`)).toBe(
			`board: #${pool.id} is in backlog; a contract is approved in plan.`,
		);
		board.temps.flush();
	});

	test("says which word needs a card id", async () => {
		const board = await signingBoard();
		expect(await board.say("approve")).toBe("board: approve needs a card id — try /board approve 4");
		board.temps.flush();
	});

	test("gives the state machine's refusal, so a sign in the wrong lane reads like the tool's", async () => {
		const board = await signingBoard();
		// Still in `plan` with no contract: the approval's own gate answers.
		expect(await board.say("approve 1")).toContain("#1 has no contract to approve yet");
		expect(await board.say("review 1")).toBe("board: #1 is in plan; finished work is spot-checked in execute.");
		expect(await board.say("approve 99")).toContain("#99 does not exist");
		board.temps.flush();
	});

	test("tells the card's owner when the bus answers, in the clause the tool prints", async () => {
		const { notify, sent } = toldBy({ ok: true });
		const board = await signingBoard({ notify });
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe("board: #1 approved by you · told team-agent-slead");
		// The owner is addressed by id, which survives a rename, and the message is the tool's.
		expect(sent.map((input) => [input.kind, input.to])).toEqual([["event", "s-lead"]]);
		expect(sent[0]?.text).toContain(`"One" — its contract is approved by lead`);
		board.temps.flush();
	});

	test("says the owner's watch is off, in the clause the tool prints too", async () => {
		const { notify } = toldBy({ ok: true });
		const board = await signingBoard({ notify });
		// The card is held by this very session, so a record on the bus is the only word on its watch:
		// mail that waits for its next turn rather than raising one.
		writeBusRecord(await board.runtime.busDir(board.cwd), {
			id: "s-lead",
			label: "team-agent-slead",
			lastSeen: 1_000,
			watching: { armed: false, wake: false },
		});
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe(
			"board: #1 approved by you · told team-agent-slead (not listening: it reads this at its next turn)",
		);
		board.temps.flush();
	});

	test("a message that cannot be written costs the clause, never the sign", async () => {
		const board = await signingBoard({ notify: toldBy({ ok: false, error: "the bus refused the write" }).notify });
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toBe(
			"board: #1 approved by you · team-agent-slead was not told (the bus refused the write)",
		);
		// The signature is on the card either way: a refusal here would report an unrecorded sign.
		expect((await board.store.read(board.id))?.contract?.approved).toMatchObject({ by: "lead", person: true });
		board.temps.flush();
	});

	test("a sign the owner never heard is sent again by the same word", async () => {
		// The first word reached the card and not the bus; the second is the retry, and it stamps
		// nothing — this is the door the card says was silent.
		const sent: Array<{ kind: string; to: string; text: string }> = [];
		let failed = false;
		const notify: Notify = async (_ctx, input) => {
			if (!failed) {
				failed = true;
				return { ok: false, error: "the session bus is not loaded" };
			}
			sent.push(input);
			return { ok: true, delivered: ["team-agent-slead"], failed: [] };
		};
		const board = await signingBoard({ notify });
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		expect(await board.say("approve 1")).toContain("was not told");
		expect((await board.store.read(board.id))?.contract?.approved?.told).toBeUndefined();

		expect(await board.say("approve 1")).toBe("board: #1 is already approved by you · told team-agent-slead");
		expect(sent).toHaveLength(1);
		expect((await board.store.read(board.id))?.contract?.approved?.told).toEqual({ at: 1_000 });
		// Told once is told: the third word writes nothing and says nothing.
		expect(await board.say("approve 1")).toBe("board: #1 is already approved by you");
		expect(sent).toHaveLength(1);
		board.temps.flush();
	});

	test("says so when the sign is already there, rather than pretending to write", async () => {
		const { notify, sent } = toldBy({ ok: true });
		const board = await signingBoard({ notify });
		const store = board.store;
		await store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			board.me,
			1_000,
		);
		await board.say("approve 1");
		expect(await board.say("approve 1")).toBe("board: #1 is already approved by you");
		// A repeated sign writes nothing, so it tells nobody — the rule the tool follows too.
		expect(sent).toHaveLength(1);
		board.temps.flush();
	});

	test("says nothing about telling anybody when the card has no owner", async () => {
		// A signable card is in `plan` or `execute`, and both are entered by a claim or an
		// assignment, so this is the guard `announce` keeps too: nobody to tell, and the line
		// does not pretend otherwise.
		const fake = createFakePi();
		const { ctx, notices } = fakeCtx({ cwd: process.cwd() });
		const card = { id: "4", title: "One", lane: "plan", notes: [], paths: [] };
		const session = {
			...fakeBoardSession(),
			store: async () => ({
				config: () => ({ lead: "lead" }),
				// The approval proves the plan the card names, so the door reads the card first.
				read: async () => undefined,
				mutate: async () => ({ ok: true, card, changed: true, dropped: false, archived: false }),
			}),
		} as unknown as BoardSession;
		registerCommands(fake.pi, session, pageWithNoRecording());
		const command = fake.commands.get(BOARD_COMMAND);
		if (!command) throw new Error("the board command was not registered");
		await command.handler("approve 4", ctx);
		expect(notices.at(-1)).toEqual({ message: "board: #4 approved by you", kind: "info" });
	});

	test("turns a store that throws into a line, in the error tone", async () => {
		// A command has nowhere else to report what a repository read or a file write throws:
		// without this the person gets a raw command error instead of a sentence.
		const signOver = async (session: BoardSession): Promise<Array<{ message: string; kind?: string }>> => {
			const fake = createFakePi();
			const { ctx, notices } = fakeCtx({ cwd: process.cwd() });
			registerCommands(fake.pi, session, pageWithNoRecording());
			const command = fake.commands.get(BOARD_COMMAND);
			if (!command) throw new Error("the board command was not registered");
			await command.handler("approve 4", ctx);
			return notices;
		};
		const read = await signOver({
			...fakeBoardSession(),
			store: async () => {
				throw new Error("EACCES: the board is not writable");
			},
		} as unknown as BoardSession);
		expect(read.at(-1)).toEqual({
			message: "board: approve #4 failed — EACCES: the board is not writable",
			kind: "error",
		});
		const write = await signOver({
			...fakeBoardSession(),
			store: async () => ({
				config: () => ({ lead: "lead" }),
				read: async () => undefined,
				mutate: async () => {
					throw new Error("ENOSPC: no space left on device");
				},
			}),
		} as unknown as BoardSession);
		expect(write.at(-1)).toEqual({
			message: "board: approve #4 failed — ENOSPC: no space left on device",
			kind: "error",
		});
	});
});

/** A card in plan whose file also carries a review: a record no path writes, and the one a clause
 * read from the wrong field would show up on.
 */
function reviewedInPlan(board: Awaited<ReturnType<typeof signingBoard>>): void {
	const file = cardFile(board.agentDir, board.id);
	const card = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	card.review = { by: "lead", at: 1_000, byInstruction: "Closed On My Instruction" };
	writeFileSync(file, JSON.stringify(card));
}

describe("/board review --override", () => {
	/** A card this fixture finished through the gate, with its sign taken back off afterward. */
	async function closedByHand(board: Awaited<ReturnType<typeof signingBoard>>, me: typeof board.me) {
		await board.store.mutate(
			board.id,
			{ kind: "contract", artifact: { path: board.plan }, goal: "g", acceptance: "a", scopeOut: "s" },
			me,
			1_000,
		);
		await board.store.mutate(
			board.id,
			{ kind: "approve", artifact: { path: board.plan } },
			{ id: "person:you", label: "you" },
			1_000,
		);
		await board.store.mutate(board.id, { kind: "move", lane: "execute", artifact: { path: board.plan } }, me, 1_000);
		await board.store.mutate(board.id, { kind: "review" }, { id: "person:you", label: "you" }, 1_000);
		await board.store.mutate(board.id, { kind: "move", lane: "done", artifact: { path: board.plan } }, me, 1_000);
		const file = cardFile(board.agentDir, board.id);
		const card = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		delete card.review;
		writeFileSync(file, JSON.stringify(card));
	}

	test("signs a finished card, and keeps the reason as the person typed it", async () => {
		const board = await signingBoard();
		await closedByHand(board, board.me);
		// The word is folded for the parser; the sentence after the flag is not.
		expect(await board.say("REVIEW 1 --override Closed On My Instruction")).toBe(
			`board: #1 reviewed by you · closed by instruction${NOT_TOLD}`,
		);
		expect((await board.store.read(board.id))?.review).toMatchObject({
			by: "lead",
			person: true,
			byInstruction: "Closed On My Instruction",
		});
		board.temps.flush();
	});

	test("refuses the flag with nothing after it, and on a word that takes no override", async () => {
		const board = await signingBoard();
		await closedByHand(board, board.me);
		expect(await board.say("review 1 --override")).toBe("board: override needs the one line saying why.");
		expect(await board.say("approve 1 --override closed anyway")).toBe(
			"board: approve takes no --override — a contract is approved while it is in plan",
		);
		board.temps.flush();
	});
});
