/**
 * `/board` — the four words, and what each one does to the page.
 *
 * The command is a parser over the lifecycle, so a fake page records what it was
 * asked for and the context records what the user is told. A word the command does
 * not know is a warning that lists the ones it does, because a silent no-op reads
 * like a broken command.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import type { BoardTeam } from "../../lib/board/session.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import { BOARD_COMMAND, registerCommands } from "./commands.ts";
import type { TeamJoin } from "./join.ts";
import type { BoardPage, BoardPageStatus, PageStart } from "./page.ts";

/** A page that records every call and answers with a fixed status. */
function fakePage(): { page: BoardPage; calls: string[] } {
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
			return false;
		},
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
	return { page, calls };
}

/** A page this session watches rather than serves. */
function attachedPage(): BoardPage {
	return {
		start: async () => ({
			kind: "attached",
			seat: "team-lead",
			port: 4812,
			url: "http://127.0.0.1:4812/?token=view",
			repo: "my-pi-agent",
			where: "~/.pi/agent/board/k",
		}),
		stop: async () => false,
		status: async () => ({ running: false, attached: true, seat: "team-lead", port: 4812 }),
		dropStale: async () => false,
		closeAll: async () => {},
	};
}

/** A page this session watched, whose note now answers nobody. */
function stalePage(dropped = true): { page: BoardPage; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		page: {
			start: async () => ({ kind: "failed", reason: "not started" }),
			stop: async () => false,
			status: async () => ({
				running: false,
				attached: true,
				stale: true,
				seat: "team-lead",
				port: 4812,
				url: "http://127.0.0.1:4812/?token=dead",
			}),
			dropStale: async () => {
				calls.push("dropStale");
				return dropped;
			},
			closeAll: async () => {},
		},
	};
}

/** A team join that records the labels it was asked for and answers with `result`. */
function fakeTeam(
	answer: (label: string | undefined) => JoinResult = (label) => ({
		ok: true,
		label: label ?? "team-agent-slead",
		watching: { armed: true, wake: false },
	}),
) {
	const labels: Array<string | undefined> = [];
	const team: TeamJoin = {
		join: async (_ctx, input) => {
			labels.push(input?.label);
			return answer(input?.label);
		},
	};
	return { team, labels };
}

/**
 * A session's team half: the name it writes as, the seat it serves, and its standing.
 *
 * The seat is held here the way the real session holds it, so a served page changes the
 * name the join asks for.
 */
function fakeSession(name = "team-agent-slead"): BoardTeam & { seat(): string | undefined } {
	let seat: string | undefined;
	let standing: JoinResult | undefined;
	return {
		who: () => ({ id: "s-lead", label: seat ?? name }),
		serving: () => seat,
		serve: (label) => {
			seat = label;
		},
		team: { last: () => standing, record: (result) => void (standing = result) },
		seat: () => seat,
	};
}

/** The command as the host invokes it. */
async function run(args: string, options: { page?: BoardPage; team?: TeamJoin; session?: BoardTeam } = {}) {
	const { page: recording, calls } = fakePage();
	const target = options.page ?? recording;
	const session = options.session ?? fakeSession();
	const fake = createFakePi();
	registerCommands(fake.pi, session, target, options.team === undefined ? {} : { team: options.team });
	const command = fake.commands.get(BOARD_COMMAND);
	if (!command) throw new Error("the board command was not registered");
	const { ctx, notifications } = fakeCtx();
	await command.handler(args, ctx);
	return { calls, notifications, command, ctx, session };
}

