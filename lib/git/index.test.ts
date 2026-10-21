/**
 * The shared git plumbing, driven through the `RunGit` seam: the execution
 * runner (timeout and temporary-environment handling), the read-only queries,
 * and the path canonicalization `repoRoot` applies to git's own output.
 *
 * No git process is started: the runner double answers by argument, and the
 * paths that must exist are temp directories from this suite.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import {
	createExecRunner,
	currentBranch,
	gitCommonDir,
	gitDir,
	GitError,
	type GitResult,
	hasCommits,
	repoRoot,
	repoRootFor,
	revParse,
	revParseMany,
	runGitOrThrow,
	type RunGit,
} from "./index.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A temp directory, removed at teardown. */
function scratch(prefix: string): string {
	return temps.track(tempDir(prefix));
}

/** A runner that answers from a map or a function, and records every call. */
function recordingRunner(responses: Map<string, Partial<GitResult>> | ((args: string[]) => Partial<GitResult>)) {
	const calls: Array<{ args: string[]; options: { cwd: string; timeoutMs?: number; env?: Record<string, string> } }> =
		[];
	const run: RunGit = async (args, options) => {
		calls.push({ args, options });
		const partial = typeof responses === "function" ? responses(args) : (responses.get(args.join(" ")) ?? {});
		return { stdout: "", stderr: "", code: 0, ...partial };
	};
	return { run, calls };
}

// --- The execution runner ---------------------------------------------------

describe("runGitOrThrow", () => {
	test("returns stdout on a clean exit", async () => {
		const { run } = recordingRunner(new Map([["status", { stdout: "clean\n" }]]));
		expect(await runGitOrThrow(run, ["status"], { cwd: "/repo" })).toBe("clean\n");
	});

	test("throws GitError with stderr detail on failure", async () => {
		const { run } = recordingRunner(new Map([["log", { code: 128, stderr: "not a git repository\n" }]]));
		const error = await runGitOrThrow(run, ["log"], { cwd: "/repo" }).catch((caught) => caught);
		expect(error).toBeInstanceOf(GitError);
		expect(error.message).toBe("not a git repository");
		expect(error.code).toBe(128);
	});

	test("falls back to stdout, then to a generic message", async () => {
		const stdoutOnly = recordingRunner(new Map([["a", { code: 1, stdout: "boom" }]]));
		expect(await runGitOrThrow(stdoutOnly.run, ["a"], { cwd: "/r" }).catch((caught) => caught.message)).toBe("boom");

		const empty = recordingRunner(new Map([["b", { code: 7 }]]));
		expect(await runGitOrThrow(empty.run, ["b"], { cwd: "/r" }).catch((caught) => caught.message)).toBe(
			"git b exited with code 7",
		);
	});
});

describe("createExecRunner", () => {
	test("maps the git call to pi.exec and forwards the result", async () => {
		const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
		const pi = {
			exec: async (command: string, args: string[], options: unknown) => {
				calls.push({ command, args, options });
				return { stdout: "out", stderr: "err", code: 3, killed: true };
			},
		};
		const result = await createExecRunner(pi)(["diff", "--stat"], { cwd: "/repo", timeoutMs: 500 });

		expect(calls).toEqual([{ command: "git", args: ["diff", "--stat"], options: { cwd: "/repo", timeout: 500 } }]);
		expect(result).toEqual({ stdout: "out", stderr: "err", code: 3, killed: true });
	});

	test("omits the timeout option when none is given", async () => {
		let seen: unknown;
		const pi = {
			exec: async (_command: string, _args: string[], options: unknown) => {
				seen = options;
				return { stdout: "", stderr: "", code: 0, killed: false };
			},
		};
		await createExecRunner(pi)(["status"], { cwd: "/repo" });
		expect(seen).toEqual({ cwd: "/repo" });
	});

	test("applies env for the call and restores it afterwards", async () => {
		const key = "PI_GIT_TEST_INDEX";
		await withEnv({ [key]: undefined }, async () => {
			let seen: string | undefined;
			const pi = {
				exec: async () => {
					seen = process.env[key];
					return { stdout: "", stderr: "", code: 0, killed: false };
				},
			};
			await createExecRunner(pi)(["write-tree"], { cwd: "/repo", env: { [key]: "/tmp/index" } });
			expect(seen).toBe("/tmp/index");
			expect(process.env[key]).toBeUndefined();
		});
	});

	test("restores env when the call throws", async () => {
		const key = "PI_GIT_TEST_INDEX";
		await withEnv({ [key]: "before" }, async () => {
			const pi = {
				exec: async () => {
					throw new Error("boom");
				},
			};
			await createExecRunner(pi)(["write-tree"], { cwd: "/repo", env: { [key]: "/tmp/index" } }).catch(() => undefined);
			expect(process.env[key]).toBe("before");
		});
	});
});

describe("repoRootFor", () => {
	test("caps each git call with the timeout it is given", async () => {
		const seen: unknown[] = [];
		const pi = {
			exec: async (_command: string, _args: string[], options: unknown) => {
				seen.push(options);
				return { stdout: "/repo\n", stderr: "", code: 0, killed: false };
			},
		};
		expect(await repoRootFor(pi, "/repo", 5000)).toBe("/repo");
		expect(seen).toEqual([{ cwd: "/repo", timeout: 5000 }]);
	});

	test("never throws: a failed or stuck git call is no repository", async () => {
		const failing = {
			exec: async () => {
				throw new Error("timed out");
			},
		};
		expect(await repoRootFor(failing, "/repo")).toBeUndefined();

		const absent = {
			exec: async () => ({ stdout: "", stderr: "", code: 128, killed: false }),
		};
		expect(await repoRootFor(absent, "/repo", 100)).toBeUndefined();
	});
});

