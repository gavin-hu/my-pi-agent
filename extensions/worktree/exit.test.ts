import { afterAll, describe, expect, test } from "bun:test";
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

describe("exitWorktree", () => {
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
