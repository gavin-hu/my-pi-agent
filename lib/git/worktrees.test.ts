/**
 * `git worktree list` parsed into the entries the callers read.
 *
 * Split from `index.test.ts` when that suite reached the size bar: the parser is one subject
 * and its cases are the whole of it.
 */

import { describe, expect, test } from "bun:test";
import { recordingRunner } from "../../test/helpers/git.ts";
import { worktrees } from "./index.ts";

describe("worktrees", () => {
	const porcelain = [
		"worktree /repo",
		"HEAD 1234567890abcdef",
		"branch refs/heads/main",
		"",
		"worktree /repo/.pi/worktrees/side",
		"HEAD abcdef1234567890",
		"branch refs/heads/worktree-side",
		"locked pi:42:side",
		"",
		"worktree /repo/bare.git",
		"bare",
		"",
	].join("\n");

	test("lists every tree, the main checkout first, one entry per block", async () => {
		const { run, calls } = recordingRunner(() => ({ stdout: porcelain }));
		expect(await worktrees(run, "/repo")).toEqual([
			{ path: "/repo", head: "12345678", branch: "main" },
			{ path: "/repo/.pi/worktrees/side", head: "abcdef12", branch: "worktree-side", locked: "pi:42:side" },
			{ path: "/repo/bare.git", bare: true },
		]);
		expect(calls[0]?.args).toEqual(["worktree", "list", "--porcelain"]);
	});

	test("reads a lock without a reason as the empty string, and a detached head as no branch", async () => {
		const { run } = recordingRunner(() => ({ stdout: "worktree /repo\nHEAD abcdef1234567890\nlocked\n" }));
		expect(await worktrees(run, "/repo")).toEqual([{ path: "/repo", head: "abcdef12", locked: "" }]);
	});

	test("is no list when git refuses, the same answer as no repository", async () => {
		const { run } = recordingRunner(() => ({ code: 128, stderr: "not a git repository" }));
		expect(await worktrees(run, "/repo")).toEqual([]);
	});
});
