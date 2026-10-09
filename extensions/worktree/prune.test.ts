import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { touchRecord } from "./registry.ts";
import { WORKTREE_TOOLS } from "./tools.ts";
import { execP, makeRepo, makeRepoWithRemote, makeTempTracker } from "../../test/helpers/git.ts";
import { bootWorktree, testConfig } from "../../test/helpers/fixtures/worktree.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Well past the default 7-day prune age, with no wall clock involved. */
const AGED_MS = 30 * 86_400_000;

function worktreePath(repo: string, name: string): string {
	return join(repo, ".pi", "worktrees", name);
}

/** Create a clean worktree and leave it behind, as a previous session would. */
async function keptWorktree(repo: string, name: string): Promise<string> {
	const harness = await bootWorktree(repo);
	await harness.run(WORKTREE_TOOLS.enter, { name });
	await harness.run(WORKTREE_TOOLS.exit, { remove: false });
	return worktreePath(repo, name);
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

describe("pruneWorktrees", () => {
	test("removes an aged clean worktree and keeps a recent one", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-");
		temps.track(repo);
		temps.track(remote);

		const oldDir = await keptWorktree(repo, "old");
		const newDir = await keptWorktree(repo, "new");
		age(repo, oldDir);

		const text = await prune(repo);
		expect(text).toContain(`Removed ${oldDir}`);
		expect(text).toContain(newDir);
		expect(existsSync(oldDir)).toBe(false);
		expect(existsSync(newDir)).toBe(true);
	}, 60_000); // heaviest case: two worktrees on a remote-backed repo; allow for parallel contention

	test("keeps the current worktree", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-cur-");
		temps.track(repo);
		temps.track(remote);
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "cur" });
		const dir = worktreePath(repo, "cur");

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
