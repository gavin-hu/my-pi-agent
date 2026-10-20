import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	busyGitState,
	currentBranch,
	diffNumStat,
	diffPatch,
	diffStat,
	gitDir,
	nameStatus,
	repoRoot,
	restorePaths,
	revParse,
	treeFromWorkingTree,
} from "./git.ts";
import { cleanup, makeRepo } from "../../test/helpers/git.ts";
import { indexFileFor, runGit } from "../../test/helpers/fixtures/rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe.skipIf(!runSlowSuites)("git plumbing", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-rw-git-");
		cleanups.push(repo);
	});

	test("resolves the root, git dir, HEAD, and branch", async () => {
		expect(await repoRoot(runGit, repo)).toBeTruthy();
		expect(await gitDir(runGit, repo)).toContain(".git");
		expect(await currentBranch(runGit, repo)).toBe("main");
		expect(await revParse(runGit, repo, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
	});

	test("reports no root outside a repository", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pi-rw-nogit-"));
		cleanups.push(outside);
		expect(await repoRoot(runGit, outside)).toBeUndefined();
	});

	test("treeFromWorkingTree captures the working tree", async () => {
		const index = indexFileFor(repo, "plumbing");
		writeFileSync(join(repo, "note.txt"), "hi\n");
		const tree = await treeFromWorkingTree(runGit, repo, index, true);
		expect(tree).toMatch(/^[0-9a-f]{40}$/);
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("nameStatus and diffStat describe a tree diff", async () => {
		const before = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "README.md"), "changed\n");
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "diff"), true);
		expect(await nameStatus(runGit, repo, before, current)).toEqual([
			{ path: "README.md", change: "modified" },
			{ path: "new.txt", change: "added" },
		]);
		expect(await diffStat(runGit, repo, before, current)).toContain("README.md");
		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("nameStatus and diffStat take a literal pathspec", async () => {
		const before = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "README.md"), "changed\n");
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "pathspec"), true);

		expect(await nameStatus(runGit, repo, before, current, ["new.txt"])).toEqual([
			{ path: "new.txt", change: "added" },
		]);
		expect(await diffStat(runGit, repo, before, current, ["new.txt"])).not.toContain("README.md");

		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("diffPatch and diffNumStat describe the same tree diff", async () => {
		const before = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "binary.bin"), "\u0000\u0001\u0002");
		writeFileSync(join(repo, "weird[1].txt"), "literal\n");
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "patch"), true);

		const stats = await diffNumStat(runGit, repo, before, current);
		expect(stats.get("README.md")).toEqual({ added: 1, removed: 1 });
		expect(stats.get("new.txt")).toEqual({ added: 1, removed: 0 });
		expect(stats.get("binary.bin")).toEqual({ added: null, removed: null });

		const patch = await diffPatch(runGit, repo, before, current, ["README.md"]);
		expect(patch).toContain("diff --git a/README.md b/README.md");
		expect(patch).toContain("+changed");
		expect(patch).not.toContain("new.txt");

		const literal = await diffPatch(runGit, repo, before, current, ["weird[1].txt"]);
		expect(literal).toContain("weird[1].txt");
		expect(literal).toContain("+literal");

		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
	});

	test("restorePaths rewrites only the named paths, leaving the real index alone", async () => {
		const commit = (await revParse(runGit, repo, "HEAD")) as string;
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "other.txt"), "changed too\n");

		await restorePaths(runGit, repo, commit, indexFileFor(repo, "partial"), ["README.md"]);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).not.toBe("changed\n");
		// Not selected, so untouched.
		expect(readFileSync(join(repo, "other.txt"), "utf-8")).toBe("changed too\n");
		// The real index never sees the checkout.
		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout.trim()).toBe("");

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
