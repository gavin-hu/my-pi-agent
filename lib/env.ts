/**
 * The worktree extension publishes its effective root through the process
 * environment so peer and child code follows the isolated worktree. Pi loads
 * each extension with an isolated module cache and extensions cannot import one
 * another, so the variable name and the "is it still on disk?" check live here.
 */

import { existsSync } from "node:fs";

/** Env var holding the active worktree path, set by the worktree extension. */
export const ENV_ROOT = "PI_WORKTREE_ROOT";

/** The active worktree root from the environment, when set and still on disk. */
export function worktreeRoot(): string | undefined {
	const root = process.env[ENV_ROOT];
	return root && existsSync(root) ? root : undefined;
}

/** `cwd`, or the active worktree root when this session is isolated. */
export function resolveEffectiveCwd(cwd: string): string {
	return worktreeRoot() ?? cwd;
}
