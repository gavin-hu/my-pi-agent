/**
 * The label a session joins under when it asks for none.
 *
 * Two facts settle it and neither is the session's own: the name Pi holds for the
 * session, and the repository's working trees. The main checkout's directory is the
 * name a session works under; every worktree of it is a name the join declines, since
 * a worktree is named for the work it holds rather than for the session that holds it.
 *
 * The ask is one git call, at start, and only when git resolved the repository: a
 * session outside one is named after its directory, which is all it has.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createExecRunner, worktrees } from "../../lib/git/index.ts";
import { defaultLabel, sessionNameOf } from "../../lib/session-label.ts";

/** What the bus knows about the session it is naming. */
export interface AutoLabelFacts {
	/** The session, for the name Pi holds for it. */
	context: Pick<ExtensionContext, "sessionManager">;
	/** The session's working directory, canonical. */
	cwd: string;
	/** The session's id, the last fallback. */
	id: string;
	/** The repository the bus filed under; `fromGit` is what lets its trees be asked for. */
	repo: { root: string; fromGit?: boolean };
}

/** The name this session joins under: its own, else the repository's, else its id. */
export async function automaticLabel(pi: Pick<ExtensionAPI, "exec">, facts: AutoLabelFacts): Promise<string> {
	const checkouts = facts.repo.fromGit === true ? await worktrees(createExecRunner(pi), facts.cwd) : [];
	return defaultLabel({ sessionName: sessionNameOf(facts.context), cwd: facts.cwd, id: facts.id, checkouts });
}
