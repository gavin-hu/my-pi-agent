/**
 * The fixtures `/board`'s two suites share: the page a command opens, the session it
 * signs as, the team join it asks, and a real board with a plan file behind it.
 *
 * Two suites read them — the words (`commands.test.ts`) and the signs (`sign.test.ts`) —
 * because a suite past its bar is split, never grown, and the sign door's cases need the
 * same page and the same session the word cases do.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardHarness } from "./board.ts";
import { fakeCtx } from "./context.ts";
import { createFakePi } from "./fakes.ts";
import { makeTempTracker } from "./git.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { JoinResult, TeamJoinInput } from "../../lib/session-tool.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { BOARD_COMMAND, registerCommands } from "../../extensions/board/commands.ts";
import type { Notify } from "../../extensions/board/announce.ts";
import type { TeamJoin } from "../../extensions/board/join.ts";
import type { BoardPage, BoardPageStatus, PageStart } from "../../extensions/board/page.ts";

/** A page that records every call and answers with a fixed status. */
export function fakeBoardPage(): { page: BoardPage; calls: string[] } {
	const calls: string[] = [];
	const running: BoardPageStatus = {
		running: true,
		seat: "team-lead",
		port: 4812,
		url: "http://127.0.0.1:4812/?token=abc",
		repo: "my-pi-agent",
		where: "~/.pi/agent/board/k",
	};
	const served: PageStart = {
		kind: "served",
		seat: "team-lead",
		port: 4812,
		url: "http://127.0.0.1:4812/?token=abc",
		repo: "my-pi-agent",
		where: "~/.pi/agent/board/k",
	};
	let isRunning = false;
	const page: BoardPage = {
		start: async (_ctx, view) => {
			calls.push(`start ${view ?? "board"}`);
			isRunning = true;
			return served;
		},
		stop: async () => {
			calls.push("stop");
			const was = isRunning;
			isRunning = false;
			return was;
		},
		status: async () => {
			calls.push("status");
			return isRunning ? running : { running: false };
		},
		dropStale: async () => {
			calls.push("dropStale");
			return "gone";
		},
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
	return { page, calls };
}

/** A team join that records what it was asked, and answers with `answer`. */
export function fakeBoardTeam(
	answer: (label: string | undefined) => JoinResult = (label) => ({
		ok: true,
		label: label ?? "team-agent-slead",
		watching: { armed: true, wake: false },
	}),
) {
	const labels: Array<string | undefined> = [];
	const inputs: Array<TeamJoinInput | undefined> = [];
	const team: TeamJoin = {
		join: async (_ctx, input) => {
			labels.push(input?.label);
			inputs.push(input);
			return answer(input?.label);
		},
	};
	return { team, labels, inputs };
}

/**
 * A session's team half: the name it writes as, the seat it serves, its standing, and the
 * bus's records as `recorded` writes them.
 *
 * The seat is held here the way the real session holds it, so a served page changes the
 * name the join asks for. The roster starts as a repository no bus has recorded, because
 * that is the state a first open is in; `recorded` puts the live record a real join would
 * have written, which is the other half of the rule the join asks.
 */
export function fakeBoardSession(name = "team-agent-slead"): BoardSession & {
	seat(): string | undefined;
	/** Put a live record on the bus for this session, as a join would have written it. */
	recorded(label?: string, watching?: { armed: boolean; wake: boolean }): void;
} {
	let seat: string | undefined;
	let standing: JoinResult | undefined;
	const roster: RosterSession[] = [];
	return {
		// The page's words open no store and read no clock of their own.
		store: () => {
			throw new Error("the page's words must not open a store");
		},
		planDir: async () => {
			throw new Error("the page's words must not read the plan store");
		},
		busDir: async () => {
			throw new Error("the page's words must not read the bus directory");
		},
		roster: async () => (roster.length === 0 ? undefined : roster),
		now: () => 0,
		who: async () => ({ id: "s-lead", label: seat ?? name }),
		serving: () => seat,
		serve: (label) => {
			seat = label;
		},
		team: { last: () => standing, record: (result) => void (standing = result) },
		seat: () => seat,
		recorded: (label = seat ?? name, watching = { armed: true, wake: false }) => {
			roster.push({ id: "s-lead", label, mode: "tui", lastSeen: 0, mail: 0, watching });
		},
	};
}

/** A page with no recording, for the cases that only need the command to have one. */
export function pageWithNoRecording(): BoardPage {
	return {
		start: async () => ({ kind: "failed", reason: "not started" }),
		stop: async () => false,
		status: async () => ({ running: false }),
		dropStale: async () => "gone",
		closeAll: async () => {},
	};
}

/** A real board in a temp directory, and the command registered over it. */
export async function signingBoard(options: { notify?: Notify } = {}) {
	const temps = makeTempTracker();
	const harness = boardHarness({ now: 1_000 });
	const me = { id: "s-lead", label: "team-agent-slead" };
	const store = await harness.runtime.store(harness.ctx.cwd);
	const card = await store.create({ title: "One", paths: [] }, me, 1_000);
	await store.mutate(card.id, { kind: "claim" }, me, 1_000);
	// A plan file in this repository's store, which `contract` now requires.
	const dir = await harness.runtime.planDir(harness.ctx.cwd);
	mkdirSync(dir, { recursive: true });
	const plan = join(dir, "one.md");
	writeFileSync(plan, "# One\n");
	const fake = createFakePi();
	registerCommands(fake.pi, harness.runtime, fakeBoardPage().page, {
		team: fakeBoardTeam().team,
		...(options.notify === undefined ? {} : { notify: options.notify }),
	});
	const command = fake.commands.get(BOARD_COMMAND);
	if (!command) throw new Error("the board command was not registered");
	const { ctx, notifications } = fakeCtx({ cwd: harness.ctx.cwd });
	// A command's context has no `executeTool`, which is why the sign's message is a request.
	const { executeTool: _executeTool, ...commandContext } = ctx;
	const say = async (args: string) => {
		await command.handler(args, commandContext);
		return notifications.at(-1);
	};
	return { store, id: card.id, plan, say, temps, me, agentDir: harness.agentDir };
}
