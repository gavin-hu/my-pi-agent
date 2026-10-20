import { afterAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realPathOfNearest } from "../../lib/path.ts";
import {
	loadRegistry,
	reconcileRegistry,
	registryPath,
	removeRecord,
	statusOf,
	touchRecord,
	upsertRecord,
	type WorktreeRecord,
} from "./registry.ts";
import { cleanup, execP, makeRepoWithRemote } from "../../test/helpers/git.ts";
import { makeFakePi, testConfig } from "../../test/helpers/fixtures/worktree.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";

const temps: string[] = [];
afterAll(() => cleanup(...temps));

// Windows requires Developer Mode/admin to create symlinks; skip rather than fail.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

function temp(prefix = "pi-wt-reg-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

function record(path: string, overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
	return {
		path,
		repoRoot: "/repo",
		base: { ref: "HEAD", mode: "head" },
		createdAt: 1000,
		lastUsedAt: 1000,
		createdByUs: true,
		...overrides,
	};
}

describe.skipIf(!runSlowSuites)("registry store", () => {
	test("loads empty when the file is missing", () => {
		const repo = temp();
		expect(loadRegistry(repo, testConfig())).toEqual({ version: 1, worktrees: [] });
	});

	test("loads empty when the file is malformed or not an object", () => {
		const repo = temp();
		const file = registryPath(repo, testConfig());
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "{ not json");
		expect(loadRegistry(repo, testConfig()).worktrees).toEqual([]);
		writeFileSync(file, JSON.stringify({ worktrees: "nope" }));
		expect(loadRegistry(repo, testConfig()).worktrees).toEqual([]);
	});

	test("upsert preserves createdAt and touch updates lastUsedAt", () => {
		const repo = temp();
		const path = join(repo, "a");
		upsertRecord(repo, testConfig(), record(path, { createdAt: 1000, lastUsedAt: 1000 }));
		upsertRecord(repo, testConfig(), record(path, { createdAt: 9999, lastUsedAt: 5000 }));

		const [stored] = loadRegistry(repo, testConfig()).worktrees;
		expect(stored.createdAt).toBe(1000);
		expect(stored.lastUsedAt).toBe(5000);

		touchRecord(repo, testConfig(), path, 7777);
		expect(loadRegistry(repo, testConfig()).worktrees[0].lastUsedAt).toBe(7777);
	});

	test("remove drops a record and ignores unknown paths", () => {
		const repo = temp();
		const path = join(repo, "a");
		upsertRecord(repo, testConfig(), record(path));
		removeRecord(repo, testConfig(), join(repo, "other"));
		expect(loadRegistry(repo, testConfig()).worktrees).toHaveLength(1);
		removeRecord(repo, testConfig(), path);
		expect(loadRegistry(repo, testConfig()).worktrees).toHaveLength(0);
	});

	test("reconcile drops vanished records and synthesizes unknown ones", () => {
		const repo = temp();
		const keep = join(repo, "keep");
		const gone = join(repo, "gone");
		const added = join(repo, "added");
		mkdirSync(keep);
		upsertRecord(repo, testConfig(), record(keep));
		upsertRecord(repo, testConfig(), record(gone));

		const { registry, changed } = reconcileRegistry(repo, testConfig(), [
			{ path: keep, branch: "worktree-keep" },
			{ path: added, branch: "worktree-added" },
		]);

		expect(changed).toBe(true);
		const paths = registry.worktrees.map((item) => item.path).sort();
		expect(paths).toEqual([realPathOfNearest(keep), realPathOfNearest(added)].sort());
		const synthesized = registry.worktrees.find((item) => item.path === realPathOfNearest(added));
		expect(synthesized?.createdByUs).toBe(false);
		expect(synthesized?.lastUsedAt).toBe(0);
	});

	// The registry is a cache keyed by path, so two spellings of one checkout
	// would list it twice: a record written through a symlink and the path git
	// reports must reconcile to one.
	symlinkTest("keeps one record when a checkout is reached through a symlink", () => {
		const repo = temp();
		const real = join(repo, "real");
		const managed = join(real, ".pi", "worktrees", "wt");
		mkdirSync(managed, { recursive: true });
		symlinkSync(real, join(repo, "link"));

		upsertRecord(repo, testConfig(), record(join(repo, "link", ".pi", "worktrees", "wt")));

		const { registry } = reconcileRegistry(repo, testConfig(), [{ path: managed, branch: "worktree-wt" }]);
		expect(registry.worktrees).toHaveLength(1);
		expect(registry.worktrees[0].path).toBe(join(realpathSync.native(real), ".pi", "worktrees", "wt"));
	});
});

describe.skipIf(!runSlowSuites)("statusOf", () => {
	async function worktree(): Promise<{ repo: string; dir: string }> {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-status-");
		temps.push(repo, remote);
		const dir = realPathOfNearest(join(repo, ".pi", "worktrees", "wt"));
		await execP("git", ["worktree", "add", "-b", "wt", dir], { cwd: repo });
		return { repo, dir };
	}

	test("reports a fresh worktree as clean and merged", async () => {
		const { dir } = await worktree();
		const status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.state).toBe("clean");
		expect(status.changed).toBe(0);
		expect(status.ahead).toBe(0);
		expect(status.behind).toBe(0);
		expect(status.merged).toBe(true);
	});

	test("reports ahead, unmerged, and dirty states", async () => {
		const { repo, dir } = await worktree();
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		let status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.ahead).toBe(1);
		expect(status.merged).toBe(false);
		expect(status.state).toBe("clean");

		writeFileSync(join(dir, "dirty.txt"), "y");
		status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.state).toBe("dirty");
		expect(status.changed).toBe(1);
		void repo;
	});

	test("reports behind after the base advances", async () => {
		const { repo, dir } = await worktree();
		await execP("git", ["commit", "--allow-empty", "-qm", "base moves"], { cwd: repo });
		await execP("git", ["push", "-q", "origin", "HEAD:main"], { cwd: repo });
		await execP("git", ["fetch", "-q", "origin"], { cwd: repo });

		const status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.behind).toBeGreaterThanOrEqual(1);
	});

	test("reports a missing directory", async () => {
		const repo = temp();
		const status = await statusOf(makeFakePi(), { path: join(repo, "nope") }, {});
		expect(status.state).toBe("missing");
	});

	test("flags a stale lock", async () => {
		const { repo, dir } = await worktree();
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });
		const status = await statusOf(makeFakePi(), { path: dir, branch: "wt", locked: "pi:999999:sess" }, {});
		expect(status.locked).toBe(true);
		expect(status.staleLock).toBe(true);
	});
});
