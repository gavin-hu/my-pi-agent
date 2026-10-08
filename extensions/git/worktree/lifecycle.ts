/**
 * Worktree lifecycle, split by phase and re-exported here for callers.
 *
 * These are stateless functions over the shared runtime state in `runtime.ts`;
 * the extension's tools, commands, and event handlers import them from this
 * barrel.
 */

export { enterWorktree, type EnterOptions } from "./enter.ts";
export { exitWorktree, type ExitOptions } from "./exit.ts";
export { pruneWorktrees } from "./prune.ts";
export {
	findInactiveOverrides,
	refusalMessage,
	stateSummary,
	worktreeLabel,
	worktreeStatus,
} from "./status.ts";
