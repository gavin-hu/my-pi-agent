/**
 * The exit capability: the branch an exit may delete.
 *
 * `exit` deletes a branch only when it has counted that branch's commits against the
 * branch a merge would land on, and keeps it when the count cannot be read. Every case
 * binds the count to the branch rather than to the checkout's `HEAD`, and each one
 * creates a real repository, so the suite is gated by `test/helpers/slow-suite.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execP, makeRepo } from "../../test/helpers/git.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import {
	bootWorktree,
	makeBareWorktreePi,
	makeTempTracker,
	managedPath,
} from "../../test/helpers/fixtures/worktree.ts";
import { commitsAhead, inspectWork } from "./git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Commit a file in `dir`, so the branch there holds work of its own. */
async function commitIn(dir: string, name: string): Promise<void> {
	writeFileSync(join(dir, name), "x");
	await execP("git", ["add", "."], { cwd: dir });
	await execP("git", ["commit", "-qm", `work ${name}`], { cwd: dir });
}

describe.skipIf(!runSlowSuites)("the branch an exit may delete", () => {
	test("counts the branch it deletes, not a checkout on another branch", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-branch-"));
		const harness = await bootWorktree(repo);
		await harness.action("enter", { name: "detached" });
		const dir = managedPath(repo, "detached");
		await commitIn(dir, "work.txt");
		// A bisect or a second branch checked out here leaves the worktree's HEAD away from
		// the branch the exit would delete; the commits are the branch's, not HEAD's.
		await execP("git", ["checkout", "--detach"], { cwd: dir });

		const result = await harness.action("exit", { remove: true });
		const text = result.content[0].text;

		expect(text).toContain("Kept branch worktree-detached (1 commit(s) not merged");
		expect(text).not.toContain("Deleted branch");
		expect(text).toContain("Handoff: worktree-detached is 1 commit ahead of main.");
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).toContain("worktree-detached");
	});

	test("keeps the branch when the count cannot be read", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-uncounted-"));
		const harness = await bootWorktree(repo);
		await harness.action("enter", { name: "uncounted" });
		const dir = managedPath(repo, "uncounted");
		await commitIn(dir, "work.txt");
		const realExec = harness.pi.exec;
		harness.pi.exec = async (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => {
			if (command === "git" && args[0] === "rev-list") {
				return { stdout: "", stderr: "boom", code: 1, killed: false };
			}
			return realExec(command, args, options);
		};

		const result = await harness.action("exit", { remove: true });
		const text = result.content[0].text;

		// A refused count is not a branch with nothing on it.
		expect(text).toContain("Kept branch worktree-uncounted (its commits could not be counted");
		expect(text).not.toContain("Deleted branch");
		expect(text).toContain("Handoff: worktree-uncounted could not be counted against main");
		expect(text).not.toContain("git merge --no-ff");
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).toContain("worktree-uncounted");
	});

	test("deletes a branch the base branch has since taken in", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-merged-"));
		const harness = await bootWorktree(repo);
		await harness.action("enter", { name: "landed" });
		const dir = managedPath(repo, "landed");
		await commitIn(dir, "work.txt");
		// The base moves on and takes the branch with it, which is what a merge from another
		// checkout does: counting against the fork point would call this 1 commit of work
		// forever and never delete the branch.
		await execP("git", ["merge", "--no-ff", "-m", "land the work", "worktree-landed"], { cwd: repo });

		const result = await harness.action("exit", { remove: true });
		const text = result.content[0].text;

		expect(text).toContain("Deleted branch worktree-landed");
		expect(text).toContain("Handoff: worktree-landed is merged into main — nothing to merge.");
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).not.toContain("worktree-landed");
	});

	test("reports an uncountable range as unknown rather than zero", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-count-"));
		const dir = managedPath(repo, "counted");
		const pi = makeBareWorktreePi();

		expect(await commitsAhead(pi, repo, "no-such-ref")).toBeUndefined();

		await execP("git", ["worktree", "add", "-b", "worktree-counted", dir, "HEAD"], { cwd: repo });
		const inspected = await inspectWork(pi, dir, "no-such-ref", "worktree-counted");
		expect(inspected.ahead).toBeUndefined();
		expect(inspected.unverifiable).toBe(true);
		expect(inspected.hasWork).toBe(false);
	});
});
