/**
 * The locks this process holds across a transcript change.
 *
 * A lock reason is `pi:<pid>:<session>`, and a `/new` re-mints the session id while the process
 * lives on — so a tree still holding the old reason names a session nothing runs. `enter` and
 * `prune` answer that for a tree somebody asks about (#1026); this module answers it at the start,
 * where nobody asks: the tree the session is **standing in** is re-locked under the current reason,
 * and every other lock this process wrote under a replaced id is released.
 *
 * Standing is `process.env[ENV_ROOT]` — set when a tree became active and untouched by a `/new` —
 * and, when that is unset, the managed tree whose path contains `ctx.cwd`. Neither a restored state
 * nor an extra scan is needed to know it, which is the point: `getActive()` is null on exactly the
 * start this runs for.
 *
 * Releasing is not deleting. A tree with work keeps it — `prune` asks `inspectWork` before it
 * removes anything — so unlocking one a `/new` abandoned is what lets the next sweep do its job.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isInside } from "../../lib/path.ts";
import { settingsRootFor } from "../../lib/repo-key.ts";
import { loadConfig } from "./config.ts";
import { listManagedWorktrees, lockWorktree, replacedSessionOf, unlockWorktree } from "./git.ts";
import { lockReasonFor, lockSelfFor, ENV_ROOT } from "./runtime.ts";

/** The names in a sentence: one path as itself, several separated, because a notice is one line. */
function listed(paths: readonly string[]): string {
	return paths.map((path) => basename(path)).join(", ");
}

/** What a reconcile did, in the sentences a start can print, or `undefined` when it did nothing. */
function reconciled(
	renewed: readonly string[],
	released: readonly string[],
	failed: readonly string[],
): string | undefined {
	const parts: string[] = [];
	if (renewed.length > 0) {
		parts.push(`Renewed this session's lock on ${listed(renewed)}, which the previous context id had left behind.`);
	}
	if (released.length > 0) {
		const count = released.length === 1 ? "a lock" : `${released.length} locks`;
		parts.push(`Released ${count} this session's previous context left on ${listed(released)}.`);
	}
	if (failed.length > 0) {
		parts.push(`Could not re-lock ${listed(failed)}: it is unlocked until the next start.`);
	}
	return parts.length === 0 ? undefined : parts.join(" ");
}

/**
 * Reconcile the locks this process wrote under a session id it no longer runs.
 *
 * A start calls this once, for every reason but `startup`: a fresh process cannot hold a lock
 * naming its own pid, and `startup` is the one reason where `ENV_ROOT` means the *parent's* tree.
 * Only a reason whose pid is this process's is touched, so a peer's tree and a borrowed parent's are
 * out of reach by construction rather than by a check.
 */
export async function reconcileOwnLocks(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string | undefined> {
	const self = lockSelfFor(ctx);
	const standing = process.env[ENV_ROOT];
	const root = await settingsRootFor(pi, standing ?? ctx.cwd);
	const entries = await listManagedWorktrees(pi, root, loadConfig(root));
	const renewed: string[] = [];
	const released: string[] = [];
	const failed: string[] = [];
	for (const entry of entries) {
		const lock = entry.locked;
		if (lock === undefined || replacedSessionOf(lock, self) === undefined) continue;
		const held = isInside(entry.path, standing ?? ctx.cwd);
		await unlockWorktree(pi, root, entry.path);
		if (held) {
			// The tree this session stands in keeps a lock, under the reason it runs as now. A lock that
			// will not take is the one outcome the notice must carry: the tree is open until the next
			// start, and silence there is exactly the state this module exists to prevent.
			if (await lockWorktree(pi, root, entry.path, lockReasonFor(ctx))) renewed.push(entry.path);
			else failed.push(entry.path);
			continue;
		}
		released.push(entry.path);
	}
	return reconciled(renewed, released, failed);
}
