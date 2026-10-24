/**
 * Where a repository's plans live (pure).
 *
 * One rule, two readers: `plan` writes here, and `session-bus` reads a team out of
 * here to resolve a joining unit's paths without importing the plan extension.
 * The directory is keyed by the repository — see `lib/repo-key.ts` — and a
 * directory outside a repository has no key, which is the same store plans had
 * before the key existed.
 */

import { join } from "node:path";

/** The agent-directory entry plans are filed under. */
export const PLANS_DIRNAME = "plans";

/** The plan store: `<agent-dir>/plans`, or `<agent-dir>/plans/<key>` inside a repository. */
export function plansDir(agentDir: string, key?: string): string {
	return key === undefined ? join(agentDir, PLANS_DIRNAME) : join(agentDir, PLANS_DIRNAME, key);
}
