/**
 * The git capability: configuration, session state, the managed registry and
 * derived checkout status, git plumbing, `.worktreeinclude`, the handoff block,
 * the isolation-gap rules, and pruning.
 *
 * Pure modules (config, state, registry store, handoff, gaps, the include
 * matcher) run everywhere. Anything that reads a real repository is gated by
 * `test/helpers/slow-suite.ts`; the link and file cases run in tracked temp
 * directories and clean up in one `afterAll`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realPathOfNearest } from "../../lib/path.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { execP, makeRepo, makeRepoWithRemote } from "../../test/helpers/git.ts";
import { bootWorktree, makeFakePi, makeTempTracker, testConfig } from "../../test/helpers/fixtures/worktree.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import {
	branchExists,
	checkCheckout,
	commitsAhead,
	defaultBranch,
	fetchPrRef,
	fetchStale,
	isIgnored,
	listManagedWorktrees,
	lockWorktree,
	mergeBase,
	parsePrReference,
	type PrReference,
	resolveBaseRef,
	statusEntries,
	submoduleChanges,
	unlockWorktree,
	worktreeAdd,
	worktreeExists,
	worktreePath,
	worktreeRemove,
} from "./git.ts";
import { gapLines, isolationGaps, type GapInput } from "./gaps.ts";
import { handoffLines, type Handoff } from "./handoff.ts";
import { copyIncludes, includePatterns, isIncluded } from "./include.ts";
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
import { loadState, persistState, type WorktreeState } from "./state.ts";
import { statusMarks } from "./status.ts";
import { WORKTREE_TOOLS } from "./tools.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const pi = makeFakePi();

// Windows needs Developer Mode/admin to create symlinks, so those cases skip.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

/** A `pi` whose `exec` answers from a route table, for metadata-failure paths. */
function stubPi(route: (args: string[]) => { stdout?: string; stderr?: string; code?: number } | undefined) {
	return {
		exec: async (_command: string, args: string[]) => {
			const result = route(args) ?? { code: 1 };
			return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 0 };
		},
	} as unknown as Parameters<typeof checkCheckout>[0];
}

/** The managed worktree directory for a name, canonicalized the way git reports it. */
function managedPath(repo: string, name: string): string {
	return realPathOfNearest(join(repo, ".pi", "worktrees", name));
}

describe("configuration", () => {
	test("returns the defaults when no file exists", () => {
		expect(loadConfig(tempDir("worktree-repo-"), tempDir("worktree-global-"))).toEqual(DEFAULT_CONFIG);
	});

	test("merges global then project, with project winning per key", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(globalDir, "bytefly.json"),
			JSON.stringify({ worktree: { baseRef: "head", pruneAfterDays: 30, guard: { blockReadEscapes: true } } }),
		);
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { branchPrefix: "wt-", guard: { blockGitRedirects: false } } }),
		);

		const config = loadConfig(repo, globalDir);
		expect(config.baseRef).toBe("head");
		expect(config.pruneAfterDays).toBe(30);
		expect(config.branchPrefix).toBe("wt-");
		// A nested guard merges per key instead of replacing the whole object.
		expect(config.guard.blockReadEscapes).toBe(true);
		expect(config.guard.blockGitRedirects).toBe(false);
		expect(config.guard.blockFileEscapes).toBe(DEFAULT_CONFIG.guard.blockFileEscapes);
	});

	test("replaces list settings wholesale and reads the powershell switch", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(globalDir, "bytefly.json"),
			JSON.stringify({ worktree: { include: ["a", "b"], skipOverrides: ["bash"] } }),
		);
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { include: ["c"], guard: { blockPowershell: false } } }),
		);

		const config = loadConfig(repo, globalDir);
		expect(config.include).toEqual(["c"]);
		expect(config.skipOverrides).toEqual(["bash"]);
		expect(config.guard.blockPowershell).toBe(false);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
		writeFileSync(join(repo, ".pi", "bytefly.json"), "{ also not json");

		expect(loadConfig(repo, globalDir)).toEqual(DEFAULT_CONFIG);
	});

	test("keeps the base value for a non-boolean guard flag", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { guard: { blockFileEscapes: "yes" } } }),
		);

		// A malformed flag keeps the base value instead of loosening a guard.
		expect(loadConfig(repo, globalDir).guard).toEqual(DEFAULT_CONFIG.guard);
	});

	test("coerces a non-object guard section to the defaults", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ worktree: { guard: "nope" } }));
		expect(loadConfig(repo, globalDir).guard).toEqual(DEFAULT_CONFIG.guard);
	});
});

