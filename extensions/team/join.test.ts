/**
 * `/team join <label>` — the one door that names a session.
 *
 * A typed label is Pi's own session name, and the bar draws a name only while the repository's
 * team holds it, so the cases are the three outcomes of a typed join — the name goes on the team
 * and the bar can draw it, the team already held it, or it cannot be drawn and the line says why —
 * beside the joins that write nothing at all: a bare one, a refused one, and a bus that is not
 * loaded.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentLabel } from "../../lib/session-label.ts";
import type { JoinResult, TeamJoin } from "../../lib/session-tool.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { registerCommands, TEAM_COMMAND } from "./commands.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

/** A team join that records what it was asked and answers with `answer`. */
function fakeTeam(
	answer: (label: string | undefined) => JoinResult = (label) => ({
		ok: true,
		label: label ?? "billing-lead",
		watching: { armed: true, wake: false },
	}),
) {
	const labels: Array<string | undefined> = [];
	const naming: Array<boolean | undefined> = [];
	const team: TeamJoin = {
		join: async (_ctx, input) => {
			labels.push(input?.label);
			naming.push(input?.name);
			return answer(input?.label);
		},
	};
	return { team, labels, naming };
}

/** The registered command over a fresh host, so a case runs it by its own words. */
function joinCommand(board: ReturnType<typeof boardHarness>, team?: TeamJoin) {
	const fake = createFakePi();
	registerCommands(fake.pi, board.runtime, team === undefined ? {} : { team });
	const command = fake.commands.get(TEAM_COMMAND);
	if (!command) throw new Error("the team command was not registered");
	return command;
}

/** The project document at `cwd`, written the way the board reads it. */
function project(cwd: string, document: unknown): void {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "bytefly.json"), typeof document === "string" ? document : JSON.stringify(document));
}

/** The project's `team.teammates`, or `undefined` when the directory holds no project document. */
function projectTeam(cwd: string): readonly string[] | undefined {
	try {
		const document = JSON.parse(readFileSync(join(cwd, ".pi", "bytefly.json"), "utf-8")) as {
			team?: { teammates?: readonly string[] };
		};
		return document.team?.teammates;
	} catch {
		return undefined;
	}
}

