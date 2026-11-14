/**
 * Suite harness for the `team` tool: the tool, a real board it moves, and the two seams a
 * round needs — a recording dispatch and a join that never asks a bus.
 *
 * The board is real (a temp agent directory and a temp repository), so a case asserts the
 * card the store ends up with rather than a double's idea of it; the bus is a seam, because
 * a handoff's order is what the tool owns, and the one failure a real board will not stage on
 * demand — a write that throws after the message landed — is a second. The caller owns the
 * temp directories and their teardown — a `bun:test` hook is per file — and every call builds
 * its own closure, so no two cases share a board, a message, or a join.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerTools } from "../../../extensions/team/tools.ts";
import type { Dispatch } from "../../../extensions/team/dispatch.ts";
import type { TeamDetails } from "../../../extensions/team/types.ts";
import { type BoardSession, openBoardSession } from "../../../lib/board/session.ts";
import type { Claims } from "../../../lib/board/claims.ts";
import { notDeliveredLine, type Peer, type TeamJoin } from "../../../lib/session-tool.ts";
import { writeBusRecord } from "../bus.ts";
import { fakeCtx } from "../context.ts";
import { tempDir } from "../env.ts";
import { createFakePi } from "../fakes.ts";

/** The clock every case drives: one fixed minute, so a note's `at` is a fact to assert. */
export const NOW = 90_000;

/** The lead these cases name in the project's file, unless a case states its own. */
export const SUITE_LEAD = "gavin";

/** What a case may change about the bus it is handed. */
export interface TeamSuiteOptions {
	/** A send that throws this, so the failure path is the one under test. */
	fail?: string;
	/**
	 * A store write that throws this, so the half-applied path is the one under test.
	 *
	 * The write is the message's second half, so this is the only seam that leaves the send
	 * already made: the peers have the handoff or the offer and the card never learned it.
	 */
	failWrite?: string;
	/**
	 * Work another session does while this message is being delivered.
	 *
	 * `assign` and `offer` send before they write, so the write can lose a race the pre-check
	 * had no way to see; a case stages that by moving the card here, which is the one moment
	 * the message is on its way and the card is not yet touched.
	 */
	duringSend?: (input: { kind: "handoff" | "event" | "ask"; to: string; text: string }) => Promise<void> | void;
	/**
	 * The team the bus lists, when the default pair is not the case.
	 *
	 * `null` is the bus that cannot answer — the record is unreadable, or no bus is loaded — which is
	 * a different fact from an empty list and the one `assign` records an unresolved owner for.
	 */
	peers?: Peer[] | null;
	/** The label a join lands on, when it is not the lead's own. */
	joinLabel?: string;
	/** The lead the repository names, when the suite's own is not the case under test. */
	lead?: string;
	/**
	 * A join the bus refuses, so the failure path is the one under test.
	 *
	 * The record is not written, so the session stays unjoined and the next door asks again —
	 * which is what a label another record holds, and a bus that was never loaded, look like.
	 */
	joinFails?: string;
	/** The peers the send could not write a message for, when the case is a partial fan-out. */
	undelivered?: Array<{ label: string; error: string }>;
	/**
	 * What the bus answers on each `peers()` read, when the roster moves under the verb.
	 *
	 * `peers` is one answer for the whole call; this is the sequence, one per read, with the last
	 * repeating — the shape a case needs to say "this team before the send, another after it". `null`
	 * is a read the bus could not answer, which is not an empty team.
	 */
	roster?: Array<Peer[] | null>;
	/** Test seam: the bus a lane crossing writes to, so a case records it without a bus. */
	claims?: Claims;
}

/**
 * One team tool over fresh temp directories.
 *
 * `track` is the suite's `makeTempTracker().track`: the fixture returns the paths and the
 * suite flushes them, because only the suite can register the hook that does.
 */