// --- The read helpers -------------------------------------------------------

describe("repoRoot", () => {
	test("returns the repository root, trimmed", async () => {
		const base = scratch("pi-git-root-");
		const { run } = recordingRunner(
			() =>
				({
					stdout: `${base}\n`,
				}) as Partial<GitResult>,
		);
		expect(await repoRoot(run, base)).toBe(realpathSync.native(base));
	});

	test("is undefined for a non-repository or a blank answer", async () => {
		const missing = recordingRunner(new Map([["rev-parse --show-toplevel", { code: 128 }]]));
		expect(await repoRoot(missing.run, "/repo")).toBeUndefined();

		const blank = recordingRunner(new Map([["rev-parse --show-toplevel", { stdout: "\n" }]]));
		expect(await repoRoot(blank.run, "/repo")).toBeUndefined();
	});

	test("falls back to git's own string when the path cannot be resolved", async () => {
		const gone = join(scratch("pi-git-root-"), "gone");
		const { run } = recordingRunner(() => ({ stdout: gone }) as Partial<GitResult>);
		expect(await repoRoot(run, "/repo")).toBe(gone);
	});

	// Windows requires Developer Mode/admin to create symlinks; skip rather than
	// fail when the privilege is unavailable.
	const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

	symlinkTest("canonicalizes a path that reaches the repository through a symlink", async () => {
		const base = scratch("pi-git-link-");
		const target = join(base, "repo");
		mkdirSync(target);
		const link = join(base, "link");
		symlinkSync(target, link);

		const { run } = recordingRunner(() => ({ stdout: link }) as Partial<GitResult>);
		expect(await repoRoot(run, link)).toBe(realpathSync.native(target));
	});
});

describe("gitDir and gitCommonDir", () => {
	test("gitDir returns the git directory or undefined", async () => {
		const found = recordingRunner(new Map([["rev-parse --absolute-git-dir", { stdout: "/repo/.git\n" }]]));
		expect(await gitDir(found.run, "/repo")).toBe("/repo/.git");

		const missing = recordingRunner(new Map([["rev-parse --absolute-git-dir", { code: 1 }]]));
		expect(await gitDir(missing.run, "/repo")).toBeUndefined();
	});

	test("gitCommonDir follows the shared directory or reports absence", async () => {
		const key = "rev-parse --path-format=absolute --git-common-dir";
		const found = recordingRunner(new Map([[key, { stdout: "/repo/.git\n" }]]));
		expect(await gitCommonDir(found.run, "/repo/.git/worktrees/one")).toBe("/repo/.git");

		const missing = recordingRunner(new Map([[key, { code: 128 }]]));
		expect(await gitCommonDir(missing.run, "/repo")).toBeUndefined();
	});
});

describe("revParse", () => {
	test("resolves an id or reports absence", async () => {
		const found = recordingRunner((args) => (args.at(-1) === "HEAD" ? { stdout: "abc123\n" } : {}));
		expect(await revParse(found.run, "/repo", "HEAD")).toBe("abc123");

		const missing = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { code: 1 }]]));
		expect(await revParse(missing.run, "/repo", "HEAD")).toBeUndefined();
	});
});

describe("revParseMany", () => {
	test("resolves every revision in one call, in order", async () => {
		const { run, calls } = recordingRunner(new Map([["rev-parse HEAD HEAD^{tree}", { stdout: "abc123\ndef456\n" }]]));
		expect(await revParseMany(run, "/repo", ["HEAD", "HEAD^{tree}"])).toEqual(["abc123", "def456"]);
		expect(calls.map((call) => call.args)).toEqual([["rev-parse", "HEAD", "HEAD^{tree}"]]);
	});

	test("answers nothing rather than a short list", async () => {
		const failed = recordingRunner(new Map([["rev-parse HEAD nope", { code: 128 }]]));
		expect(await revParseMany(failed.run, "/repo", ["HEAD", "nope"])).toEqual([]);

		const short = recordingRunner(new Map([["rev-parse HEAD HEAD^{tree}", { stdout: "abc123\n" }]]));
		expect(await revParseMany(short.run, "/repo", ["HEAD", "HEAD^{tree}"])).toEqual([]);
	});

	test("asks git nothing when there is nothing to resolve", async () => {
		const { run, calls } = recordingRunner(new Map());
		expect(await revParseMany(run, "/repo", [])).toEqual([]);
		expect(calls).toEqual([]);
	});
});

describe("hasCommits", () => {
	test("follows whether HEAD resolves", async () => {
		const withCommit = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { stdout: "abc\n" }]]));
		expect(await hasCommits(withCommit.run, "/repo")).toBe(true);

		const empty = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { code: 128 }]]));
		expect(await hasCommits(empty.run, "/repo")).toBe(false);
	});
});

describe("currentBranch", () => {
	test("returns the branch, and hides a detached HEAD", async () => {
		const attached = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }]]));
		expect(await currentBranch(attached.run, "/repo")).toBe("main");

		const detached = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { stdout: "HEAD\n" }]]));
		expect(await currentBranch(detached.run, "/repo")).toBeUndefined();
	});

	test("is undefined when the query fails", async () => {
		const failed = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { code: 128 }]]));
		expect(await currentBranch(failed.run, "/repo")).toBeUndefined();
	});
});
