/**
 * The worktree extension publishes its effective root through the process
 * environment so peer and child code follows the isolated worktree. Pi loads
 * each extension with an isolated module cache and extensions cannot import one
 * another, so the variable name and the "is it still on disk?" check live here.
 */

import { existsSync } from "node:fs";

/** Env var holding the active worktree path, set by the worktree extension. */
export const ENV_ROOT = "PI_WORKTREE_ROOT";

/**
 * Env var listing extension names to skip. Entries are separated by commas
 * and/or whitespace. Unset or empty means every extension loads.
 */
export const ENV_DISABLED_EXTENSIONS = "PI_DISABLED_EXTENSIONS";

/** False when `name` appears in `PI_DISABLED_EXTENSIONS`, true otherwise. */
export function isExtensionEnabled(name: string): boolean {
	const raw = process.env[ENV_DISABLED_EXTENSIONS];
	if (!raw) return true;
	const disabled = new Set(
		raw
			.split(/[\s,]+/)
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean),
	);
	return !disabled.has(name.toLowerCase());
}

/** The active worktree root from the environment, when set and still on disk. */
export function worktreeRoot(): string | undefined {
	const root = process.env[ENV_ROOT];
	return root && existsSync(root) ? root : undefined;
}

/** `cwd`, or the active worktree root when this session is isolated. */
export function resolveEffectiveCwd(cwd: string): string {
	return worktreeRoot() ?? cwd;
}
