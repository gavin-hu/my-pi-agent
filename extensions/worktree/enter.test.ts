/**
 * The enter capability: whose checkout an enter may touch.
 *
 * `enter` reopens an existing worktree at its old tip and resets a clean, not-ahead one to
 * the fresh base, so the lock is read first: a live session's lock refuses the entry, and a
 * lock whose owner is gone is taken over. Every case creates a real repository, so the suite
 * is gated by `test/helpers/slow-suite.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { messageOf } from "../../lib/errors.ts";
import { execP, makeRepo } from "../../test/helpers/git.ts";
import {
	bootWorktree,
	makeBareWorktreePi,
	makeTempTracker,
	managedPath,
	testConfig,
} from "../../test/helpers/fixtures/worktree.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { listManagedWorktrees } from "./git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Create the checkout `enter` would find, on the branch its name generates. */
async function makeCheckout(repo: string, name: string): Promise<string> {
	const dir = managedPath(repo, name);
	await execP("git", ["worktree", "add", "-b", `worktree-${name}`, dir], { cwd: repo });
	return dir;
}

/** HEAD of the checkout at `dir`. */
async function headOf(dir: string): Promise<string> {
	return (await execP("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
}

/** The lock reason `git worktree list` reports for `dir`, as the extension reads it. */
async function lockOf(repo: string, dir: string): Promise<string | undefined> {
	return (await listManagedWorktrees(makeBareWorktreePi(), repo, testConfig())).find((entry) => entry.path === dir)
		?.locked;
}

describe.skipIf(!runSlowSuites)("entering a checkout another session holds", () => {
	test("refuses a live session's lock and leaves the checkout where it is", async () => {
		const repo = temps.track(await makeRepo("pi-wt-held-"));
		const dir = await makeCheckout(repo, "held");
		const before = await headOf(dir);
		// A pid that is alive and a session that is not this one: the lock is another
		// session's claim, whether or not that session is still in this checkout.
		const reason = `pi:${process.pid}:other-session`;
		await execP("git", ["worktree", "lock", "--reason", reason, dir], { cwd: repo });
		// The base moves on, so an enter that kept to the old reuse rules would reset the
		// clean, not-ahead checkout to this commit.
		writeFileSync(join(repo, "base.txt"), "x");
		await execP("git", ["add", "."], { cwd: repo });
		await execP("git", ["commit", "-qm", "base moves"], { cwd: repo });

		const harness = await bootWorktree(repo);
		let failure: unknown;
		try {
			await harness.action("enter", { name: "held" });
		} catch (caught) {
			failure = caught;
		}

		expect(messageOf(failure)).toContain("locked by a live session");
		expect(messageOf(failure)).toContain(reason);
		expect(await headOf(dir)).toBe(before);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("takes over a lock whose owner is gone", async () => {
		const repo = temps.track(await makeRepo("pi-wt-stale-"));
		const dir = await makeCheckout(repo, "stale");
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });

		const harness = await bootWorktree(repo);
		const result = await harness.action("enter", { name: "stale" });

		expect(result.content[0].text).toContain("Entered worktree");
		// Reusing a stale lock is allowed, and the lock it leaves behind is this session's:
		// a dead owner's reason would let a second enter reset the tree again.
		expect(await lockOf(repo, dir)).toBe(`pi:${process.pid}:test-session`);
	});

	test("takes over a stale lock on a checkout entered by path", async () => {
		const repo = temps.track(await makeRepo("pi-wt-stale-path-"));
		const dir = await makeCheckout(repo, "bypath");
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });

		const harness = await bootWorktree(repo);
		expect((await harness.action("enter", { path: dir })).content[0].text).toContain("Entered worktree");

		// A path entry claims nothing by itself, but the stale lock it took over is this
		// session's claim now, so a prune cannot sweep the checkout it is working in.
		expect(await lockOf(repo, dir)).toBe(`pi:${process.pid}:test-session`);
	});

	test("re-enters a checkout this session already holds, and exits it cleanly", async () => {
		const repo = temps.track(await makeRepo("pi-wt-own-"));
		const dir = await makeCheckout(repo, "own");
		// What `exit` leaves behind when removal failed: the tree is still locked by the
		// session that kept it, and its message says to re-enter.
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:test-session`, dir], { cwd: repo });

		const harness = await bootWorktree(repo);
		expect((await harness.action("enter", { name: "own" })).content[0].text).toContain("Entered worktree");
		// Git refuses to remove a locked worktree, so this passes only if enter recorded the
		// lock it already held.
		expect((await harness.action("exit", { remove: true })).content[0].text).toContain(`Removed worktree ${dir}`);
	});
});
