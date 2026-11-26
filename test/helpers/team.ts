/**
 * The `/team` command as the host registers it, on a board of its own.
 *
 * Two suites read it — the command's handler cases and the completer's contract — and one body for
 * the wiring is what `test/shared-helpers.test.ts` asks for: this says how a command is mounted, and
 * a suite says only how its board differs. The clock and the temp tracker are the suite's own, so
 * they come in as arguments: `now` is the instant that suite's fixtures were written at, and `track`
 * is what cleans its directories up.
 */

import { registerCommands, TEAM_COMMAND } from "../../extensions/team/commands.ts";
import { boardHarness, type BoardHarnessOptions } from "./board.ts";
import { fakeCtx } from "./context.ts";
import { createFakePi } from "./fakes.ts";

/** A mounted `/team`: the host, the command it registered, and what the handler reports through. */
export function teamCommandHarness(now: number, track: NonNullable<BoardHarnessOptions["track"]>) {
	return (options: BoardHarnessOptions = {}) => {
		const board = boardHarness({ now, track, ...options });
		const fake = createFakePi();
		registerCommands(fake.pi, board.runtime);
		const command = fake.commands.get(TEAM_COMMAND);
		if (!command) throw new Error("the team command was not registered");
		const { ctx, notifications } = fakeCtx({ cwd: board.cwd, sessionId: "s-lead" });
		return { fake, command, ctx, notifications };
	};
}
