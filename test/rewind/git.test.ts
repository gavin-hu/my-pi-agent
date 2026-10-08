import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addedPaths,
	busyGitState,
	changedCount,
	currentBranch,
	diffStat,
	gitDir,
	hasCommits,
	repoRoot,
	revParse,
	treeFromIndex,
	treeFromWorkingTree,
} from "../../extensions/rewind/git.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe("git plumbing", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-rw-git-");
		cleanups.push(repo);
	});

	test("resolves the root, git dir, HEAD, and branch", async () => {
		expect(await repoRoot(runGit, repo)).toBeTruthy();
		expect(await gitDir(runGit, repo)).toContain(".git");
		expect(await hasCommits(runGit, repo)).toBe(true);
		expect(await currentBranch(runGit, repo)).toBe("main");
		expect(await revParse(runGit, repo, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
	});

	test("reports no root outside a repository", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pi-rw-nogit-"));
		cleanups.push(outside);
		expect(await repoRoot(runGit, outside)).toBeUndefined();
	});

	test("treeFromWorkingTree captures changes; treeFromIndex reads it back", async () => {
		const index = indexFileFor(repo, "plumbing");
		writeFileSync(join(repo, "note.txt"), "hi\n");
		const tree = await treeFromWorkingTree(runGit, repo, index, true);
		expect(tree).toMatch(/^[0-9a-f]{40}$/);
		expect(await treeFromIndex(runGit, repo, index)).toBe(tree);
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("addedPaths, changedCount, and diffStat describe a tree diff", async () => {
		const before = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "README.md"), "changed\n");
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "diff"), true);
		expect(await addedPaths(runGit, repo, before, current)).toEqual(["new.txt"]);
		expect(await changedCount(runGit, repo, before, current, "MD")).toBe(1);
		expect(await diffStat(runGit, repo, before, current)).toContain("README.md");
		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("busyGitState names an in-progress operation", async () => {
		expect(await busyGitState(runGit, repo)).toBeUndefined();
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "x\n");
		try {
			expect(await busyGitState(runGit, repo)).toBe("merge");
		} finally {
			rmSync(join(repo, mergeHead), { force: true });
		}
	});
});
