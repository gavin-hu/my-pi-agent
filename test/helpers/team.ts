/**
 * The `/team` command as the host registers it, on a board of its own.
 *
 * Two suites read it — the command's handler cases and the completer's contract — and one body for
 * the wiring is what `test/shared-helpers.test.ts` asks for: this says how a command is mounted, and
 * a suite says only how its board differs. The clock and the temp tracker are the suite's own, so
 * they come in as arguments: `now` is the instant that suite's fixtures were written at, and `track`
 * is what cleans its directories up.
 *
 * The two team seams are passed through rather than defaulted here, because the default asks the
 * bus: a suite that means a leave or a join records it instead.
 */

import { registerCommands, TEAM_COMMAND } from "../../extensions/team/commands.ts";
import type { TeamJoin, TeamLeave } from "../../lib/session-tool.ts";
import { boardHarness, type BoardHarnessOptions } from "./board.ts";
import { fakeCtx } from "./context.ts";
import { createFakePi } from "./fakes.ts";

/** What a suite may vary beyond the board: the two doors that leave this session's box. */
export interface TeamCommandOptions extends BoardHarnessOptions {
	team?: TeamJoin;
	leave?: TeamLeave;
}

/** A mounted `/team`: the host, the command it registered, its board, and what the handler reports. */
export function teamCommandHarness(now: number, track: NonNullable<BoardHarnessOptions["track"]>) {
	return (options: TeamCommandOptions = {}) => {
		const { team, leave, ...boardOptions } = options;
		const board = boardHarness({ now, track, ...boardOptions });
		const fake = createFakePi();
		const deps = { ...(team === undefined ? {} : { team }), ...(leave === undefined ? {} : { leave }) };
		registerCommands(fake.pi, board.runtime, deps);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({
			cwd: board.cwd,
			sessionId: "s-lead",
			// The branch the board's own context carries, so `/team` reads the mode the board would:
			// the seat is an entry on it, and a case about a seated session needs both to see it.
			...(boardOptions.branch === undefined ? {} : { branch: boardOptions.branch }),
		});
		return { fake, command, ctx, notifications, board };
	};
}
