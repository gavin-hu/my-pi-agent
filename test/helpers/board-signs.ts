/**
 * The two sign suites' fixture: one board, the two sessions that act on it, and the bus a sign sends on.
 *
 * `signs.test.ts` proves what a sign records and what it tells the other side; `verify.test.ts`
 * proves the run a spot-check makes. Both need the same card in `execute` and the same recorded
 * bus, so the fixture is one file rather than two that drift — the rule
 * `test/shared-helpers.test.ts` holds for test files as well.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardHarness } from "./board.ts";
import type { FakePiOptions } from "./fakes.ts";
import { writeBusRecord } from "./bus.ts";
import { tempDir } from "./env.ts";
import { makeTempTracker } from "./git.ts";
import { presetNameFor } from "../../lib/session-label.ts";
import type { VerifyOutcome, VerifyRun } from "../../lib/board/verify.ts";
import { registerTools } from "../../extensions/board/tools.ts";
import type { BoardDetails } from "../../extensions/board/types.ts";
import type { Notify } from "../../extensions/board/announce.ts";

const temps = makeTempTracker();
export const NOW = 50_000;
export const LEAD_ID = "s-lead";
/** The name a signSession with that id joins under, which is the label the board signs with. */
export const LEAD = presetNameFor(LEAD_ID) ?? LEAD_ID;

/** The board tool's dependency seam, as `registerTools` takes it. */
type BoardDeps = NonNullable<Parameters<typeof registerTools>[2]>;

/** The peer that claims the bench's card, and the name its card records. */
export const PEER_ID = "s-peer";
export const PEER = presetNameFor(PEER_ID) ?? PEER_ID;

/** One message the tool sent, which is what a case asks about. */
export interface Sent {
	kind: "event";
	to: string;
	text: string;
}

/** The signBus, recorded: what a sign sent, or the sentence a signBus that cannot answer gives. */
export function signBus(options: { sent?: Sent[]; fail?: string; delivered?: string } = {}): Notify {
	return async (_ctx, input) => {
		if (options.fail !== undefined) return { ok: false, error: options.fail };
		options.sent?.push(input);
		// A signBus answers with the labels it wrote for, not with what it was addressed by — the ids —
		// which is the fact a sign reports back to its caller.
		return { ok: true, delivered: [options.delivered ?? presetNameFor(input.to) ?? input.to], failed: [] };
	};
}

/** One live record on this repository's signBus, as a join writes it. */
export async function onBus(
	who: Session,
	record: { id: string; label: string; watching?: { armed: boolean; wake: boolean } },
	lastSeen = NOW,
): Promise<void> {
	writeBusRecord(await who.board.runtime.busDir(who.board.ctx.cwd), { lastSeen, ...record });
}

/** What a bench may shape besides the tool's seams: the git answers of the directory it sits in. */
export interface BenchOptions {
	/** The git answers, for a case whose directory stands for a checkout with a worktree. */
	exec?: FakePiOptions["exec"];
	/** The directory the two sessions' cwd names, when a case is about where the work is. */
	cwd?: string;
}

/** One repository, its agent directory, and the two sessions that act on one board. */
export function bench(deps: BoardDeps = {}, options: BenchOptions = {}): { lead: Session; peer: Session } {
	const cwd = options.cwd ?? temps.track(tempDir("pi-repo-"));
	const agentDir = temps.track(tempDir("pi-agent-"));
	return {
		lead: signSession({
			cwd,
			agentDir,
			sessionId: LEAD_ID,
			deps,
			...(options.exec === undefined ? {} : { exec: options.exec }),
		}),
		peer: signSession({
			cwd,
			agentDir,
			sessionId: "s-peer",
			deps,
			...(options.exec === undefined ? {} : { exec: options.exec }),
		}),
	};
}

/** One signSession on the bench's board, and the one action call a case needs. */
export function signSession(options: {
	cwd: string;
	agentDir: string;
	sessionId: string;
	deps?: BoardDeps;
	exec?: FakePiOptions["exec"];
}) {
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

export type Session = ReturnType<typeof signSession>;

/** A plan file in this repository's store, which is the only path `contract` takes. */
export async function signPlan(who: Session): Promise<string> {
	const dir = await who.board.runtime.planDir(who.board.ctx.cwd);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "one.md");
	writeFileSync(path, "# One\n");
	return path;
}

/** A card claimed by the peer, its contract written — the state a sign acts on. */
export async function claimedWithContract(who: { lead: Session; peer: Session }): Promise<void> {
	await who.peer.call({ action: "add", title: "One" });
	await who.peer.call({ action: "claim", card: "1" });
	await who.peer.call({
		action: "contract",
		card: "1",
		path: await signPlan(who.peer),
		goal: "g",
		acceptance: "a",
		scopeOut: "s",
	});
}

/**
 * A run seam that answers `outcome` and records every command it was asked to run, and where.
 *
 * `cwds` is the tree half: a spot-check runs one command per sign, so a case that proves which tree
 * it proved reads the directory the seam was handed.
 */
export function runner(outcome: Partial<VerifyOutcome> = {}): VerifyRun & { ran: string[]; cwds: string[] } {
	const ran: string[] = [];
	const cwds: string[] = [];
	const call = async (command: string, cwd: string): Promise<VerifyOutcome> => {
		ran.push(command);
		cwds.push(cwd);
		return { exit: 0, output: "", killed: false, ...outcome };
	};
	return Object.assign(call, { ran, cwds });
}

/** The temp tracker the suites that use this fixture flush: one per file, as `bun:test` wants. */
export function flushFixture(): void {
	temps.flush();
}
