import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	branchExists,
	canonicalize,
	checkCheckout,
	commitsAhead,
	currentBranch,
	defaultBranch,
	fetchPrRef,
	fetchStale,
	hasCommits,
	isProcessAlive,
	listManagedWorktrees,
	lockWorktree,
	mergeBase,
	parsePrReference,
	repoRoot,
	resolveBaseRef,
	statusEntries,
	submoduleChanges,
	unlockWorktree,
	withGitNoPrompt,
	worktreeAdd,
	worktreeExists,
	worktreeRemove,
} from "./git.ts";
import { cleanup, execP, makeRepo, makeRepoWithRemote } from "../../test/helpers/git.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { makeFakePi, testConfig } from "../../test/helpers/fixtures/worktree.ts";

const pi = makeFakePi();
const cleanups: string[] = [];

/** A `pi` whose `exec` answers from a route table, for metadata-failure paths. */
function stubPi(route: (args: string[]) => { stdout?: string; stderr?: string; code?: number } | undefined): any {
	return {
		exec: async (_command: string, args: string[]) => {
			const result = route(args) ?? { code: 1 };
			return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 0 };
		},
	};
}

afterAll(() => cleanup(...cleanups));

describe("git helpers", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-wt-git-");
		cleanups.push(repo);
	});

	test("repoRoot and hasCommits", async () => {
		expect(await repoRoot(pi, repo)).toBe(canonicalize(repo));
		expect(await hasCommits(pi, repo)).toBe(true);
	});

	test("repoRoot is undefined outside a repository", async () => {
		const { mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const outside = mkdtempSync(join(tmpdir(), "pi-wt-nogit-"));
		cleanups.push(outside);
		expect(await repoRoot(pi, outside)).toBeUndefined();
	});

	test("create, inspect, and remove a worktree", async () => {
		const dir = join(repo, ".pi", "worktrees", "one");
		const created = await worktreeAdd(pi, repo, dir, "worktree-one", "HEAD");
		expect(created.ok).toBe(true);
		expect(await worktreeExists(pi, dir)).toBe(true);
		expect(await currentBranch(pi, dir)).toBe("worktree-one");

		writeFileSync(join(dir, "dirty.txt"), "x");
		expect((await statusEntries(pi, dir)).length).toBeGreaterThan(0);

		const removed = await worktreeRemove(pi, repo, dir, true);
		expect(removed.ok).toBe(true);
		expect(await worktreeExists(pi, dir)).toBe(false);
	});

	test("branchExists and attaching an existing branch", async () => {
		expect(await branchExists(pi, repo, "worktree-attach")).toBe(false);
		const dir = join(repo, ".pi", "worktrees", "attach");
		expect((await worktreeAdd(pi, repo, dir, "worktree-attach", "HEAD")).ok).toBe(true);
		expect(await branchExists(pi, repo, "worktree-attach")).toBe(true);

		// Remove the worktree but keep the branch, then attach it again.
		await worktreeRemove(pi, repo, dir, false);
		expect((await worktreeAdd(pi, repo, dir, "worktree-attach", "HEAD", false)).ok).toBe(true);
		expect(await currentBranch(pi, dir)).toBe("worktree-attach");
		await worktreeRemove(pi, repo, dir, false);
	});

	test("commitsAhead and mergeBase", async () => {
		const dir = join(repo, ".pi", "worktrees", "two");
		await worktreeAdd(pi, repo, dir, "worktree-two", "HEAD");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const fork = await mergeBase(pi, dir, "main");
		expect(fork).toBeDefined();
		expect(await commitsAhead(pi, dir, fork as string)).toBe(1);
		await worktreeRemove(pi, repo, dir, true);
	});

	test("lock / unlock is reflected in the worktree list", async () => {
		const dir = join(repo, ".pi", "worktrees", "locked");
		await worktreeAdd(pi, repo, dir, "worktree-locked", "HEAD");
		expect(await lockWorktree(pi, repo, dir, "pi:1:test")).toBe(true);

		let managed = await listManagedWorktrees(pi, repo, testConfig());
		const locked = managed.find((entry) => entry.path === canonicalize(dir));
		expect(locked?.locked).toBe("pi:1:test");

		await unlockWorktree(pi, repo, dir);
		managed = await listManagedWorktrees(pi, repo, testConfig());
		expect(managed.find((entry) => entry.path === canonicalize(dir))?.locked).toBeUndefined();

		await worktreeRemove(pi, repo, dir, false);
	});

	test("checkCheckout classifies gone, unsafe, and ok", async () => {
		expect((await checkCheckout(pi, join(repo, "nope"), repo)).ok).toBe(false);
		const self = await checkCheckout(pi, repo, repo);
		expect(self.ok ? undefined : self.reason).toBe("unsafe");

		const dir = join(repo, ".pi", "worktrees", "check");
		await worktreeAdd(pi, repo, dir, "worktree-check", "HEAD");
		expect((await checkCheckout(pi, dir, repo)).ok).toBe(true);
		await worktreeRemove(pi, repo, dir, false);
	});

	test("submoduleChanges reports known with no submodules", async () => {
		expect(await submoduleChanges(pi, repo)).toEqual({ known: true, count: 0 });
	});

	test("checkCheckout reports unverified when git metadata cannot be read", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-wt-unverified-"));
		cleanups.push(dir);
		const stub = stubPi((args) =>
			args.includes("--show-toplevel")
				? { stdout: "/elsewhere/wt\n", code: 0 }
				: args.includes("--git-common-dir")
					? { code: 1, stderr: "fatal: not a git repository" }
					: undefined,
		);
		const check = await checkCheckout(stub, dir, join(dir, "main"));
		expect(check.ok).toBe(false);
		expect(check.ok ? undefined : check.reason).toBe("unverified");
	});

	test("submoduleChanges reports unknown when the submodule listing fails", async () => {
		const stub = stubPi((args) => (args[0] === "submodule" && args[1] === "status" ? { code: 1 } : undefined));
		expect(await submoduleChanges(stub, "/repo")).toEqual({ known: false, count: 0 });
	});

	test("submoduleChanges counts porcelain lines and ignores Entering banners", async () => {
		const stub = stubPi((args) => {
			if (args[0] !== "submodule") return undefined;
			if (args[1] === "status") return { stdout: " abc sub\ndef sub2\n", code: 0 };
			return { stdout: "Entering 'sub'\n M a.txt\nEntering 'sub2'\n", code: 0 };
		});
		expect(await submoduleChanges(stub, "/repo")).toEqual({ known: true, count: 1 });
	});

	test("submoduleChanges reports unknown when the foreach inspection fails", async () => {
		const stub = stubPi((args) => {
			if (args[0] !== "submodule") return undefined;
			return args[1] === "status" ? { stdout: " abc sub\n", code: 0 } : { code: 1 };
		});
		expect(await submoduleChanges(stub, "/repo")).toEqual({ known: false, count: 0 });
	});

	test("isProcessAlive", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(isProcessAlive(-1)).toBe(false);
	});

	test("withGitNoPrompt sets and restores GIT_TERMINAL_PROMPT", async () => {
		await withEnv({ GIT_TERMINAL_PROMPT: undefined }, async () => {
			let during: string | undefined;
			await withGitNoPrompt(async () => {
				during = process.env.GIT_TERMINAL_PROMPT;
			});
			expect(during).toBe("0");
			expect(process.env.GIT_TERMINAL_PROMPT).toBeUndefined();
		});

		await withEnv({ GIT_TERMINAL_PROMPT: "keepme" }, async () => {
			await withGitNoPrompt(async () => {});
			expect(process.env.GIT_TERMINAL_PROMPT).toBe("keepme");
		});
	});
});

