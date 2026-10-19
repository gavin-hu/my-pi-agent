import { afterAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKTREE_TOOLS } from "./tools.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { bootWorktree } from "../../test/helpers/fixtures/worktree.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function worktreePath(repo: string, name: string): string {
	return join(repo, ".pi", "worktrees", name);
}

describe.skipIf(!runSlowSuites)("exitWorktree", () => {
	test("removes a clean worktree and its branch", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "a" });
		const dir = worktreePath(repo, "a");

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(existsSync(dir)).toBe(false);
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).not.toContain("worktree-a");
	});

	test("keeps a dirty worktree when exiting without UI", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty" });
		const dir = worktreePath(repo, "dirty");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, {});
		expect(result.content[0].text).toContain("Kept worktree");
		expect(existsSync(dir)).toBe(true);
	});

	test("treats a declined exit prompt as a normal result and keeps the binding", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Cancel" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "declined" });
		const dir = worktreePath(repo, "declined");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, {});
		expect(result.content[0].text).toMatch(/cancelled/i);
		expect(result.isError).not.toBe(true);
		expect(result.details.cancelled).toBe(true);
		expect(existsSync(dir)).toBe(true);
		expect(harness.ctx.statuses.get("worktree")).toContain("declined");
	});

	test("reports a declined /worktree exit as info, not an error", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Cancel" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "declined-cmd" });
		writeFileSync(join(worktreePath(repo, "declined-cmd"), "work.txt"), "x");

		await harness.command("exit");
		const notice = harness.ctx.noticeEntries.at(-1);
		expect(notice.kind).toBe("info");
		expect(notice.message).toMatch(/cancelled/i);
	});

	test("keeps a branch with unmerged commits on forced removal", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "commits" });
		const dir = worktreePath(repo, "commits");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(result.content[0].text).toMatch(/Kept branch worktree-commits/);
		expect(existsSync(dir)).toBe(false);
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).toContain("worktree-commits");
	});

	test("hands the branch back with the command that finishes it", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "hand" });
		const dir = worktreePath(repo, "hand");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		const text = result.content[0].text;

		expect(text).toContain("Handoff: worktree-hand is 1 commit ahead of main.");
		expect(text).toContain("git switch main && git merge --no-ff worktree-hand");
		expect(text).toContain("gh pr create --head worktree-hand");
		expect(result.details.handoff).toMatchObject({ branch: "worktree-hand", base: "main", ahead: 1, merged: false });
	});

	test("counts against the base branch, not the commit recorded at entry", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "rebased" });
		const dir = worktreePath(repo, "rebased");

		// The base branch moves on after the worktree was cut, which is what a rebase
		// or a peer merge does; only the worktree's own commit is its lead.
		writeFileSync(join(repo, "elsewhere.txt"), "x");
		await execP("git", ["add", "."], { cwd: repo });
		await execP("git", ["commit", "-qm", "base moved"], { cwd: repo });

		writeFileSync(join(dir, "mine.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "mine"], { cwd: dir });

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });

		expect(result.content[0].text).toContain("Handoff: worktree-rebased is 1 commit ahead of main.");
		expect(result.details.handoff).toMatchObject({ base: "main", ahead: 1, merged: false });
	});

	test("says there is nothing to merge once the branch was deleted", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "empty" });

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		const text = result.content[0].text;

		expect(text).toContain("Deleted branch worktree-empty");
		// The branch is gone, so the handoff names the deletion rather than a merge.
		expect(text).toContain("nothing to merge");
		expect(text).not.toContain("git merge --no-ff");
	});

	test("names the branch it kept for a dirty worktree", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty" });
		const dir = worktreePath(repo, "dirty");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: false });
		const text = result.content[0].text;

		expect(text).toContain("Kept worktree");
		// The branch is a fresh pointer at the same commit, so it is already merged.
		expect(text).toContain("Handoff: worktree-dirty is merged into main — nothing to merge.");
		expect(result.details.handoff).toMatchObject({ branch: "worktree-dirty", ahead: 0, merged: true });
	});

	test("keeps a dirty worktree's branch when the user chooses remove", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Remove it and its branch" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty2" });
		const dir = worktreePath(repo, "dirty2");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, {});
		expect(result.content[0].text).toContain("Removed worktree");
		expect(result.content[0].text).toContain("Kept branch worktree-dirty2");
		expect(existsSync(dir)).toBe(false);
	});

	test("keeps commits made in a worktree entered by path", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);

		await harness.run(WORKTREE_TOOLS.enter, { name: "bypath" });
		const dir = worktreePath(repo, "bypath");
		await harness.run(WORKTREE_TOOLS.exit, { remove: false });

		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		await harness.run(WORKTREE_TOOLS.enter, { path: dir });
		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(result.content[0].text).toMatch(/Kept branch worktree-bypath/);
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).toContain("worktree-bypath");
	});
});
