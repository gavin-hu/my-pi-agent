/**
 * Process plumbing that only `job` needs.
 *
 * The shared spawn, tree-kill, and liveness seams live in `lib/spawn.ts`, so
 * what stays here is the job-specific remainder: the pid liveness and start-time
 * seams the runtime injects, and the `ps` token that guards against pid reuse
 * when a reattached job is settled.
 */

import { execFileSync } from "node:child_process";

/** Whether a pid is still alive. */
export type LivenessFn = (pid: number) => boolean;

/**
 * Best-effort OS start-time token for a pid, used to detect pid reuse.
 * Returns undefined when the platform cannot provide one (for example Windows,
 * or a process that is already gone), in which case callers fall back to
 * liveness alone.
 */
export type StartTokenFn = (pid: number) => string | undefined;

/** Default start-time token via `ps`. Undefined where `ps` is unavailable. */
export const defaultStartToken: StartTokenFn = (pid) => {
	try {
		const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2000,
		});
		const text = out.toString().trim();
		return text || undefined;
	} catch {
		return undefined;
	}
};
