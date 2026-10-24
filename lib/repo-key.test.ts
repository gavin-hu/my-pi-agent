/**
 * The shared repository key: one identity per repository, shared by its
 * worktrees, and the working directory when git cannot answer.
 *
 * No git process starts: `repoKeyFor` takes any `exec` seam, so the double here
 * answers by argument. The paths that must be real are temp directories.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { REPO_KEY_LENGTH, repoKeyFor, repoKeyOf } from "./repo-key.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** An `exec` seam answering git's two identity questions from one common dir. */
function gitSeam(common: string, root: string | undefined, calls: string[][] = []) {
	return async (_command: string, args: string[]) => {
		calls.push(args);
		const stdout = args.includes("--git-common-dir") ? `${common}\n` : root === undefined ? "" : `${root}\n`;
		return { stdout, stderr: "", code: root === undefined && !args.includes("--git-common-dir") ? 1 : 0 };
	};
}

/** An `exec` seam that fails outright, the way a missing git binary does. */
function failingSeam() {
	return async () => {
		throw new Error("git is not installed");
	};
}

describe("repoKeyOf", () => {
	test("is a short hex digest", () => {
		const key = repoKeyOf("/repo/.git");
		expect(key).toMatch(/^[0-9a-f]+$/);
		expect(key).toHaveLength(REPO_KEY_LENGTH);
	});

	test("is stable for one identity and distinct across identities", () => {
		expect(repoKeyOf("/repo/.git")).toBe(repoKeyOf("/repo/.git"));
		expect(repoKeyOf("/repo/.git")).not.toBe(repoKeyOf("/other/.git"));
	});
});

describe("repoKeyFor", () => {
	test("keys on the common git directory, so worktrees share one key", async () => {
		const main = realpathSync(tempDir("repo-key-main-"));
		temps.track(main);
		const seam = gitSeam("/repo/.git", main);
		const fromMain = await repoKeyFor({ exec: seam } as never, "/repo");
		const fromWorktree = await repoKeyFor({ exec: seam } as never, "/repo/.pi/worktrees/x");
		expect(fromMain.fromGit).toBe(true);
		expect(fromMain.root).toBe(main);
		expect(fromWorktree.key).toBe(fromMain.key);
		expect(fromMain.key).toBe(repoKeyOf("/repo/.git"));
	});

	test("keys on the root when git reports no common directory", async () => {
		const root = realpathSync(tempDir("repo-key-root-"));
		temps.track(root);
		const identity = await repoKeyFor({ exec: gitSeam("", root) } as never, root);
		expect(identity).toMatchObject({ root, key: repoKeyOf(root), fromGit: true });
	});

	test("falls back to the working directory outside a repository", async () => {
		const seam = async () => ({ stdout: "", stderr: "not a repository", code: 128 });
		const identity = await repoKeyFor({ exec: seam } as never, "/not/a/repo");
		expect(identity).toEqual({ root: "/not/a/repo", key: repoKeyOf("/not/a/repo"), fromGit: false });
	});

	test("falls back when git fails to run at all", async () => {
		const identity = await repoKeyFor({ exec: failingSeam() } as never, "/no/git/here");
		expect(identity).toEqual({ root: "/no/git/here", key: repoKeyOf("/no/git/here"), fromGit: false });
	});

	test("asks git for both the common directory and the root", async () => {
		const root = realpathSync(tempDir("repo-key-asks-"));
		temps.track(root);
		const calls: string[][] = [];
		await repoKeyFor({ exec: gitSeam("/repo/.git", root, calls) } as never, root);
		expect(calls).toContainEqual(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		expect(calls).toContainEqual(["rev-parse", "--show-toplevel"]);
	});

	test("a nested path still keys the repository", async () => {
		const root = realpathSync(tempDir("repo-key-nested-"));
		temps.track(root);
		const identity = await repoKeyFor({ exec: gitSeam("/repo/.git", root) } as never, join(root, "src", "deep"));
		expect(identity.key).toBe(repoKeyOf("/repo/.git"));
	});
});