describe("/team join", () => {
	test("joins under the label it was given, and says the bar cannot draw a custom name", async () => {
		const board = boardHarness({ now: NOW, project: false, track: temps.track });
		const { team, labels, naming } = fakeTeam();
		const command = joinCommand(board, team);
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join billing-core", ctx);
		expect(labels).toEqual(["billing-core"]);
		// Naming the session is the point of this door: a typed label is also Pi's own name.
		expect(naming).toEqual([true]);
		// The name a session joins under is the bar's vocabulary now, so the join is what puts it on
		// the team: any label a person types is one the footer can draw.
		expect(notifications.at(-1)).toBe(
			"team: on the team as billing-core, listening for handoffs. team.teammates now holds it, so the bar names you.",
		);
		expect(projectTeam(board.cwd)).toEqual(["billing-core"]);
		// The standing is the session's, not this command's: `/board status` reports the team
		// whichever door put it there, so this door has to record what it did.
		expect(board.runtime.team.last()).toEqual({
			ok: true,
			label: "billing-core",
			watching: { armed: true, wake: false },
		});
	});

	test("puts the joined name on the team, so the bar names the session it just renamed", async () => {
		await withAgentDir(async () => {
			const board = boardHarness({ now: NOW, project: false, track: temps.track });
			const command = joinCommand(board, fakeTeam().team);
			const { ctx, notifications, notices } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
			await command.handler("join lily", ctx);
			expect(notifications.at(-1)).toBe(
				"team: on the team as lily, listening for handoffs. team.teammates now holds it, so the bar names you.",
			);
			expect(notices.at(-1)?.kind).toBe("info");
			// A project that named no team gets the one name: the file states the whole list the write
			// was decided against, which was empty.
			expect(projectTeam(board.cwd)).toEqual(["lily"]);
		});
	});

	test("a second typed join keeps the first name", async () => {
		await withAgentDir(async () => {
			const board = boardHarness({ now: NOW, project: false, track: temps.track });
			const command = joinCommand(board, fakeTeam().team);
			await command.handler("join lily", fakeCtx({ cwd: board.cwd, sessionId: "s-lead" }).ctx);
			await command.handler("join bob", fakeCtx({ cwd: board.cwd, sessionId: "s-lead" }).ctx);
			// One session, two renames: the team is read where it is written, so the second join
			// cannot be decided against the list the first one already changed.
			expect(projectTeam(board.cwd)).toEqual(["lily", "bob"]);
		});
	});

	test("a name the team already holds is no second sentence", async () => {
		await withAgentDir(async () => {
			const board = boardHarness({ now: NOW, project: false, track: temps.track });
			project(board.cwd, { team: { teammates: ["gavin", "lily"] } });
			const command = joinCommand(board, fakeTeam().team);
			const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
			await command.handler("join lily", ctx);
			// The bar names the session either way, so a sentence here would be about a change
			// that never happened.
			expect(notifications.at(-1)).toBe("team: on the team as lily, listening for handoffs.");
			expect(projectTeam(board.cwd)).toEqual(["gavin", "lily"]);
		});
	});

	test("a document it cannot parse keeps the join, and names the failure", async () => {
		await withAgentDir(async () => {
			const board = boardHarness({ now: NOW, project: false, track: temps.track });
			project(board.cwd, "{ not json");
			const command = joinCommand(board, fakeTeam().team);
			const { ctx, notifications, notices } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
			await command.handler("join lily", ctx);
			const line = notifications.at(-1) ?? "";
			expect(line).toContain("team: on the team as lily");
			expect(line).toContain("The bar will not name you: Cannot update");
			expect(notices.at(-1)?.kind).toBe("warning");
			// The join is the session's, the write is the file's: the first still stands.
			expect(board.runtime.team.last()).toMatchObject({ ok: true, label: "lily" });
			// A file it cannot parse is refused, never replaced.
			expect(readFileSync(join(board.cwd, ".pi", "bytefly.json"), "utf-8")).toBe("{ not json");
		});
	});

	test("a bare join draws the id-derived name when Pi has no name for the session", async () => {
		const board = boardHarness({ now: NOW, project: false, track: temps.track });
		const { team, labels, naming } = fakeTeam();
		const command = joinCommand(board, team);
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join", ctx);
		// The board's own name for the session, so the card it claims and the bus record agree.
		const drawn = agentLabel("s-lead");
		expect(labels).toEqual([drawn]);
		// A derived name is the board's, not the user's: it does not rename the footer, and it is
		// not a name this command chose to put on the team either.
		expect(naming).toEqual([undefined]);
		expect(notifications.at(-1)).toBe(`team: on the team as ${drawn}, listening for handoffs.`);
		expect(existsSync(join(board.cwd, ".pi", "bytefly.json"))).toBe(false);
	});

	test("a bare join leaves a session Pi already names to the bus", async () => {
		const board = boardHarness({ now: NOW, project: false, track: temps.track });
		const { team, labels, naming } = fakeTeam();
		const command = joinCommand(board, team);
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead", sessionName: "billing-lead" });
		await command.handler("join", ctx);
		expect(labels).toEqual([undefined]);
		expect(naming).toEqual([undefined]);
		expect(notifications.at(-1)).toContain("on the team as billing-lead");
		expect(existsSync(join(board.cwd, ".pi", "bytefly.json"))).toBe(false);
	});

	test("a refused join says why, claims nothing, and writes no teammate", async () => {
		const board = boardHarness({ now: NOW, project: false, track: temps.track });
		const { team } = fakeTeam(() => ({ ok: false, error: 'the label "core" is already in use.' }));
		const command = joinCommand(board, team);
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join core", ctx);
		expect(notifications.at(-1)).toBe('team: not on the team — the label "core" is already in use.');
		expect(existsSync(join(board.cwd, ".pi", "bytefly.json"))).toBe(false);
	});

	test("answers the bus's own sentence when there is no bus to join", async () => {
		const board = boardHarness({ now: NOW, project: false, track: temps.track });
		// No `session` tool is registered, which is how `board` and `team` loaded alone look.
		const command = joinCommand(board);
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		await command.handler("join billing-core", ctx);
		expect(notifications.at(-1)).toBe("team: not on the team — the session bus is not loaded");
		expect(existsSync(join(board.cwd, ".pi", "bytefly.json"))).toBe(false);
	});
});
