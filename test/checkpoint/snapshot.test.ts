import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCheckpoint } from "../../extensions/checkpoint/snapshot.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/checkpoints";

describe("createCheckpoint", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-cp-snap-");
		cleanups.push(repo);
	});

	test("captures tracked modifications and untracked files", async () => {
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 1000, idFactory: () => "t-dirty" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);

		expect(checkpoint.id).toBe("t-dirty");
		expect(checkpoint.clean).toBe(false);
		expect(checkpoint.branch).toBe("main");
		expect(checkpoint.ref).toBe(`${NS}/t-dirty`);
		// The untracked file is present in the snapshot tree.
		expect((await runGit(["cat-file", "-e", `${checkpoint.commit}:new.txt`], { cwd: repo })).code).toBe(0);
		// The modified tracked file is captured with its new contents.
		const blob = await runGit(["show", `${checkpoint.commit}:README.md`], { cwd: repo });
		expect(blob.stdout).toBe("changed\n");
	});

	test("records a metadata commit sharing HEAD's tree when clean", async () => {
		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 2000, idFactory: () => "t-clean" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "auto", includeUntracked: true },
		);

		expect(checkpoint.clean).toBe(true);
		// Git reuses the identical tree object; only a small commit is added.
		expect((await runGit(["rev-parse", `${checkpoint.commit}^{tree}`], { cwd: repo })).stdout.trim()).toBe(
			checkpoint.tree,
		);
		expect(checkpoint.commit).not.toBe(checkpoint.head);
	});

	test("excludes ignored files but captures .gitignore itself", async () => {
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 3000, idFactory: () => "t-ignore" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);

		expect((await runGit(["cat-file", "-e", `${checkpoint.commit}:ignored.txt`], { cwd: repo })).code).not.toBe(0);
		expect((await runGit(["cat-file", "-e", `${checkpoint.commit}:.gitignore`], { cwd: repo })).code).toBe(0);
	});

	test("leaves the real index and HEAD untouched", async () => {
		writeFileSync(join(repo, "staged.txt"), "staged\n");
		await runGit(["add", "staged.txt"], { cwd: repo });
		const stagedBefore = await runGit(["diff", "--cached", "--name-only"], { cwd: repo });
		const headBefore = await runGit(["rev-parse", "HEAD"], { cwd: repo });

		await createCheckpoint(
			{ runGit, now: () => 4000, idFactory: () => "t-index" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);

		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout).toBe(stagedBefore.stdout);
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout).toBe(headBefore.stdout);
	});

	test("refuses a repository with no commits", async () => {
		const empty = await makeRepo("pi-cp-empty-");
		cleanups.push(empty);
		await runGit(["update-ref", "-d", "HEAD"], { cwd: empty });
		await expect(
			createCheckpoint(
				{ runGit },
				{ root: empty, indexFile: indexFileFor(empty), namespace: NS, reason: "manual", includeUntracked: true },
			),
		).rejects.toThrow(/no commits/);
	});
});
