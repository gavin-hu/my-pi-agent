/**
 * Read-only git context for the serve pages.
 *
 * The header shows the checked-out branch (or the detached head) and a dirty
 * marker. Queries go through the shared `lib/git` seams so the read-only
 * plumbing lives in one place. State (the TTL cache) lives in the factory
 * closure, never in `lib/`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecRunner, currentBranch, repoRoot, revParse, type RunGit } from "../../lib/git/index.ts";

export interface GitStatus {
	/** Checked-out branch, when HEAD is attached. */
	branch?: string;
	/** Short object id, when HEAD is detached. */
	head?: string;
	/** True when `git status --porcelain` reports any change. */
	dirty: boolean;
}

export type GitStatusProvider = () => Promise<GitStatus | undefined>;

export interface GitStatusOptions {
	/** How long a result is reused, in ms (default 2000). */
	ttlMs?: number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
}

/**
 * Build a provider for `root` that caches its result for `ttlMs`. It never
 * throws: a non-repository, a failed git call, or a timeout yields `undefined`,
 * and the page simply omits the chip.
 */
export function createGitStatus(
	pi: Pick<ExtensionAPI, "exec">,
	root: string,
	options: GitStatusOptions = {},
): GitStatusProvider {
	const runGit = createExecRunner(pi);
	const ttlMs = options.ttlMs ?? 2000;
	const now = options.now ?? (() => Date.now());
	let cached: GitStatus | undefined;
	let checkedAt = 0;

	async function read(run: RunGit): Promise<GitStatus | undefined> {
		if (!(await repoRoot(run, root))) return undefined;
		const branch = await currentBranch(run, root);
		const head = branch ? undefined : (await revParse(run, root, "HEAD"))?.slice(0, 7);
		if (!branch && !head) return undefined;
		const status = await run(["status", "--porcelain"], { cwd: root, timeoutMs: 1000 });
		if (status.code !== 0) return undefined;
		return { branch, head, dirty: status.stdout.trim().length > 0 };
	}

	return async () => {
		const t = now();
		if (checkedAt !== 0 && t - checkedAt < ttlMs) return cached;
		checkedAt = t;
		try {
			cached = await read(runGit);
		} catch {
			cached = undefined;
		}
		return cached;
	};
}
