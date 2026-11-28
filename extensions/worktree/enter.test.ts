/**
 * The enter capability: whose checkout an enter may touch, and what a sweep may take.
 *
 * `enter` reopens an existing worktree at its old tip and resets a clean, not-ahead one to
 * the fresh base, so the lock is read first: a live session's lock refuses the entry, and a
 * lock whose owner is gone — or whose reason names this process under a session id it no
 * longer runs — is taken over. Every case that touches a repository is gated by
 * `test/helpers/slow-suite.ts`; the owner rule itself is pure and runs everywhere.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { messageOf } from "../../lib/errors.ts";
import { isPidAlive } from "../../lib/spawn.ts";
import { execP, makeRepo, makeRepoWithRemote } from "../../test/helpers/git.ts";
import {
	age,
	bootWorktree,
	emitEvent,
	keptWorktree,
	makeBareWorktreePi,
	makeTempTracker,
	managedPath,
	prune,
	testConfig,
} from "../../test/helpers/fixtures/worktree.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { isIgnored, isStaleLock, listManagedWorktrees, replacedSessionOf } from "./git.ts";
import { reconcileOwnLocks } from "./locks.ts";
import { ENV_ROOT } from "./runtime.ts";

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

describe("the lock's owner", () => {
	const self = { pid: process.pid, sessionId: "test-session" };

	test("a dead pid is stale, whatever the rest of the reason says", () => {
		expect(isStaleLock("pi:999999:sess", self)).toBe(true);
	});

	test("this process's own lock under a session id it no longer runs is stale", () => {
		const reason = `pi:${self.pid}:older-session`;
		expect(isStaleLock(reason, self)).toBe(true);
		// The id is what `enter` names in the sentence it prints, from the same parse.
		expect(replacedSessionOf(reason, self)).toBe("older-session");
	});

	test("this process's own current lock is not stale", () => {
		expect(isStaleLock(`pi:${self.pid}:${self.sessionId}`, self)).toBe(false);
		expect(replacedSessionOf(`pi:${self.pid}:${self.sessionId}`, self)).toBeUndefined();
	});

	test("another live pid is not stale, so a peer's tree is never taken", () => {
		// The parent process is alive for the length of this run; the guard makes a broken
		// premise fail loudly rather than pass by accident.
		expect(isPidAlive(process.ppid)).toBe(true);
		expect(isStaleLock(`pi:${process.ppid}:sess`, self)).toBe(false);
	});

	test("a reason with no grammar, or no id in it, is not stale", () => {
		expect(isStaleLock("no reason recorded", self)).toBe(false);
		expect(isStaleLock(`pi:${self.pid}:`, self)).toBe(false);
	});

	test("without a self the answer is the pid's alone, which is what the display reads", () => {
		// The registry passes no `self`, so an own-earlier lock still shows as held there. Pinned
		// so a later change to the display has to notice this line rather than drift into it.
		expect(isStaleLock(`pi:${self.pid}:older-session`)).toBe(false);
	});
});

describe.skipIf(!runSlowSuites)("entering a checkout another session holds", () => {
	test("refuses a lock held by another live pid and leaves the checkout where it is", async () => {
		const repo = temps.track(await makeRepo("pi-wt-held-"));
		const dir = await makeCheckout(repo, "held");
		const before = await headOf(dir);
		// Another process's pid, alive for the length of this run: a stranger's claim, which is
		// exactly what must keep refusing now that this process's own lock does not.
		expect(isPidAlive(process.ppid)).toBe(true);
		const reason = `pi:${process.ppid}:other-session`;
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

	test("takes back its own lock when the reason names a session id it no longer runs", async () => {
		// What a `/new` leaves: this process wrote the lock under the id it had before, and the
		// pid is still alive, so the pid alone answered "held by a live session" and locked the
		// process out of its own tree.
		const repo = temps.track(await makeRepo("pi-wt-own-older-"));
		const dir = await makeCheckout(repo, "older");
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:older-session`, dir], { cwd: repo });

		const harness = await bootWorktree(repo);
		const text = (await harness.action("enter", { name: "older" })).content[0].text;

		expect(text).toContain("Entered worktree");
		expect(text).toContain(
			"Took back this process's own earlier lock: session older-se wrote it, and no session runs that id now.",
		);
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

describe.skipIf(!runSlowSuites)("a sweep and a lock", () => {
	test("takes back its own earlier lock, and prunes the tree it was holding", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-own-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "own");
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:older-session`, dir], { cwd: repo });
		age(repo, dir);

		expect(await prune(repo)).toContain(`Removed ${dir}`);
		expect(existsSync(dir)).toBe(false);
	});

	test("keeps a tree locked by another live pid", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-peer-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "peer");
		expect(isPidAlive(process.ppid)).toBe(true);
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.ppid}:sess`, dir], { cwd: repo });
		age(repo, dir);

		expect(await prune(repo)).toContain(`${dir} (locked)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("unlocks and prunes a tree locked by a dead process", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-dead-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "dead");
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });
		age(repo, dir);

		expect(await prune(repo)).toContain(`Removed ${dir}`);
		expect(existsSync(dir)).toBe(false);
	});
});

describe.skipIf(!runSlowSuites)("a start after the context id changes", () => {
	/** Lock a checkout as an earlier session of this process would have. */
	async function lockedEarlier(repo: string, dir: string): Promise<void> {
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:older-session`, dir], { cwd: repo });
	}

	test("renews the tree the session stands in, and releases one it left", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-start-own-");
		temps.track(repo);
		temps.track(remote);
		const standing = await keptWorktree(repo, "standing");
		const left = await keptWorktree(repo, "left");
		await lockedEarlier(repo, standing);
		await lockedEarlier(repo, left);

		const harness = await bootWorktree(repo);
		const note = await withEnv({ [ENV_ROOT]: standing }, () => reconcileOwnLocks(harness.pi, harness.ctx));

		expect(note).toContain(`Renewed this session's lock on ${basename(standing)}`);
		expect(note).toContain(`Released a lock this session's previous context left on ${basename(left)}`);
		expect(await lockOf(repo, standing)).toBe(`pi:${process.pid}:test-session`);
		expect(await lockOf(repo, left)).toBeUndefined();
	});

	test("renews nothing when the cwd is the checkout, and releases every own-stale lock", async () => {
		// The fallback's direction: a checkout contains no managed tree, and no tree contains the
		// checkout. Reversed, this would renew a tree nobody is standing in.
		const { repo, remote } = await makeRepoWithRemote("pi-wt-start-cwd-");
		temps.track(repo);
		temps.track(remote);
		const first = await keptWorktree(repo, "first");
		const second = await keptWorktree(repo, "second");
		await lockedEarlier(repo, first);
		await lockedEarlier(repo, second);

		const harness = await bootWorktree(repo);
		const note = await withEnv({ [ENV_ROOT]: undefined }, () => reconcileOwnLocks(harness.pi, harness.ctx));

		expect(note).not.toContain("Renewed");
		expect(note).toContain("Released 2 locks");
		expect(await lockOf(repo, first)).toBeUndefined();
		expect(await lockOf(repo, second)).toBeUndefined();
	});

	test("leaves a peer's lock and a dead pid's alone, even for the standing tree", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-start-peer-");
		temps.track(repo);
		temps.track(remote);
		const peer = await keptWorktree(repo, "peer");
		const dead = await keptWorktree(repo, "dead");
		expect(isPidAlive(process.ppid)).toBe(true);
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.ppid}:sess`, peer], { cwd: repo });
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dead], { cwd: repo });

		const harness = await bootWorktree(repo);
		// The peer's tree is the one this session claims to stand in, so a rule that renewed by
		// standing rather than by pid would take it.
		const note = await withEnv({ [ENV_ROOT]: peer }, () => reconcileOwnLocks(harness.pi, harness.ctx));

		expect(note).toBeUndefined();
		expect(await lockOf(repo, peer)).toBe(`pi:${process.ppid}:sess`);
		expect(await lockOf(repo, dead)).toBe("pi:999999:sess");
	});

	test("a re-lock that fails says the tree is open, instead of passing quietly", async () => {
		// The one outcome the notice must carry: the unlock succeeded and the lock did not, so the
		// standing tree is open until the next start. Silence here would be the state this module
		// exists to prevent, arriving as `undefined`.
		const { repo, remote } = await makeRepoWithRemote("pi-wt-start-fail-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "unlocked");
		await lockedEarlier(repo, dir);

		const harness = await bootWorktree(repo);
		const run = harness.pi.exec.bind(harness.pi);
		harness.pi.exec = async (command: string, args: string[], options: unknown) =>
			args.includes("lock") ? { code: 1, stdout: "", stderr: "lock refused" } : run(command, args, options);
		const note = await withEnv({ [ENV_ROOT]: dir }, () => reconcileOwnLocks(harness.pi, harness.ctx));

		expect(note).toContain(`Could not re-lock ${basename(dir)}: it is unlocked until the next start.`);
		expect(await lockOf(repo, dir)).toBeUndefined();
	});

	test("a non-startup start reconciles before the environment is cleared", async () => {
		// The wiring, and the card's shape: an empty branch (nothing restored) with `ENV_ROOT` at a
		// tree this pid locked under an older id. Remove the call and this case has no note and an
		// old reason.
		const { repo, remote } = await makeRepoWithRemote("pi-wt-start-wired-");
		temps.track(repo);
		temps.track(remote);
		const dir = await keptWorktree(repo, "wired");
		await lockedEarlier(repo, dir);

		const harness = await bootWorktree(repo);
		await withEnv({ [ENV_ROOT]: dir }, async () => {
			await emitEvent(harness.pi, "session_start", { reason: "new" }, harness.ctx);
		});

		expect(harness.ctx.notices.some((message: string) => message.includes("Renewed this session's lock"))).toBe(true);
		expect(await lockOf(repo, dir)).toBe(`pi:${process.pid}:test-session`);
	});
});

describe.skipIf(!runSlowSuites)("the ignore offer's question", () => {
	// `GIT_LITERAL_PATHSPECS` is what a Pi tool shell carries, and git answers `check-ignore`
	// with exit 128 on the pathspec before it reads any ignore file. Reading that as "not
	// ignored" made the offer append the same line every session (#822).
	const literal = { GIT_LITERAL_PATHSPECS: "1" };

	test("isIgnored answers in a shell that makes check-ignore refuse the question", async () => {
		const pi = makeBareWorktreePi();
		const repo = temps.track(await makeRepo("pi-wt-literal-"));
		writeFileSync(join(repo, ".gitignore"), ".pi/\n");

		await withEnv(literal, async () => {
			expect(await isIgnored(pi, repo, ".pi/worktrees/")).toBe(true);
			expect(await isIgnored(pi, repo, "README.md")).toBe(false);
		});
	});

	test("isIgnored reports undefined rather than unignored when git will not answer", async () => {
		const pi = makeBareWorktreePi();
		const outside = temps.track(tempDir("pi-wt-no-repo-"));

		expect(await isIgnored(pi, outside, "anything")).toBeUndefined();
	});

	test("offers nothing, and appends nothing, in that shell", async () => {
		const repo = temps.track(await makeRepo("pi-wt-literal-offer-"));
		writeFileSync(join(repo, ".gitignore"), ".pi/\n");
		const harness = await bootWorktree(repo, { hasUI: true });

		await withEnv(literal, async () => {
			await harness.action("enter", { name: "a" });
		});

		expect(harness.ctx.confirms).toEqual([]);
		expect(readFileSync(join(repo, ".gitignore"), "utf-8")).toBe(".pi/\n");
	});
});