describe("/board", () => {
	test("opens the page on the Board tab, and joins the team as the seat", async () => {
		const { team, labels } = fakeTeam();
		const { notifications } = await run("", { page: fakePage().page, team });
		// Opening the page is the lead's one action: the seat is the label it lands on.
		expect(labels).toEqual(["team-lead"]);
		expect(notifications.at(-1)).toBe(
			"board: team-lead serving my-pi-agent on :4812 · open http://127.0.0.1:4812/?token=abc · on the team as team-lead, listening",
		);
	});

	test("a viewer joins under its own label, because the seat is somebody else's", async () => {
		const { team, labels } = fakeTeam(() => ({
			ok: true,
			label: "team-agent-slead",
			watching: { armed: true, wake: false },
		}));
		const { notifications, session } = await run("", { page: attachedPage(), team });
		// A page somebody else serves is nobody's seat here: the session keeps its own name.
		expect(labels).toEqual(["team-agent-slead"]);
		expect(session.serving()).toBeUndefined();
		expect(notifications.at(-1)).toBe(
			"board: team-lead is serving this repository on :4812 — viewing · open http://127.0.0.1:4812/?token=view · on the team as team-agent-slead, listening",
		);
	});

	test("serves the page anyway when there is no team, and says so", async () => {
		const { team } = fakeTeam(() => ({ ok: false, error: "the session bus is not loaded" }));
		const { notifications } = await run("", { page: fakePage().page, team });
		expect(notifications.at(-1)).toContain("board: team-lead serving");
		expect(notifications.at(-1)).toContain("no team (the session bus is not loaded)");
	});

	test("status repeats what the last open did about the team", async () => {
		const { team } = fakeTeam();
		const fake = createFakePi();
		const { page: target } = fakePage();
		const session = fakeSession();
		registerCommands(fake.pi, session, target, { team });
		const command = fake.commands.get(BOARD_COMMAND);
		if (!command) throw new Error("the board command was not registered");
		const { ctx, notifications } = fakeCtx();
		await command.handler("", ctx);
		await command.handler("status", ctx);
		expect(notifications.at(-1)).toContain("on the team as team-lead, listening");
	});

	test("status reports a team a claim joined, and the page does not need to be open", async () => {
		// The standing is the session's, not the command's: a claim writes it, and this line
		// reads it, so a session that never ran `/board` still says which team it is on.
		const session = fakeSession();
		session.team.record({ ok: true, label: "team-agent-slead", watching: { armed: true, wake: false } });
		const { notifications } = await run("status", { session });
		expect(notifications.at(-1)).toBe(
			"board: not running — /board opens it · on the team as team-agent-slead, listening",
		);
	});

	test("says why there is no team, on the same line", async () => {
		const session = fakeSession();
		session.team.record({ ok: false, error: "the session bus is not loaded" });
		const { notifications } = await run("status", { session });
		expect(notifications.at(-1)).toContain("· no team (the session bus is not loaded)");
	});

	test("stands the seat down when the page stops", async () => {
		const session = fakeSession();
		const started = await run("", { session });
		expect(started.session.serving()).toBe("team-lead");
		const stopped = await run("stop", { session });
		expect(stopped.session.serving()).toBeUndefined();
	});

	test("opens it on the Team tab", async () => {
		const { calls } = await run("team");
		expect(calls).toEqual(["start team"]);
	});

	test("prints one line for status", async () => {
		const { calls, notifications } = await run("status");
		expect(calls).toEqual(["status"]);
		expect(notifications.at(-1)).toContain("board: not running");
	});

	test("says what a watching session may not stop, and whose page it is", async () => {
		const { notifications } = await run("stop", { page: attachedPage() });
		expect(notifications.at(-1)).toBe("board: nothing to stop here — team-lead serves this repository on :4812");
		const status = await run("status", { page: attachedPage() });
		expect(status.notifications.at(-1)).toBe("board: watching team-lead on :4812 — nothing to stop here");
	});

	test("tells a viewer whose page it is, and that it is on the team", async () => {
		const { notifications } = await run("", { page: attachedPage(), team: fakeTeam().team });
		expect(notifications.at(-1)).toContain(
			"board: team-lead is serving this repository on :4812 — viewing · open http://127.0.0.1:4812/?token=view · on the team",
		);
	});

	test("names a watched note that answers nobody, and drops it on stop", async () => {
		const stale = stalePage();
		const status = await run("status", { page: stale.page });
		expect(status.notifications.at(-1)).toBe(
			"board: watching team-lead on :4812 — that note answers nobody; /board stop drops it",
		);

		const stopped = await run("stop", { page: stale.page });
		expect(stale.calls).toEqual(["dropStale"]);
		expect(stopped.notifications.at(-1)).toBe("board: dropped team-lead's note for :4812 — it answered nobody");
	});

	test("keeps the note of a page that came back before stop", async () => {
		const stale = stalePage(false);
		const { notifications } = await run("stop", { page: stale.page });
		expect(notifications.at(-1)).toBe("board: nothing to stop here — team-lead is answering on :4812");
	});

	test("prints the address, so a page can be opened by hand", async () => {
		const started = await run("");
		expect(started.notifications.at(-1)).toContain("open http://127.0.0.1:4812/?token=abc");
	});

	test("stops a running page, and says when there was none", async () => {
		const first = await run("stop");
		expect(first.calls).toEqual(["status", "stop"]);
		expect(first.notifications.at(-1)).toBe("board: not running");
	});

	test("warns about a word it does not know, and lists the ones it does", async () => {
		const { calls, notifications } = await run("archive");
		expect(calls).toEqual([]);
		expect(notifications.at(-1)).toContain("try /board, /board team, /board status, /board stop");
	});

	test("completes only the words it has", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, fakeSession(), page());
		const command = fake.commands.get(BOARD_COMMAND);
		const complete = (prefix: string) => command.getArgumentCompletions(prefix);
		const values = (prefix: string) => complete(prefix)?.map((item: { value: string }) => item.value);
		expect(values("st")).toEqual(["status", "stop"]);
		expect(values("t")).toEqual(["team"]);
		expect(complete("x")).toBeNull();
		expect(complete("st more")).toBeNull();
	});

	test("names itself in the command table", async () => {
		const fake = createFakePi();
		registerCommands(fake.pi, fakeSession(), page());
		expect(fake.commands.get(BOARD_COMMAND)?.description).toContain("/board [team | status | stop]");
	});
});

/** A page with no recording, for the completion cases. */
function page(): BoardPage {
	return {
		start: async () => ({ kind: "failed", reason: "not started" }),
		stop: async () => false,
		status: async () => ({ running: false }),
		dropStale: async () => false,
		closeAll: async () => {},
	};
}
