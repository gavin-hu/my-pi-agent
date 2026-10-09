/**
 * Shared git test helpers.
 *
 * `execP` is a promise wrapper around `execFile` that resolves with the exit
 * code instead of rejecting, so tests can run real git commands. `makeRepo`
 * builds a temp repository with one commit; `cleanup` removes the temp dirs.
 *
 * Extracted from the worktree suite so the rewind suite can share it.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

/** Promise wrapper around execFile that resolves with the exit code instead of rejecting. */
export function execP(
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> },
): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = execFile(
			command,
			args,
			{
				cwd: options?.cwd,
				timeout: options?.timeout,
				maxBuffer: 16 * 1024 * 1024,
				env: { ...process.env, ...(options?.env ?? {}) },
			},
			(error, stdout, stderr) => {
				const code = error
					? typeof (error as { code?: unknown }).code === "number"
						? (error as { code: number }).code
						: 1
					: 0;
				resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, killed: Boolean(child.killed) });
			},
		);
	});
}

async function git(args: string[], cwd: string): Promise<ExecResult> {
	return execP("git", args, { cwd });
}

/** Create a temp git repo with one commit. */
export async function makeRepo(prefix = "pi-test-"): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	await git(["init", "-q", "-b", "main"], dir);
	await git(["config", "user.email", "test@example.com"], dir);
	await git(["config", "user.name", "Test"], dir);
	// Keep line endings byte-exact: a global `core.autocrlf=true` (common on
	// Windows) would rewrite LF blobs to CRLF on checkout, so a restored file
	// would not equal the bytes the test wrote.
	await git(["config", "core.autocrlf", "false"], dir);
	writeFileSync(join(dir, "README.md"), "hello\n");
	await git(["add", "."], dir);
	await git(["commit", "-qm", "init"], dir);
	// Return the long-form path so assertions and command strings match git's
	// expanded output on Windows (os.tmpdir() may use 8.3 short names).
	return realpathSync.native(dir);
}

/** Create a temp repo with an origin remote, pushed main, and origin/HEAD set. */
export async function makeRepoWithRemote(prefix = "pi-test-remote-"): Promise<{ repo: string; remote: string }> {
	const repo = await makeRepo(prefix);
	const remote = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-test-bare-")));
	await git(["init", "--bare", "-q"], remote);
	await git(["remote", "add", "origin", remote], repo);
	await git(["push", "-q", "-u", "origin", "HEAD:main"], repo);
	await git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repo);
	return { repo, remote };
}

/** Remove temp directories, ignoring missing ones. */
export function cleanup(...dirs: Array<string | undefined>): void {
	for (const dir of dirs) {
		// Windows holds handles briefly after git exits, so retry EBUSY/EPERM
		// removals instead of failing teardown.
		if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

/**
 * Track temp dirs so a suite can clean them in one teardown instead of
 * `try/finally` around every test. Value-only: each call returns an
 * independent tracker owned by one test file.
 */
export interface TempTracker {
	/** Register a temp dir for cleanup and return it unchanged. */
	track<T extends string | undefined>(dir: T): T;
	/** Remove every tracked dir. Call once from `afterAll`. */
	flush(): void;
}

/** Build a suite-scoped temp-dir tracker. */
export function makeTempTracker(): TempTracker {
	const dirs: string[] = [];
	return {
		track: (dir) => {
			if (dir) dirs.push(dir);
			return dir;
		},
		flush: () => cleanup(...dirs.splice(0)),
	};
}