describe("base ref and remote", () => {
	let repo: string;
	let remote: string;

	beforeAll(async () => {
		const made = await makeRepoWithRemote("pi-wt-base-");
		repo = made.repo;
		remote = made.remote;
		cleanups.push(repo, remote);
	});

	test("defaultBranch and fresh base ref", async () => {
		expect(await defaultBranch(pi, repo)).toBe("main");
		const base = await resolveBaseRef(pi, repo, testConfig());
		expect(base.mode).toBe("fresh");
		expect(base.ref).toBe("origin/main");
	});

	test("head base ref", async () => {
		const base = await resolveBaseRef(pi, repo, testConfig({ baseRef: "head" }));
		expect(base).toEqual({ ref: "HEAD", mode: "head" });
	});

	test("fetchStale is false right after a fetch", async () => {
		await execP("git", ["fetch", "-q", "origin"], { cwd: repo });
		expect(await fetchStale(pi, repo)).toBe(false);
	});

	test("fetchPrRef pulls pull/N/head", async () => {
		// Publish a commit under refs/pull/9/head on the remote.
		const work = mkdtempSync(join(tmpdir(), "pi-wt-prwork-"));
		cleanups.push(work);
		await execP("git", ["clone", "-q", remote, work]);
		await execP("git", ["config", "user.email", "t@e.c"], { cwd: work });
		await execP("git", ["config", "user.name", "T"], { cwd: work });
		writeFileSync(join(work, "pr.txt"), "from-pr");
		await execP("git", ["add", "."], { cwd: work });
		await execP("git", ["commit", "-qm", "pr"], { cwd: work });
		await execP("git", ["push", "-q", "origin", "HEAD:refs/pull/9/head"], { cwd: work });

		const fetched = await fetchPrRef(pi, repo, { number: 9, host: "other" }, 10_000);
		expect(fetched.ok).toBe(true);
		const show = await execP("git", ["show", "FETCH_HEAD:pr.txt"], { cwd: repo });
		expect(show.stdout.trim()).toBe("from-pr");
	});
});

describe("parsePrReference", () => {
	test("parses #N", () => {
		expect(parsePrReference("#1234")).toEqual({ number: 1234, host: "other" });
	});

	test("parses GitHub pull URLs", () => {
		expect(parsePrReference("https://github.com/owner/repo/pull/42")).toEqual({ number: 42, host: "github" });
	});

	test("parses GitLab merge request URLs", () => {
		expect(parsePrReference("https://gitlab.com/group/repo/-/merge_requests/7")).toEqual({
			number: 7,
			host: "gitlab",
		});
	});

	test("returns undefined for ordinary names", () => {
		expect(parsePrReference("feature-auth")).toBeUndefined();
		expect(parsePrReference("https://example.com/not-a-pr")).toBeUndefined();
	});
});
