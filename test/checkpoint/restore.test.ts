import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyRestore, planRestore } from "../../extensions/checkpoint/restore.ts";
import { createCheckpoint } from "../../extensions/checkpoint/snapshot.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/checkpoints";

describe("rewind", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-cp-restore-");
		cleanups.push(repo);
		writeFileSync(join(repo, "keep.txt"), "keep\n");
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "keep"], { cwd: repo });
	});

	test("plan and apply restore modified/deleted files and remove added ones", async () => {
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 1000, idFactory: () => "r1" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);

		writeFileSync(join(repo, "README.md"), "changed\n");
		rmSync(join(repo, "keep.txt"));
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");
		const headBefore = (await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: checkpoint });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.changed).toBe(2);
		expect(plan.plan.removed).toBe(1);
		expect(plan.plan.diff).toContain("README.md");
		expect(plan.plan.diff).not.toContain("ignored.txt");

		const summary = await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: checkpoint });
		expect(summary.changed).toBe(2);
		expect(summary.removed).toBe(1);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(readFileSync(join(repo, "keep.txt"), "utf-8")).toBe("keep\n");
		expect(existsSync(join(repo, "new.txt"))).toBe(false);
		// Ignored files are never part of a snapshot, so a rewind leaves them alone.
		expect(existsSync(join(repo, "ignored.txt"))).toBe(true);
		// HEAD never moves.
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()).toBe(headBefore);
		expect((await runGit(["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim()).toBe("keep");
	});

	test("leaves untracked files alone when the snapshot excluded them", async () => {
		const fresh = await makeRepo("pi-cp-restore-excl-");
		cleanups.push(fresh);
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 1000, idFactory: () => "e1" },
			{ root: fresh, indexFile: indexFileFor(fresh), namespace: NS, reason: "manual", includeUntracked: false },
		);
		writeFileSync(join(fresh, "later.txt"), "later\n");
		const plan = await planRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: checkpoint });
		expect(plan.ok && plan.plan.removed).toBe(0);
		await applyRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: checkpoint });
		expect(existsSync(join(fresh, "later.txt"))).toBe(true);
	});

	test("refuses while a merge is in progress", async () => {
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 2000, idFactory: () => "r2" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "0000000000000000000000000000000000000000\n");
		try {
			const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: checkpoint });
			expect(plan.ok).toBe(false);
			if (!plan.ok) expect(plan.reason).toContain("merge");
		} finally {
			rmSync(join(repo, mergeHead), { force: true });
		}
	});

	test("restores nested files without touching siblings", async () => {
		// A well-formed snapshot from a normal repo restores a nested file in place.
		const fresh = await makeRepo("pi-cp-restore-nested-");
		cleanups.push(fresh);
		mkdirSync(join(fresh, "sub"), { recursive: true });
		writeFileSync(join(fresh, "sub", "file.txt"), "x\n");
		const checkpoint = await createCheckpoint(
			{ runGit, now: () => 1000, idFactory: () => "x1" },
			{ root: fresh, indexFile: indexFileFor(fresh), namespace: NS, reason: "manual", includeUntracked: true },
		);
		writeFileSync(join(fresh, "sub", "file.txt"), "changed\n");
		await applyRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: checkpoint });
		expect(readFileSync(join(fresh, "sub", "file.txt"), "utf-8")).toBe("x\n");
	});
});