export function teamSuite(track: (dir: string) => string, options: TeamSuiteOptions = {}) {
	const agentDir = track(tempDir("pi-agent-"));
	const cwd = track(tempDir("pi-repo-"));
	// The lead the message names is the store's, so the file states one before any store opens on
	// that directory: a project names its own team, and this suite's is `SUITE_LEAD` unless a case
	// says otherwise. The list states it too, so an actor is the session's own id-derived name
	// rather than the first name the loader's default team would draw.
	const lead = options.lead ?? SUITE_LEAD;
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ team: { lead, teammates: [lead] } }));
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const session = openBoardSession(
		fake.pi,
		options.claims === undefined ? { now: () => NOW, agentDir } : { now: () => NOW, agentDir, claims: options.claims },
	);
	// A case that makes the write throw gets the same store with one method replaced: the
	// fixture's own `store()` stays real, so an assertion reads the board the tool left behind
	// rather than the report's copy of it.
	const failWrite = options.failWrite;
	const sessionForTool: BoardSession =
		failWrite === undefined
			? session
			: {
					...session,
					async store(dir) {
						const base = await session.store(dir);
						return {
							...base,
							async mutate(): Promise<never> {
								throw new Error(failWrite);
							},
						};
					},
				};
	const sent: Array<{ kind: "handoff" | "event" | "ask"; to: string; text: string }> = [];
	// A fixed team, because `assign` asks who a peer is before it sends: the bus's record is what the
	// pre-check compares a holder against. What the card records comes from a second read, so a case
	// about the write itself hands `roster` a second answer rather than reusing this one.
	const listed: Peer[] | undefined =
		options.peers === null
			? undefined
			: (options.peers ?? [
					{ id: "s-billing-core", label: "billing-core", listening: true },
					{ id: "s-billing-web", label: "billing-web", listening: true },
				]);
	// The peers a case passes in; the default is the two above, listening. A case that hands a
	// `roster` gets one answer per read, so the second read can describe a team the first did not.
	let read = 0;
	const nextRead = (): Peer[] | undefined => {
		const roster = options.roster;
		if (roster === undefined || roster.length === 0) return listed;
		const answer = roster[Math.min(read, roster.length - 1)];
		read += 1;
		return answer ?? undefined;
	};
	const dispatch: Dispatch = {
		async send(input) {
			if (options.fail !== undefined) throw new Error(options.fail);
			sent.push(input);
			await options.duringSend?.(input);
			const failed = options.undelivered ?? [];
			const reached = input.to === "*" ? ["billing-core", "billing-web"] : [input.to];
			// A send that reached everybody is the default. A case that wants the partial
			// fan-out names the peers a write failed for, and they leave the delivered list:
			// one message file is either written for a peer or not.
			const delivered = reached.filter((label) => !failed.some((entry) => entry.label === label));
			// The bus refuses a send that reached nobody, and this stub has to as well — a fake that
			// answered an empty list would let a case rebuild the branch the verbs no longer carry.
			if (delivered.length === 0) throw new Error(notDeliveredLine(failed) ?? "no recipient could be written.");
			return { delivered, failed };
		},
		// The peers a case passes in, read by read: `assign` asks once for its dry run and again for
		// the owner it records, so the two answers may differ.
		async peers() {
			return nextRead();
		},
	};
	// The join a claim makes: recorded, so no case asks a bus that is not there.
	const joined: string[] = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			const label = input?.label ?? options.joinLabel ?? "billing-lead";
			joined.push(label);
			if (options.joinFails !== undefined) return { ok: false, error: options.joinFails };
			// The record a real join leaves, so a later read finds a session the bus holds rather
			// than an answer nothing on disk backs.
			writeBusRecord(await session.busDir(cwd), { id: "s-lead", label, lastSeen: NOW });
			return { ok: true, label, watching: { armed: true, wake: false } };
		},
	};
	registerTools(fake.pi, sessionForTool, { dispatch: () => dispatch, team });
	const tool = fake.tools.get("team");
	if (!tool) throw new Error("the team tool was not registered");
	const { ctx } = fakeCtx({ cwd, sessionId: "s-lead", sessionName: "billing-lead" });
	return {
		tool,
		ctx,
		sent,
		joined,
		cwd,
		/** Who this session writes as — the label and id a refusal has to compare against. */
		async me() {
			return await session.who(ctx, cwd);
		},
		/** The store this session works on, so a case seeds the same board it reads. */
		store: () => session.store(cwd),
		/** Where this repository's bus files a record, so a case can leave one the rule reads. */
		busDir: () => session.busDir(cwd),
		/** Publish one card on that board and return its id. */
		async seed(title = "Billing webhook accepts orders"): Promise<string> {
			const store = await session.store(cwd);
			await store.ensure();
			const card = await store.create({ title, paths: ["src/billing"] }, { label: "billing-lead" }, NOW);
			return card.id;
		},
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, ctx)) as {
				content: Array<{ text: string }>;
				details: TeamDetails;
				isError?: boolean;
			};
		},
	};
}

/** The harness one call builds, which is what a case destructures. */
export type TeamSuite = ReturnType<typeof teamSuite>;
