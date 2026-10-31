/**
 * Suite harness for the `team` tool: the tool, a real board it moves, and the two seams a
 * round needs — a recording dispatch and a join that never asks a bus.
 *
 * The board is real (a temp agent directory and a temp repository), so a case asserts the
 * card the store ends up with rather than a double's idea of it; only the bus is a seam,
 * because a handoff's order is what the tool owns. The caller owns the temp directories and
 * their teardown — a `bun:test` hook is per file — and every call builds its own closure, so
 * no two cases share a board, a message, or a join.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerTools } from "../../../extensions/team/tools.ts";
import type { Dispatch } from "../../../extensions/team/dispatch.ts";
import type { TeamDetails } from "../../../extensions/team/types.ts";
import { openBoardSession } from "../../../lib/board/session.ts";
import type { Peer, TeamJoin } from "../../../lib/session-tool.ts";
import { fakeCtx } from "../context.ts";
import { tempDir } from "../env.ts";
import { createFakePi } from "../fakes.ts";

/** The clock every case drives: one fixed minute, so a note's `at` is a fact to assert. */
export const NOW = 90_000;

/** What a case may change about the bus it is handed. */
export interface TeamSuiteOptions {
	/** A send that throws this, so the failure path is the one under test. */
	fail?: string;
	/** The team the bus lists, when the default pair is not the case. */
	peers?: Peer[];
	/** The label a join lands on, when it is not the lead's own. */
	joinLabel?: string;
	/** The lead the repository names, when the default is not the case under test. */
	lead?: string;
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
	// The lead the message names is the store's, so a case that changes it writes the file the
	// loader reads, before any store is opened on that directory.
	if (options.lead !== undefined) {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ board: { lead: options.lead } }));
	}
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const session = openBoardSession(fake.pi, { now: () => NOW, agentDir });
	const sent: Array<{ kind: "handoff" | "event"; to: string; text: string }> = [];
	// A fixed team, because `assign` asks who a peer is before it sends: the bus's record is
	// what the pre-check compares a holder against and what the card then records, so a stub
	// derived from what was already sent would answer nothing at the moment it is asked.
	const listed: Peer[] = options.peers ?? [
		{ id: "s-billing-core", label: "billing-core", listening: true },
		{ id: "s-billing-web", label: "billing-web", listening: true },
	];
	const dispatch: Dispatch = {
		async send(input) {
			if (options.fail !== undefined) throw new Error(options.fail);
			sent.push(input);
			return { delivered: input.to === "*" ? ["billing-core", "billing-web"] : [input.to] };
		},
		// The peers a case passes in; the default is the two above, listening.
		async peers() {
			return listed;
		},
	};
	// The join a claim makes: recorded, so no case asks a bus that is not there.
	const joined: string[] = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			const label = input?.label ?? options.joinLabel ?? "billing-lead";
			joined.push(label);
			return { ok: true, label, watching: { armed: true, wake: false } };
		},
	};
	registerTools(fake.pi, session, { dispatch: () => dispatch, team });
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