describe("session state", () => {
	const state: WorktreeState = {
		active: true,
		path: "/tmp/wt",
		repoRoot: "/tmp/repo",
		baseRef: "HEAD",
		baseRefMode: "head",
		createdByUs: true,
	};

	function ctxWithBranch(entries: unknown[]) {
		return { sessionManager: { getBranch: () => entries } } as unknown as Parameters<typeof loadState>[0];
	}

	test("persists the binding as a worktree custom entry", () => {
		const calls: Array<{ customType: string; data?: unknown }> = [];
		persistState((customType, data) => calls.push({ customType, data }), state);
		expect(calls).toEqual([{ customType: "worktree", data: state }]);
	});

	test("restores the last valid entry and ignores other entries", () => {
		const entries = [
			{ type: "message", data: "hello" },
			{ type: "custom", customType: "worktree", data: state },
			{ type: "custom", customType: "other", data: { path: "/nope" } },
			{ type: "custom", customType: "worktree", data: { ...state, path: "/tmp/wt2" } },
		];
		expect(loadState(ctxWithBranch(entries))?.path).toBe("/tmp/wt2");
	});

	test("keeps an earlier valid entry when a later one is incomplete", () => {
		const entries = [
			{ type: "custom", customType: "worktree", data: state },
			{ type: "custom", customType: "worktree", data: { path: 42 } },
			{ type: "custom", customType: "worktree", data: { active: true } },
			{ type: "custom", customType: "worktree", data: null },
		];
		expect(loadState(ctxWithBranch(entries))?.path).toBe("/tmp/wt");
	});

	test("returns undefined when nothing was recorded", () => {
		expect(loadState(ctxWithBranch([]))).toBeUndefined();
	});
});

