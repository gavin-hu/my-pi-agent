/**
 * The team this session belongs to, read once where the bar installs.
 *
 * `board.teammates` lives in the shared document, so a footer that resolved the list itself
 * would spend a file read on every frame. It is read at install instead — the same moment
 * the price config is read — and handed to the snapshot as a closure, so a frame costs a
 * comparison and an edited list lands at the next `session_tree`, or on `TEAM_CHANGED_CHANNEL`
 * when a `/team join` in this session is what edited it.
 *
 * Loaded with `import()` rather than at registration: the board's config pulls the lead's
 * rules, the lane table, and the card record, and a package that never draws a team should
 * not pay for them before the first frame. The deferral is what keeps `test/dependencies`
 * flat, the same reason the bus label reader before it was deferred.
 */

import { DEFAULT_TEAMMATES, isTeammate } from "../../../../lib/session-label.ts";
import { readBoardConfig } from "../../../../lib/board/config.ts";

/**
 * The names this repository's board holds as its team.
 *
 * A file that cannot be read is the default team rather than an error: the bar is derived
 * state, and a footer that threw on a malformed `bytefly.json` would take the session's
 * frame down over a cosmetic list.
 */
export function readTeammates(cwd: string, options: { agentDir?: string } = {}): readonly string[] {
	try {
		return readBoardConfig(cwd, options).teammates;
	} catch {
		return DEFAULT_TEAMMATES;
	}
}

/**
 * The bar's resolver: this session's name when the team holds it, nothing when it does not.
 *
 * One function rather than a list the snapshot keeps, because the membership rule belongs with
 * the vocabulary (`isTeammate`) and the snapshot only needs the answer. It is built here, where
 * the team is read, so neither the reader nor the bar imports the rule at registration.
 */
export function teammateReader(
	cwd: string,
	options: { agentDir?: string } = {},
): (sessionName: string | null) => string | null {
	const team = readTeammates(cwd, options);
	return (sessionName) => (isTeammate(sessionName, team) ? sessionName : null);
}
