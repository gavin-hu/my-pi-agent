import { describe, expect, test } from "bun:test";
import {
	GitError,
	createExecRunner,
	currentBranch,
	gitDir,
	hasCommits,
	repoRoot,
	revParse,
	runGitOrThrow,
	type GitResult,
	type RunGit,
} from "../../extensions/_shared/git.ts";

/** A runner that answers from a map and records every call. */
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

describe("runGitOrThrow", () => {
	test("returns stdout on a clean exit", async () => {
		const { run } = recordingRunner(new Map([["status", { stdout: "clean\n" }]]));
		expect(await runGitOrThrow(run, ["status"], { cwd: "/repo" })).toBe("clean\n");
	});

	test("throws GitError with stderr detail on failure", async () => {
		const { run } = recordingRunner(new Map([["log", { code: 128, stderr: "not a git repository\n" }]]));
		const error = await runGitOrThrow(run, ["log"], { cwd: "/repo" }).catch((e) => e);
		expect(error).toBeInstanceOf(GitError);
		expect(error.message).toBe("not a git repository");
		expect(error.code).toBe(128);
	});

	test("falls back to stdout, then to a generic message", async () => {
		const stdoutOnly = recordingRunner(new Map([["a", { code: 1, stdout: "boom" }]]));
		expect(await runGitOrThrow(stdoutOnly.run, ["a"], { cwd: "/r" }).catch((e) => e.message)).toBe("boom");

		const empty = recordingRunner(new Map([["b", { code: 7 }]]));
		expect(await runGitOrThrow(empty.run, ["b"], { cwd: "/r" }).catch((e) => e.message)).toBe(
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
});

describe("read helpers", () => {
	test("repoRoot trims and returns undefined for a non-repo or empty result", async () => {
		const found = recordingRunner(new Map([["rev-parse --show-toplevel", { stdout: "/repo\n" }]]));
		expect(await repoRoot(found.run, "/repo")).toBe("/repo");

		const missing = recordingRunner(new Map([["rev-parse --show-toplevel", { code: 128 }]]));
		expect(await repoRoot(missing.run, "/repo")).toBeUndefined();

		const blank = recordingRunner(new Map([["rev-parse --show-toplevel", { stdout: "\n" }]]));
		expect(await repoRoot(blank.run, "/repo")).toBeUndefined();
	});

	test("gitDir returns the git directory or undefined", async () => {
		const found = recordingRunner(new Map([["rev-parse --absolute-git-dir", { stdout: "/repo/.git\n" }]]));
		expect(await gitDir(found.run, "/repo")).toBe("/repo/.git");

		const missing = recordingRunner(new Map([["rev-parse --absolute-git-dir", { code: 1 }]]));
		expect(await gitDir(missing.run, "/repo")).toBeUndefined();
	});

	test("revParse resolves an id or reports absence", async () => {
		const found = recordingRunner((args) => (args.at(-1) === "HEAD" ? { stdout: "abc123\n" } : {}));
		expect(await revParse(found.run, "/repo", "HEAD")).toBe("abc123");

		const missing = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { code: 1 }]]));
		expect(await revParse(missing.run, "/repo", "HEAD")).toBeUndefined();
	});

	test("hasCommits follows revParse HEAD", async () => {
		const withCommit = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { stdout: "abc\n" }]]));
		expect(await hasCommits(withCommit.run, "/repo")).toBe(true);

		const empty = recordingRunner(new Map([["rev-parse --verify --quiet HEAD", { code: 128 }]]));
		expect(await hasCommits(empty.run, "/repo")).toBe(false);
	});

	test("currentBranch hides a detached HEAD", async () => {
		const attached = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }]]));
		expect(await currentBranch(attached.run, "/repo")).toBe("main");

		const detached = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { stdout: "HEAD\n" }]]));
		expect(await currentBranch(detached.run, "/repo")).toBeUndefined();

		const failed = recordingRunner(new Map([["rev-parse --abbrev-ref HEAD", { code: 128 }]]));
		expect(await currentBranch(failed.run, "/repo")).toBeUndefined();
	});
});