describe("managed registry store", () => {
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

	test("loads empty when the file is missing or malformed", () => {
		const repo = temps.track(tempDir("pi-wt-reg-"));
		expect(loadRegistry(repo, testConfig())).toEqual({ version: 1, worktrees: [] });

		const file = registryPath(repo, testConfig());
		mkdirSync(join(repo, ".pi", "worktrees"), { recursive: true });
		writeFileSync(file, "{ not json");
		expect(loadRegistry(repo, testConfig()).worktrees).toEqual([]);
		writeFileSync(file, JSON.stringify({ worktrees: "nope" }));
		expect(loadRegistry(repo, testConfig()).worktrees).toEqual([]);
	});

	test("upsert preserves createdAt, touch updates only lastUsedAt", () => {
		const repo = temps.track(tempDir("pi-wt-reg-"));
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
		const repo = temps.track(tempDir("pi-wt-reg-"));
		const path = join(repo, "a");
		upsertRecord(repo, testConfig(), record(path));
		removeRecord(repo, testConfig(), join(repo, "other"));
		expect(loadRegistry(repo, testConfig()).worktrees).toHaveLength(1);
		removeRecord(repo, testConfig(), path);
		expect(loadRegistry(repo, testConfig()).worktrees).toHaveLength(0);
	});

	test("reconcile drops vanished records and synthesizes unknown ones", () => {
		const repo = temps.track(tempDir("pi-wt-reg-"));
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
		expect(registry.worktrees.map((item) => item.path).sort()).toEqual(
			[realPathOfNearest(keep), realPathOfNearest(added)].sort(),
		);
		const synthesized = registry.worktrees.find((item) => item.path === realPathOfNearest(added));
		expect(synthesized?.createdByUs).toBe(false);
		expect(synthesized?.lastUsedAt).toBe(0);
	});

	// The registry is keyed by canonical path, so two spellings of one checkout
	// must not list it twice.
	symlinkTest("keeps one record when a checkout is reached through a symlink", () => {
		const repo = temps.track(tempDir("pi-wt-reg-"));
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

describe.skipIf(!runSlowSuites)("checkout status", () => {
	/** A managed worktree branched from its repository's current commit. */
	async function worktree(): Promise<{ repo: string; dir: string; base: string }> {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-status-");
		temps.track(repo);
		temps.track(remote);
		const base = (await execP("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
		const dir = managedPath(repo, "wt");
		await execP("git", ["worktree", "add", "-b", "wt", dir], { cwd: repo });
		return { repo, dir, base };
	}

	/** The registry record `enter` leaves, which is where the fork point comes from. */
	function record(repo: string, dir: string, base: string): WorktreeRecord {
		return {
			path: dir,
			branch: "wt",
			repoRoot: repo,
			base: { ref: "origin/main", commit: base, mode: "fresh" },
			createdAt: 1000,
			lastUsedAt: 1000,
			createdByUs: true,
		};
	}

	test("reports a fresh worktree as clean, with no commits of its own", async () => {
		const { repo, dir, base } = await worktree();
		const status = await statusOf(
			makeFakePi(),
			{ path: dir, branch: "wt" },
			{ baseRef: "origin/main", record: record(repo, dir, base) },
		);
		expect(status.state).toBe("clean");
		expect(status.changed).toBe(0);
		expect(status.ahead).toBe(0);
		expect(status.behind).toBe(0);
		expect(status.commits).toBe(0);
		// Nothing was committed, so nothing landed: calling this merged said the work was in
		// the base while it was still sitting in the directory.
		expect(status.merged).toBe(false);
		expect(statusMarks(status, true)).toContain("no commits");
		expect(statusMarks(status, true)).not.toContain("merged");
	});

	test("counts its own commits, and calls them merged once the base has them", async () => {
		const { repo, dir, base } = await worktree();
		const entry = { path: dir, branch: "wt" };
		const options = { baseRef: "origin/main", record: record(repo, dir, base) };
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		let status = await statusOf(makeFakePi(), entry, options);
		expect(status.commits).toBe(1);
		expect(status.ahead).toBe(1);
		expect(status.merged).toBe(false);
		expect(statusMarks(status, false)).toContain("ahead 1");
		expect(statusMarks(status, false)).not.toContain("no commits");

		// Land it: the same branch, now contained in the base it targets.
		await execP("git", ["push", "-q", "origin", "HEAD:main"], { cwd: dir });
		await execP("git", ["fetch", "-q", "origin"], { cwd: repo });
		status = await statusOf(makeFakePi(), entry, options);
		expect(status.commits).toBe(1);
		expect(status.ahead).toBe(0);
		expect(status.merged).toBe(true);
		// The count goes beside the mark that is about it.
		expect(statusMarks(status, false)).toContain("commits 1");
		expect(statusMarks(status, false)).toContain("merged");
	});

	test("cannot count commits for a worktree it did not create", async () => {
		const { dir } = await worktree();
		// No record means no fork point, so the count is unknown and the coarse answer stands.
		const status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.commits).toBeUndefined();
		expect(status.merged).toBe(true);
	});

	test("reports ahead and unmerged first, then dirty after a local edit", async () => {
		const { dir } = await worktree();
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
	});

	test("reports behind after the base advances", async () => {
		const { repo, dir } = await worktree();
		await execP("git", ["commit", "--allow-empty", "-qm", "base moves"], { cwd: repo });
		await execP("git", ["push", "-q", "origin", "HEAD:main"], { cwd: repo });
		await execP("git", ["fetch", "-q", "origin"], { cwd: repo });

		const status = await statusOf(makeFakePi(), { path: dir, branch: "wt" }, { baseRef: "origin/main" });
		expect(status.behind).toBeGreaterThanOrEqual(1);
	});

	test("reports a missing directory and flags a stale lock", async () => {
		const missing = await statusOf(makeFakePi(), { path: join(tempDir("pi-wt-missing-"), "nope") }, {});
		expect(missing.state).toBe("missing");

		const { repo, dir } = await worktree();
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });
		const stale = await statusOf(makeFakePi(), { path: dir, branch: "wt", locked: "pi:999999:sess" }, {});
		expect(stale.locked).toBe(true);
		expect(stale.staleLock).toBe(true);
	});
});

describe.skipIf(!runSlowSuites)("git plumbing", () => {
	test("creates, inspects, locks, and removes a worktree", async () => {
		const repo = temps.track(await makeRepo("pi-wt-git-"));
		const dir = managedPath(repo, "one");
		expect((await worktreeAdd(pi, repo, dir, "worktree-one", "HEAD")).ok).toBe(true);
		expect(await worktreeExists(pi, dir)).toBe(true);

		writeFileSync(join(dir, "dirty.txt"), "x");
		expect((await statusEntries(pi, dir)).length).toBeGreaterThan(0);

		expect(await lockWorktree(pi, repo, dir, "pi:1:test")).toBe(true);
		let managed = await listManagedWorktrees(pi, repo, testConfig());
		const locked = managed.find((entry) => entry.path === dir);
		expect(locked?.locked).toBe("pi:1:test");

		await unlockWorktree(pi, repo, dir);
		managed = await listManagedWorktrees(pi, repo, testConfig());
		expect(managed.find((entry) => entry.path === dir)?.locked).toBeUndefined();

		expect((await worktreeRemove(pi, repo, dir, true)).ok).toBe(true);
		expect(await worktreeExists(pi, dir)).toBe(false);
	});

	test("lists managed worktrees with canonical paths, so no caller re-resolves them", async () => {
		if (!canCreateSymlinks()) return;
		const repo = temps.track(await makeRepo("pi-wt-canonical-"));
		const dir = managedPath(repo, "canon");
		expect((await worktreeAdd(pi, repo, dir, "worktree-canon", "HEAD")).ok).toBe(true);

		// Reach the same repository through a link: git reports the path it recorded,
		// and the listing is what resolves it, once, for every reader downstream.
		const link = join(temps.track(tempDir("pi-wt-link-")), "repo");
		symlinkSync(repo, link, "dir");
		const managed = await listManagedWorktrees(pi, link, testConfig());

		expect(managed.length).toBeGreaterThan(0);
		expect(managed.some((entry) => entry.path === realPathOfNearest(dir))).toBe(true);
		for (const entry of managed) expect(entry.path).toBe(realPathOfNearest(entry.path));
	});

	test("attaches an existing branch instead of creating it", async () => {
		const attachRepo = temps.track(await makeRepo("pi-wt-attach-"));
		expect(await branchExists(pi, attachRepo, "worktree-attach")).toBe(false);
		const dir = managedPath(attachRepo, "attach");
		expect((await worktreeAdd(pi, attachRepo, dir, "worktree-attach", "HEAD")).ok).toBe(true);
		expect(await branchExists(pi, attachRepo, "worktree-attach")).toBe(true);

		// Remove the checkout but keep the branch, then attach it again.
		expect((await worktreeRemove(pi, attachRepo, dir, false)).ok).toBe(true);
		expect((await worktreeAdd(pi, attachRepo, dir, "worktree-attach", "HEAD", false)).ok).toBe(true);
		expect((await statusEntries(pi, dir)).length).toBe(0);
	});

	test("counts commits ahead of the merge base", async () => {
		const countRepo = temps.track(await makeRepo("pi-wt-count-"));
		const dir = managedPath(countRepo, "two");
		await worktreeAdd(pi, countRepo, dir, "worktree-two", "HEAD");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const fork = await mergeBase(pi, dir, "main");
		expect(fork).toBeDefined();
		expect(await commitsAhead(pi, dir, fork as string)).toBe(1);
	});

	test("checkCheckout classifies gone, unsafe, and ok", async () => {
		const checkRepo = temps.track(await makeRepo("pi-wt-check-"));
		expect((await checkCheckout(pi, join(checkRepo, "nope"), checkRepo)).ok).toBe(false);
		const self = await checkCheckout(pi, checkRepo, checkRepo);
		expect(self.ok ? undefined : self.reason).toBe("unsafe");

		const dir = managedPath(checkRepo, "check");
		await worktreeAdd(pi, checkRepo, dir, "worktree-check", "HEAD");
		expect((await checkCheckout(pi, dir, checkRepo)).ok).toBe(true);
	});

	test("isIgnored follows a wider gitignore rule", async () => {
		const ignoreRepo = temps.track(await makeRepo("pi-wt-ignored-"));
		writeFileSync(join(ignoreRepo, ".gitignore"), ".pi/\n");
		expect(await isIgnored(pi, ignoreRepo, ".pi/worktrees/")).toBe(true);
		expect(await isIgnored(pi, ignoreRepo, "README.md")).toBe(false);
	});

	test("submoduleChanges is known when there are no submodules", async () => {
		const subRepo = temps.track(await makeRepo("pi-wt-sub-"));
		expect(await submoduleChanges(pi, subRepo)).toEqual({ known: true, count: 0 });
	});
});

describe("git metadata failure paths", () => {
	test("checkCheckout reports unverified when git metadata cannot be read", async () => {
		const dir = temps.track(tempDir("pi-wt-unverified-"));
		const stub = stubPi((args) =>
			args.includes("--show-toplevel")
				? { stdout: "/elsewhere/wt\n", code: 0 }
				: args.includes("--git-common-dir")
					? { code: 1, stderr: "fatal: not a git repository" }
					: undefined,
		);
		const check = await checkCheckout(stub, dir, join(dir, "main"));
		expect(check.ok ? undefined : check.reason).toBe("unverified");
	});

	test("submoduleChanges reports unknown when git cannot inspect the submodules", async () => {
		const listFails = stubPi((args) => (args[0] === "submodule" && args[1] === "status" ? { code: 1 } : undefined));
		expect(await submoduleChanges(listFails, "/repo")).toEqual({ known: false, count: 0 });

		const foreachFails = stubPi((args) => {
			if (args[0] !== "submodule") return undefined;
			return args[1] === "status" ? { stdout: " abc sub\n", code: 0 } : { code: 1 };
		});
		expect(await submoduleChanges(foreachFails, "/repo")).toEqual({ known: false, count: 0 });
	});

	test("submoduleChanges counts porcelain lines and ignores Entering banners", async () => {
		const stub = stubPi((args) => {
			if (args[0] !== "submodule") return undefined;
			if (args[1] === "status") return { stdout: " abc sub\ndef sub2\n", code: 0 };
			return { stdout: "Entering 'sub'\n M a.txt\nEntering 'sub2'\n", code: 0 };
		});
		expect(await submoduleChanges(stub, "/repo")).toEqual({ known: true, count: 1 });
	});

	test("a fetch disables terminal prompting and restores the previous value", async () => {
		let during: string | undefined;
		const stub = stubPi(() => {
			during = process.env.GIT_TERMINAL_PROMPT;
			return { code: 0 };
		});

		await withEnv({ GIT_TERMINAL_PROMPT: "keepme" }, async () => {
			expect((await fetchPrRef(stub, "/repo", { number: 1, host: "github" }, 1000)).ok).toBe(true);
			expect(process.env.GIT_TERMINAL_PROMPT).toBe("keepme");
		});
		expect(during).toBe("0");
	});
});

describe.skipIf(!runSlowSuites)("base ref and remote", () => {
	let repo: string;

	test("resolves a fresh remote base and honors the head mode", async () => {
		const made = await makeRepoWithRemote("pi-wt-base-");
		repo = temps.track(made.repo);
		const remote = temps.track(made.remote);

		expect(await defaultBranch(pi, repo)).toBe("main");
		const base = await resolveBaseRef(pi, repo, testConfig());
		expect(base).toEqual({ ref: "origin/main", mode: "fresh" });
		expect(await resolveBaseRef(pi, repo, testConfig({ baseRef: "head" }))).toEqual({ ref: "HEAD", mode: "head" });

		await execP("git", ["fetch", "-q", "origin"], { cwd: repo });
		expect(await fetchStale(pi, repo)).toBe(false);

		// Publish a commit under refs/pull/9/head on the remote, then fetch it.
		const work = temps.track(tempDir("pi-wt-prwork-"));
		await execP("git", ["clone", "-q", remote, work]);
		writeFileSync(join(work, "pr.txt"), "from-pr");
		await execP("git", ["add", "."], { cwd: work });
		await execP("git", ["commit", "-qm", "pr"], { cwd: work });
		await execP("git", ["push", "-q", "origin", "HEAD:refs/pull/9/head"], { cwd: work });

		expect((await fetchPrRef(pi, repo, { number: 9, host: "other" }, 10_000)).ok).toBe(true);
		const show = await execP("git", ["show", "FETCH_HEAD:pr.txt"], { cwd: repo });
		expect(show.stdout.trim()).toBe("from-pr");
	});
});

describe("parsePrReference", () => {
	const cases: Array<[string, PrReference | undefined]> = [
		["#1234", { number: 1234, host: "other" }],
		["https://github.com/owner/repo/pull/42", { number: 42, host: "github" }],
		["https://gitlab.com/group/repo/-/merge_requests/7", { number: 7, host: "gitlab" }],
		["https://example.com/owner/repo/pull/5", { number: 5, host: "other" }],
		["feature-auth", undefined],
		["https://example.com/not-a-pr", undefined],
	];

	test("parses PR/MR references and rejects ordinary names", () => {
		for (const [input, expected] of cases) {
			expect(parsePrReference(input)).toEqual(expected);
		}
	});
});

describe("worktree path", () => {
	// The missing levels are below the link, which is the shape a one-level
	// realpath fallback leaves unresolved.
	symlinkTest("resolves a managed directory that does not exist through a link", () => {
		const base = temps.track(tempDir("pi-wt-path-"));
		const real = join(base, "real");
		mkdirSync(real);
		symlinkSync(real, join(base, "link"));

		expect(worktreePath(join(base, "link"), testConfig(), "fresh")).toBe(
			join(realpathSync.native(real), ".pi", "worktrees", "fresh"),
		);
	});
});

describe("include matcher", () => {
	test("basename patterns match at any depth and anchored patterns do not", () => {
		expect(isIncluded(".env", ["*.env"])).toBe(true);
		expect(isIncluded("nested/deep/.env.local", ["*.env.local"])).toBe(true);
		expect(isIncluded("nested/config.json", ["*.env"])).toBe(false);
		expect(isIncluded("config/secrets.json", ["config/secrets.json"])).toBe(true);
		expect(isIncluded("nested/config/secrets.json", ["config/secrets.json"])).toBe(false);
	});

	test("** spans directories and a trailing slash matches directory contents", () => {
		expect(isIncluded("vendor/config.json", ["vendor/**/config.json"])).toBe(true);
		expect(isIncluded("vendor/a/b/config.json", ["vendor/**/config.json"])).toBe(true);
		expect(isIncluded("other/vendor/config.json", ["vendor/**/config.json"])).toBe(false);
		expect(isIncluded("logs", ["logs/"])).toBe(true);
		expect(isIncluded("logs/app.log", ["logs/"])).toBe(true);
		expect(isIncluded("logs2/app.log", ["logs/"])).toBe(false);
	});

	test("the last match wins, so negation can re-include a path", () => {
		expect(isIncluded("a.env", ["*.env", "!a.env"])).toBe(false);
		expect(isIncluded("b.env", ["*.env", "!a.env"])).toBe(true);
		expect(isIncluded("a.env", ["!a.env", "*.env"])).toBe(true);
	});

	test("supports character classes, ranges, negation, and escapes", () => {
		expect(isIncluded("a.env", ["[ab].env"])).toBe(true);
		expect(isIncluded("c.env", ["[ab].env"])).toBe(false);
		expect(isIncluded("b.env", ["[a-c].env"])).toBe(true);
		expect(isIncluded("a.env", ["[!a].env"])).toBe(false);
		expect(isIncluded("b.env", ["[!a].env"])).toBe(true);
		expect(isIncluded("*.env", ["\\*.env"])).toBe(true);
		expect(isIncluded("a.env", ["\\*.env"])).toBe(false);
	});

	test("includePatterns reads .worktreeinclude, skips comments, and falls back", () => {
		const repo = temps.track(tempDir("pi-wt-inc-"));
		expect(includePatterns(repo, ["fallback"])).toEqual(["fallback"]);

		writeFileSync(join(repo, ".worktreeinclude"), "# comment\n.env\n\nconfig/secrets.json\n");
		expect(includePatterns(repo, ["fallback"])).toEqual([".env", "config/secrets.json"]);
	});
});

describe.skipIf(!runSlowSuites)("copyIncludes", () => {
	let repo: string;
	let target: string;
	let patterns: string[];

	beforeAll(async () => {
		repo = temps.track(await makeRepo("pi-wt-copy-"));
		target = temps.track(tempDir("pi-wt-target-"));
		writeFileSync(join(repo, ".gitignore"), ".env\nconfig/secrets.json\nbuild/\n.pi/worktrees/\n");
		writeFileSync(join(repo, ".env"), "SECRET=1\n");
		mkdirSync(join(repo, "config"));
		writeFileSync(join(repo, "config", "secrets.json"), "{}\n");
		mkdirSync(join(repo, "build"));
		writeFileSync(join(repo, "build", "out.txt"), "artifact\n");
		mkdirSync(join(repo, ".pi", "worktrees", "other"), { recursive: true });
		writeFileSync(join(repo, ".pi", "worktrees", "other", ".env"), "OTHER=1\n");
		writeFileSync(join(repo, ".worktreeinclude"), ".env\nconfig/secrets.json\nbuild/\n");
		await execP("git", ["add", ".gitignore", ".worktreeinclude"], { cwd: repo });
		await execP("git", ["commit", "-qm", "ignore"], { cwd: repo });
		patterns = includePatterns(repo, []);
	});

	test("copies matching gitignored files, preserving paths and skipping the managed dir", async () => {
		const copied = await copyIncludes(pi, repo, target, patterns, ".pi/worktrees");

		expect(copied.sort()).toEqual([".env", "build/out.txt", "config/secrets.json"]);
		expect(existsSync(join(target, ".env"))).toBe(true);
		expect(existsSync(join(target, "config", "secrets.json"))).toBe(true);
		expect(existsSync(join(target, "build", "out.txt"))).toBe(true);
		// The other worktree's ignored .env matches the pattern but is excluded.
		expect(existsSync(join(target, ".pi", "worktrees", "other", ".env"))).toBe(false);
	});

	test("never overwrites an existing file and does nothing without patterns", async () => {
		const existing = join(target, ".env");
		writeFileSync(existing, "KEEP=1\n");
		expect(await copyIncludes(pi, repo, target, patterns, ".pi/worktrees")).not.toContain(".env");
		expect(await copyIncludes(pi, repo, target, [])).toEqual([]);
	});
});

describe("handoff", () => {
	function handoff(over: Partial<Handoff> = {}): Handoff {
		return { branch: "worktree-hitl-fix", base: "trunk", ahead: 2, merged: false, ...over };
	}

	test("names the branch, its lead, and both ways to finish", () => {
		const lines = handoffLines(handoff());
		expect(lines[0]).toContain("worktree-hitl-fix");
		expect(lines[0]).toContain("2 commits ahead of trunk");
		expect(lines.join("\n")).toContain("git switch trunk && git merge --no-ff worktree-hitl-fix");
		expect(lines.join("\n")).toContain("gh pr create --head worktree-hitl-fix");
	});

	test("singularizes one commit", () => {
		expect(handoffLines(handoff({ ahead: 1 }))[0]).toContain("1 commit ahead of trunk");
	});

	test("prints no command for a merged or empty branch", () => {
		expect(handoffLines(handoff({ merged: true, ahead: 2 }))).toHaveLength(1);
		expect(handoffLines(handoff({ merged: true, ahead: 2 })).join("\n")).not.toContain("git switch");
		expect(handoffLines(handoff({ ahead: 0 }))).toHaveLength(1);
	});

	test("says a branch with no commits never landed, instead of calling it merged", () => {
		// A worktree that never committed is an ancestor of its base, which reads as merged
		// unless the count is asked for.
		expect(handoffLines(handoff({ ahead: 0, merged: true, commits: 0 }))).toEqual([
			"Handoff: worktree-hitl-fix has no commits beyond trunk — nothing to merge.",
		]);
		expect(handoffLines(handoff({ ahead: 0, merged: true, commits: 3 })).join("\n")).toContain("is merged into trunk");
	});

	test("does not invent a merge target or a branch", () => {
		expect(handoffLines(handoff({ base: null, ahead: 2 })).join("\n")).not.toContain("git switch");
		expect(handoffLines(handoff({ branch: null }))).toEqual(["Handoff: the worktree had no branch to hand off."]);
	});
});

describe("isolation gaps", () => {
	function input(overrides: Partial<GapInput> = {}): GapInput {
		return {
			platform: "linux",
			activeTools: ["read", "bash", "write", "edit"],
			config: testConfig(),
			unverifiableCommands: 0,
			...overrides,
		};
	}

	const surfaces = (facts: GapInput): string[] => isolationGaps(facts).map((gap) => gap.surface);

	test("names the user's shell and the unverifiable-command gap on any platform", () => {
		expect(surfaces(input())).toEqual(["! shell", "unverifiable"]);
	});

	test("counts the commands it let through unverified, and leaves the count out at zero", () => {
		const gaps = isolationGaps(input({ unverifiableCommands: 2 }));
		const detail = gaps.find((gap) => gap.surface === "unverifiable")?.detail ?? "";
		expect(detail).toContain("2 ran this session");

		const quiet = isolationGaps(input()).find((gap) => gap.surface === "unverifiable")?.detail ?? "";
		expect(quiet).not.toContain("ran this session");
	});

	test("drops the unverifiable gap when the guard refuses those commands", () => {
		expect(surfaces(input({ config: testConfig({ guard: { blockUnparsableCommands: true } }) }))).toEqual(["! shell"]);
	});

	test("names powershell only on Windows, with the tool active, and only when it is allowed", () => {
		const allowed = testConfig({ guard: { blockPowershell: false } });
		const windows = { platform: "win32", activeTools: ["read", "bash", "powershell"], config: allowed };

		expect(surfaces(input(windows))).toEqual(["! shell", "powershell", "unverifiable"]);
		// Refusing the tool is isolation, so there is no gap to report.
		expect(surfaces(input({ ...windows, config: testConfig() }))).toEqual(["! shell", "unverifiable"]);
		expect(surfaces(input({ ...windows, activeTools: ["read", "bash"] }))).toEqual(["! shell", "unverifiable"]);
		expect(surfaces(input({ ...windows, platform: "darwin" }))).toEqual(["! shell", "unverifiable"]);
	});

	test("gapLines prints nothing for no gaps and aligns every detail column", () => {
		expect(gapLines([])).toEqual([]);

		const gaps = isolationGaps(
			input({
				platform: "win32",
				activeTools: ["powershell"],
				config: testConfig({ guard: { blockPowershell: false } }),
			}),
		);
		const lines = gapLines(gaps);
		const column = Math.max(...gaps.map((gap) => gap.surface.length));
		expect(lines).toHaveLength(gaps.length);
		for (const [index, gap] of gaps.entries()) {
			expect(lines[index].startsWith(`  ${gap.surface}`)).toBe(true);
			expect(lines[index].indexOf(gap.detail)).toBe(2 + column + 2);
		}
	});
});

describe.skipIf(!runSlowSuites)("pruneWorktrees", () => {
	/** Well past the default 7-day prune age, with no wall clock involved. */
	const AGED_MS = 30 * 86_400_000;

	/** Create a clean worktree and leave it behind, as a previous session would. */
	async function keptWorktree(repo: string, name: string): Promise<string> {
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name });
		await harness.run(WORKTREE_TOOLS.exit, { remove: false });
		return managedPath(repo, name);
	}

	/** Backdate a worktree on disk and in the registry. */
	function age(repo: string, dir: string): void {
		const seconds = AGED_MS / 1000;
		utimesSync(dir, seconds, seconds);
		touchRecord(repo, testConfig(), dir, AGED_MS);
	}

	async function prune(repo: string): Promise<string> {
		const harness = await bootWorktree(repo);
		const result = await harness.run(WORKTREE_TOOLS.prune, {});
		return result.content[0].text;
	}

	test("removes an aged clean worktree and keeps a recent one", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-");
		temps.track(repo);
		temps.track(remote);

		const oldDir = await keptWorktree(repo, "old");
		const newDir = await keptWorktree(repo, "new");
		age(repo, oldDir);

		const text = await prune(repo);
		expect(text).toContain(`Removed ${oldDir}`);
		expect(text).toContain(`Kept ${newDir} (recent)`);
		expect(existsSync(oldDir)).toBe(false);
		expect(existsSync(newDir)).toBe(true);
	}, 60_000); // two worktrees on a remote-backed repo; allow for parallel contention

	test("keeps the current worktree", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-cur-");
		temps.track(repo);
		temps.track(remote);
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "cur" });
		const dir = managedPath(repo, "cur");

		const result = await harness.run(WORKTREE_TOOLS.prune, {});
		expect(result.content[0].text).toContain(`${dir} (current)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a worktree locked by a live process", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-live-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "live");
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:sess`, dir], { cwd: repo });
		age(repo, dir);

		expect(await prune(repo)).toContain(`${dir} (locked)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("unlocks and prunes a worktree locked by a dead process", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-dead-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "dead");
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });
		age(repo, dir);

		expect(await prune(repo)).toContain(`Removed ${dir}`);
		expect(existsSync(dir)).toBe(false);
	}, 60_000); // lock probe plus prune; allow for parallel contention

	test("keeps a worktree that contains work", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-work-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "work");
		writeFileSync(join(dir, "dirty.txt"), "x");
		age(repo, dir);

		expect(await prune(repo)).toContain(`${dir} (has work)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a worktree when the default branch is unknown", async () => {
		const repo = temps.track(await makeRepo("pi-wt-prune-nodef-"));
		const dir = await keptWorktree(repo, "nodef");
		age(repo, dir);

		expect(await prune(repo)).toContain(`${dir} (no default branch)`);
		expect(existsSync(dir)).toBe(true);
	});
});
