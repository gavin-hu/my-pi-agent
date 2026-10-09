/**
 * The git execution seam.
 *
 * Extensions that shell out to git differ in *what* they ask git to do, but all
 * of them need the same seam: a runner that returns `{ stdout, stderr, code }`,
 * an optional timeout, and extra environment (for a temporary index). Keeping
 * the runner here means worktree, rewind, and plan share one definition.
 *
 * `RunGit` is the seam tests replace with a fake; `createExecRunner` backs it
 * with `pi.exec` in production.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export interface RunGitOptions {
	cwd: string;
	timeoutMs?: number;
	/**
	 * Extra environment for this call (used for `GIT_INDEX_FILE`). `pi.exec` has
	 * no env option, so the runner applies these to `process.env` for the
	 * duration of the call and restores them afterwards. That is process-wide:
	 * callers that set `env` must serialize their git calls.
	 */
	env?: Record<string, string>;
}

export type RunGit = (args: string[], options: RunGitOptions) => Promise<GitResult>;

/** A failed git call with a model-readable message. */
export class GitError extends Error {
	constructor(
		message: string,
		readonly code: number,
	) {
		super(message);
		this.name = "GitError";
	}
}

/** Run git through `pi.exec`, mapping `timeoutMs` to Pi's `timeout` option. */
export function createExecRunner(pi: Pick<ExtensionAPI, "exec">): RunGit {
	return async (args, options) => {
		const saved: Array<[string, string | undefined]> = [];
		if (options.env) {
			for (const [key, value] of Object.entries(options.env)) {
				saved.push([key, process.env[key]]);
				process.env[key] = value;
			}
		}
		try {
			const result = await pi.exec("git", args, {
				cwd: options.cwd,
				...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
			});
			return { stdout: result.stdout, stderr: result.stderr, code: result.code, killed: result.killed };
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	};
}

/** Run git and throw {@link GitError} on a non-zero exit. */
export async function runGitOrThrow(runGit: RunGit, args: string[], options: RunGitOptions): Promise<string> {
	const result = await runGit(args, options);
	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout).trim() || `git ${args[0]} exited with code ${result.code}`;
		throw new GitError(detail, result.code);
	}
	return result.stdout;
}
