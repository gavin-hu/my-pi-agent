/**
 * The `/worktree` screen's rows: the current worktree, one holding work, one
 * already merged, and one whose lock outlived its process.
 *
 * Every path is invented under `DEMO_CWD`, so a capture never prints this
 * machine's checkout, and the ages come from the shared clock so they agree
 * within the frame.
 */

import type { CheckoutStatus } from "../../extensions/worktree/registry.ts";
import type { ManagedRow, WorktreeSnapshot } from "../../extensions/worktree/status.ts";
import { now } from "./shared.ts";
import { DEMO_CWD } from "./workspace.ts";

const WORKTREES = `${DEMO_CWD}/.pi/worktrees`;

/** One managed checkout, with the facts git would report for it. */
function checkout(name: string, overrides: Partial<CheckoutStatus> = {}): ManagedRow {
	const path = `${WORKTREES}/${name}`;
	const branch = `worktree-${name}`;
	return {
		entry: { path, branch },
		status: {
			path,
			branch,
			head: "5af3381",
			state: "clean",
			changed: 0,
			ahead: 0,
			behind: 0,
			merged: false,
			locked: false,
			staleLock: false,
			...overrides,
		},
	};
}

/** The session the screen is drawn in: isolated in `dark-mode`, two commits ahead. */
export const WORKTREE_SNAPSHOT: WorktreeSnapshot = {
	active: {
		active: true,
		name: "dark-mode",
		path: `${WORKTREES}/dark-mode`,
		branch: "worktree-dark-mode",
		repoRoot: DEMO_CWD,
		baseRef: "origin/main",
		baseRefMode: "fresh",
		createdByUs: true,
	},
	gaps: [{ surface: "! shell", detail: "runs in the main checkout; Pi has no mutable session cwd" }],
	inactiveOverrides: [],
	baseBranch: "main",
	managed: [
		checkout("dark-mode", { ahead: 2, lastUsedAt: now }),
		checkout("calm-otter-421", { state: "dirty", changed: 3, behind: 1, lastUsedAt: now - 2 * 86_400_000 }),
		checkout("pr-1234", { merged: true, lastUsedAt: now - 5 * 86_400_000 }),
		checkout("quiet-heron-88", { locked: true, staleLock: true, lastUsedAt: now - 9 * 86_400_000 }),
	],
};
