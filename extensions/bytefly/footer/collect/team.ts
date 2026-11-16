/**
 * The team this session belongs to, read once where the bar installs.
 *
 * `team.teammates` lives in the shared document, so a footer that resolved the list itself
 * would spend a file read on every frame. It is read at install instead — the same moment
 * the price config is read — and handed to the snapshot as a closure, so a frame costs a
 * comparison and an edited list lands at the next `session_tree`, or on `TEAM_CHANGED_CHANNEL`
 * when a `/team join` in this session is what edited it.
 *
 * A team is the loader's default roster unless a file states one, so the bar draws a name for the
 * default five in a repository that says nothing; a stated empty list is how a project clears it,
 * and that is an answer rather than a gap.
 *
 * Loaded with `import()` rather than at registration: the team's config pulls the board's lead
 * rules, the lane table, and the card record, and a package that never draws a team should not pay
 * for them before the first frame. The deferral is what keeps `test/dependencies` flat, the same
 * reason the bus label reader before it was deferred.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isTeammate } from "../../../../lib/session-label.ts";
import { DEFAULT_TEAM_CONFIG, readTeamConfig } from "../../../../lib/workflow/config.ts";

/**
 * The names this repository's project holds as its team.
 *
 * A file that cannot be read is the team the loader's default names, not an error: the bar is
 * derived state, and a footer that threw on a malformed `bytefly.json` would take the session's
 * frame down over a cosmetic list. An unreadable document answers what an absent one does, which
 * is the one rule for a file whose answer is not known.
 */
export function readTeammates(cwd: string, options: { agentDir?: string } = {}): readonly string[] {
	try {
		return readTeamConfig(cwd, options).teammates;
	} catch {
		return DEFAULT_TEAM_CONFIG.teammates;
	}
}

/**
 * The bar's resolver: the label a join settled for this session when the team holds it, nothing
 * when it does not.
 *
 * One function rather than a list the snapshot keeps, because the membership rule belongs with
 * the vocabulary (`isTeammate`) and the snapshot only needs the answer. It is built here, where
 * the team is read, so neither the reader nor the bar imports the rule at registration.
 */
function teammateReader(cwd: string, options: { agentDir?: string } = {}): (label: string | null) => string | null {
	const team = readTeammates(cwd, options);
	return (label) => (isTeammate(label, team) ? label : null);
}

/**
 * The reader a footer install uses: the team read at the repository's settings root.
 *
 * A worktree session's cwd is the worktree, where `.pi/` is gitignored; the names the repository
 * states live in the checkout. `repo-key` is loaded here rather than in `register.ts`, so the
 * footer's registration path pays nothing for it and `test/dependencies`' heights stay flat.
 */
export async function worktreeTeammateReader(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	options: { agentDir?: string } = {},
): Promise<(sessionName: string | null) => string | null> {
	const { settingsRootFor } = await import("../../../../lib/repo-key.ts");
	return teammateReader(await settingsRootFor(pi, cwd), options);
}
