/**
 * The flow capability: the isolation guards, entering and exiting a worktree,
 * the `/worktree` command and its completions, and the extension's registration,
 * lifecycle, environment, prompt, and status surface.
 *
 * Guard checks are pure and run everywhere. Every case that creates, enters, or
 * removes a real worktree is gated by `test/helpers/slow-suite.ts`, so a local
 * `bun run check` stays fast while CI keeps the coverage.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isInsideReal, realPathOfNearest } from "../../lib/path.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx as sharedFakeCtx } from "../../test/helpers/context.ts";
import { execP, makeRepo } from "../../test/helpers/git.ts";
import {
	bootWorktree,
	emitEvent,
	makeFakeCtx,
	makeTempTracker,
	makeWorktreePi,
	testConfig,
	type WorktreeHarness,
} from "../../test/helpers/fixtures/worktree.ts";
import { analyzeBashCommand, guardFileTool, guardPowershellTool, isUnverifiable, resolveUnder } from "./guard.ts";
import worktreeExtension from "./index.ts";
import { loadRegistry } from "./registry.ts";
import { ROOT_TOOL_NAMES } from "./root-tools.ts";
import { ENV_BRANCH, ENV_MAIN, ENV_ROOT } from "./runtime.ts";
import { WORKTREE_TOOLS } from "./tools.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

// Windows needs Developer Mode/admin to create symlinks, so those cases skip.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

/** The managed worktree directory for a name, canonicalized the way git reports it. */
function managedPath(repo: string, name: string): string {
	return realPathOfNearest(join(repo, ".pi", "worktrees", name));
}

describe("file tool guard", () => {
	const ROOT = "/wt";
	const config = (guard: Partial<ReturnType<typeof testConfig>["guard"]> = {}) => testConfig({ guard });

	test("resolves a missing path as the root and relative paths under it", () => {
		expect(resolveUnder("/a/b", undefined)).toBe("/a/b");
		expect(resolveUnder("/a/b", "")).toBe("/a/b");
		expect(resolveUnder("/a/b", "c")).toBe(resolve("/a/b", "c"));
		expect(resolveUnder("/a/b", "/x/y")).toBe(resolve("/x/y"));
	});

	test("blocks writes outside the worktree unless the switch is off", () => {
		expect(guardFileTool("write", { path: "/main/file.txt" }, ROOT, config())?.block).toBe(true);
		expect(guardFileTool("write", { path: "src/file.txt" }, ROOT, config())).toBeUndefined();
		expect(
			guardFileTool("write", { path: "/main/file.txt" }, ROOT, config({ blockFileEscapes: false })),
		).toBeUndefined();
	});

	test("allows reads outside by default and blocks them when configured", () => {
		expect(guardFileTool("read", { path: "/main/file.txt" }, ROOT, config())).toBeUndefined();
		expect(guardFileTool("read", { path: "/main/file.txt" }, ROOT, config({ blockReadEscapes: true }))?.block).toBe(
			true,
		);
		expect(guardFileTool("read_doc", { path: "/main/file.pdf" }, ROOT, config())).toBeUndefined();
		expect(guardFileTool("read_doc", { path: "/main/file.pdf" }, ROOT, config({ blockReadEscapes: true }))?.block).toBe(
			true,
		);
	});

	test("ignores tools without a path argument", () => {
		expect(guardFileTool("bash", { command: "ls" }, ROOT, config())).toBeUndefined();
	});

	symlinkTest("blocks a write through a symlink that leaves the worktree", () => {
		const base = temps.track(tempDir("pi-wt-symlink-"));
		const root = join(base, "worktree");
		const outside = join(base, "main");
		mkdirSync(root);
		mkdirSync(outside);
		symlinkSync(outside, join(root, "link"));

		expect(isInsideReal(root, join(root, "link", "file.txt"))).toBe(false);
		const blocked = guardFileTool("write", { path: "link/file.txt" }, root, config());
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toMatch(/symlink/i);
		expect(
			guardFileTool("write", { path: "link/file.txt" }, root, config({ blockSymlinkEscapes: false })),
		).toBeUndefined();
	});

	symlinkTest("keeps ordinary in-worktree paths allowed", () => {
		const base = temps.track(tempDir("pi-wt-symlink-"));
		const root = join(base, "worktree");
		mkdirSync(root);
		writeFileSync(join(root, "real.txt"), "x");
		expect(isInsideReal(root, join(root, "real.txt"))).toBe(true);
		expect(guardFileTool("write", { path: "real.txt" }, root, config())).toBeUndefined();
	});
});

describe("bash guard", () => {
	const ROOT = "/wt";
	const config = (guard: Partial<ReturnType<typeof testConfig>["guard"]> = {}) => testConfig({ guard });
	const blocked = (command: string, guard: Partial<ReturnType<typeof testConfig>["guard"]> = {}) =>
		analyzeBashCommand(command, ROOT, config(guard))?.block === true;

	test("blocks git redirects but allows in-worktree targets", () => {
		const escapes = [
			"git -C /main status",
			"GIT_DIR=/main/.git git status",
			"git --work-tree=/main status",
			"git --git-dir /main/.git status",
			"git -c core.worktree=/main status",
		];
		const safe = ["git status", "git -C /wt/sub status", "git -c core.worktree=sub status", "git log -C /main/file"];
		for (const command of escapes) expect(blocked(command)).toBe(true);
		for (const command of safe) expect(blocked(command)).toBe(false);
	});

	test("blocks exported and command-prefix environment redirects", () => {
		expect(blocked("export GIT_DIR=/main/.git && git status")).toBe(true);
		expect(blocked("export GIT_WORK_TREE=/main && git status")).toBe(true);
		expect(blocked("export GIT_DIR=sub/.git && git status")).toBe(false);
		expect(blocked("export FOO=bar && git status")).toBe(false);
		expect(blocked("sudo git --git-dir /main/.git status")).toBe(true);
		expect(blocked("env GIT_DIR=/main/.git git status")).toBe(true);
		expect(blocked("env -i GIT_DIR=/main/.git git status")).toBe(true);
		// A GIT_DIR word that is an argument is not a redirect.
		expect(blocked("echo GIT_DIR=/etc/hosts")).toBe(false);
	});

	test("blocks directory changes that leave the worktree", () => {
		const escapes = [
			"cd /etc && ls",
			"cd ../outside",
			"cd /main && ls",
			"cd && rm -rf x",
			"cd -",
			"cd ~",
			"cd $HOME",
			"cd -P /main",
			"cd -L /main",
			"cd -- /main",
			"command cd -P /main",
			"pushd /main",
			"pushd -n /main",
			"popd",
			"(cd /main && ls)",
			"{ cd /main; }",
		];
		const safe = ["cd sub && ls", "cd -P sub", "cd -- sub"];
		for (const command of escapes) expect(blocked(command)).toBe(true);
		for (const command of safe) expect(blocked(command)).toBe(false);
	});

	test("blocks redirects that escape, including after shell expansion", () => {
		const escapes = [
			"echo x > /main/f",
			"echo x >> /main/f",
			"echo x >/main/f",
			"echo x > ../outside/f",
			"echo x > $HOME/f",
			"echo x >&/main/f",
			"echo x >& /main/f",
			"cmd > /dev/zero",
		];
		for (const command of escapes) expect(blocked(command)).toBe(true);
	});

	test("allows in-worktree redirects and ignores fd dups, heredocs, and the null device", () => {
		const safe = [
			"echo x > out.txt",
			"echo x 2>&1",
			"cmd >&2",
			"cmd >&-",
			"cat <<EOF",
			"cmd 2>/dev/null",
			"cmd > /dev/null 2>&1",
			'cmd 2>"/dev/null"',
		];
		for (const command of safe) expect(blocked(command)).toBe(false);
		expect(blocked("cat < /dev/null", { blockReadEscapes: true })).toBe(false);
	});

	test("gates input redirections behind blockReadEscapes", () => {
		expect(blocked("cat < /main/f")).toBe(false);
		expect(blocked("cat < /main/f", { blockReadEscapes: true })).toBe(true);
	});

	test("does not treat quoted option text as a redirect", () => {
		expect(blocked("git log --grep='--git-dir=/tmp/x'")).toBe(false);
		expect(blocked('echo "GIT_DIR=/main/.git"')).toBe(false);
	});

	test("the unverifiable-command check is opt-in", () => {
		expect(blocked("echo $(pwd)")).toBe(false);
		expect(blocked("echo $(pwd)", { blockUnparsableCommands: true })).toBe(true);
		expect(blocked("sh -c 'cd /main'")).toBe(false);
		expect(blocked("sh -c 'cd /main'", { blockUnparsableCommands: true })).toBe(true);
		expect(blocked("bash -c 'git -C /main status'", { blockUnparsableCommands: true })).toBe(true);
	});

	test("isUnverifiable names exactly the shapes the opt-in check refuses", () => {
		for (const command of ["echo $(pwd)", "echo `pwd`", "eval 'git status'", "sh -c 'git status'", "echo ${!x}"]) {
			expect(isUnverifiable(command)).toBe(true);
		}
		for (const command of ["git status", "git commit -m 'a message'", "ls -la"]) {
			expect(isUnverifiable(command)).toBe(false);
		}
	});
});

describe("powershell guard", () => {
	test("refuses the tool while isolated and names the ways out", () => {
		const block = guardPowershellTool(testConfig());
		expect(block?.block).toBe(true);
		expect(block?.reason).toContain("main checkout");
		expect(block?.reason).toContain("Use bash");
		expect(block?.reason).toContain("exit the worktree");
		expect(block?.reason).toContain("worktree.guard.blockPowershell");
	});

	test("lets the tool through when the switch is off", () => {
		expect(guardPowershellTool(testConfig({ guard: { blockPowershell: false } }))).toBeUndefined();
	});
});

describe.skipIf(!runSlowSuites)("entering a worktree", () => {
	test("binds the session and records the checkout in state and the registry", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);

		const result = await harness.run(WORKTREE_TOOLS.enter, { name: "a" });
		const dir = managedPath(repo, "a");
		expect(result.content[0].text).toContain("Entered worktree");
		expect(harness.ctx.statuses.get("worktree")).toContain("a");
		expect(
			harness.pi.entries.some((entry: { customType?: string; data?: { active?: boolean } }) => {
				return entry.customType === "worktree" && entry.data?.active === true;
			}),
		).toBe(true);
		expect(loadRegistry(repo, testConfig()).worktrees.map((record) => record.path)).toContain(dir);
	});

	test("refuses a name or a path that leaves the managed directory", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);
		await expect(
			harness.run(WORKTREE_TOOLS.enter, { name: join(tempDir("pi-wt-escape-"), "outside") }),
		).rejects.toThrow(/outside/);
		await expect(harness.run(WORKTREE_TOOLS.enter, { path: repo })).rejects.toThrow(/main checkout/i);
	});

	test("treats a declined outside-path entry as a normal cancellation", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const outside = join(temps.track(tempDir("pi-wt-out-")), "wt");
		await execP("git", ["worktree", "add", "-b", "outside-branch", outside], { cwd: repo });

		const harness = await bootWorktree(repo, { hasUI: true, confirm: false });
		const result = await harness.run(WORKTREE_TOOLS.enter, { path: outside });
		expect(result.content[0].text).toMatch(/cancelled/i);
		expect(result.details.cancelled).toBe(true);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("re-enters a worktree whose branch was kept on exit", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);

		await harness.run(WORKTREE_TOOLS.enter, { name: "reuse" });
		writeFileSync(join(managedPath(repo, "reuse"), "work.txt"), "x");
		await harness.run(WORKTREE_TOOLS.exit, { remove: true, keepBranch: true });

		const reentered = await harness.run(WORKTREE_TOOLS.enter, { name: "reuse" });
		expect(reentered.content[0].text).toContain("Entered worktree");
		await harness.run(WORKTREE_TOOLS.exit, { remove: true, keepBranch: true });
	});

	test("binds a borrowed worktree and refuses to change it", async () => {
		const repo = temps.track(await makeRepo("pi-wt-borrow-"));

		// Leave a kept worktree behind, as the parent session would.
		const parent = await bootWorktree(repo);
		await parent.run(WORKTREE_TOOLS.enter, { name: "borrow" });
		await parent.run(WORKTREE_TOOLS.exit, { remove: false });
		const dir = managedPath(repo, "borrow");

		const child = await bootWorktree(repo, { env: { root: dir, branch: "worktree-borrow", main: repo } });
		expect(child.ctx.statuses.get("worktree")).toContain("borrow");
		expect((await child.run(WORKTREE_TOOLS.list, {})).content[0].text).toContain(realPathOfNearest(repo));

		await expect(child.run(WORKTREE_TOOLS.enter, { name: "x" })).rejects.toThrow(/inherited/i);
		await expect(child.run(WORKTREE_TOOLS.exit, {})).rejects.toThrow(/inherited|parent/i);

		const handler = child.pi.handlers.get("tool_call")[0];
		expect(handler({ toolName: "write", input: { path: join(repo, "outside.txt") } })).toMatchObject({ block: true });
		expect(handler({ toolName: "write", input: { path: "inside.txt" } })).toBeUndefined();
		expect(handler({ toolName: "bash", input: { command: `git -C ${repo} status` } })).toMatchObject({ block: true });
		expect(handler({ toolName: "bash", input: { command: "git status" } })).toBeUndefined();
	});
});

describe.skipIf(!runSlowSuites)("gitignore offer", () => {
	test("appends the managed directory when no rule covers it", async () => {
		const repo = temps.track(await makeRepo("pi-wt-ignore-"));
		const harness = await bootWorktree(repo, { hasUI: true });

		await harness.run(WORKTREE_TOOLS.enter, { name: "a" });

		expect(harness.ctx.confirms.map((entry: { title: string }) => entry.title)).toEqual([
			"Add the worktree directory to .gitignore?",
		]);
		expect(readFileSync(join(repo, ".gitignore"), "utf-8")).toBe(".pi/worktrees/\n");
	});

	test("stays silent when a wider rule already ignores the directory", async () => {
		const repo = temps.track(await makeRepo("pi-wt-ignore-"));
		writeFileSync(join(repo, ".gitignore"), ".pi/\n");
		const harness = await bootWorktree(repo, { hasUI: true });

		await harness.run(WORKTREE_TOOLS.enter, { name: "a" });

		expect(harness.ctx.confirms).toEqual([]);
		expect(readFileSync(join(repo, ".gitignore"), "utf-8")).toBe(".pi/\n");
	});

	test("leaves .gitignore alone when the offer is declined", async () => {
		const repo = temps.track(await makeRepo("pi-wt-ignore-"));
		const harness = await bootWorktree(repo, { hasUI: true, confirm: false });

		await harness.run(WORKTREE_TOOLS.enter, { name: "a" });

		expect(existsSync(join(repo, ".gitignore"))).toBe(false);
	});
});

describe.skipIf(!runSlowSuites)("exiting a worktree", () => {
	test("removes a clean worktree and its branch", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "a" });
		const dir = managedPath(repo, "a");

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(existsSync(dir)).toBe(false);
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).not.toContain("worktree-a");
	});

	test("keeps a dirty worktree when there is no UI to ask", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty" });
		const dir = managedPath(repo, "dirty");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, {});
		expect(result.content[0].text).toContain("Kept worktree");
		expect(existsSync(dir)).toBe(true);
	});

	test("treats a declined exit prompt as a normal result and keeps the binding", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Cancel" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "declined" });
		const dir = managedPath(repo, "declined");
		writeFileSync(join(dir, "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, {});
		expect(result.content[0].text).toMatch(/cancelled/i);
		expect(result.isError).not.toBe(true);
		expect(result.details.cancelled).toBe(true);
		expect(existsSync(dir)).toBe(true);
		expect(harness.ctx.statuses.get("worktree")).toContain("declined");
	});

	test("keeps a branch with unmerged commits on forced removal", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "commits" });
		const dir = managedPath(repo, "commits");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(result.content[0].text).toMatch(/Kept branch worktree-commits/);
		expect(existsSync(dir)).toBe(false);
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).toContain("worktree-commits");
	});

	test("hands the branch back with the command that finishes it", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "hand" });
		const dir = managedPath(repo, "hand");
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
		const dir = managedPath(repo, "rebased");

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
		expect(result.content[0].text).toContain("Deleted branch worktree-empty");
		expect(result.content[0].text).toContain("nothing to merge");
		expect(result.content[0].text).not.toContain("git merge --no-ff");
	});

	test("names the branch it kept for a dirty worktree", async () => {
		const repo = temps.track(await makeRepo("pi-wt-handoff-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty" });
		writeFileSync(join(managedPath(repo, "dirty"), "work.txt"), "x");

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: false });
		expect(result.content[0].text).toContain("Kept worktree");
		// Nothing committed, so nothing landed: the handoff says that rather than claiming a
		// merge of the work still sitting in the directory.
		expect(result.content[0].text).toContain("Handoff: worktree-dirty has no commits beyond main — nothing to merge.");
		expect(result.details.handoff).toMatchObject({ branch: "worktree-dirty", ahead: 0, commits: 0, merged: false });
	});

	test("keeps a dirty worktree's branch when the user chooses remove", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Remove it and its branch" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "dirty2" });
		const dir = managedPath(repo, "dirty2");
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
		const dir = managedPath(repo, "bypath");
		await harness.run(WORKTREE_TOOLS.exit, { remove: false });

		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		await harness.run(WORKTREE_TOOLS.enter, { path: dir });
		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Removed worktree");
		expect(result.content[0].text).toMatch(/Kept branch worktree-bypath/);
		expect((await execP("git", ["branch"], { cwd: repo })).stdout).toContain("worktree-bypath");
	});

	test("keeps the worktree and reports the failure when removal fails", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await harness.run(WORKTREE_TOOLS.enter, { name: "stuck" });
		const dir = managedPath(repo, "stuck");
		const realExec = harness.pi.exec;
		harness.pi.exec = async (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => {
			if (command === "git" && args[0] === "worktree" && args[1] === "remove") {
				return { stdout: "", stderr: "remove failed", code: 1, killed: false };
			}
			return realExec(command, args, options);
		};

		const result = await harness.run(WORKTREE_TOOLS.exit, { remove: true });
		expect(result.content[0].text).toContain("Kept the worktree: remove failed");
		expect(existsSync(dir)).toBe(true);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("refuses to exit when the session is not isolated", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo);
		await expect(harness.run(WORKTREE_TOOLS.exit, {})).rejects.toThrow(/Not currently in a worktree/);
	});
});

describe.skipIf(!runSlowSuites)("/worktree command and completions", () => {
	async function withHarness(prefix = "pi-wt-cmd-"): Promise<{ harness: WorktreeHarness; repo: string }> {
		const repo = temps.track(await makeRepo(prefix));
		const harness = await bootWorktree(repo);
		return { harness, repo };
	}

	function completions(harness: WorktreeHarness, prefix: string) {
		return harness.pi.commands.get("worktree").getArgumentCompletions(prefix) as Array<{
			value: string;
			label: string;
			description?: string;
		}> | null;
	}

	test("reports not in a worktree for the bare command outside a terminal", async () => {
		const { harness } = await withHarness();
		await harness.command("");
		expect(harness.ctx.notices.at(-1)).toContain("Not in a worktree.");
	});

	test("mounts the list screen in a terminal", async () => {
		const repo = temps.track(await makeRepo("pi-wt-cmd-tui-"));
		const harness = await bootWorktree(repo, { hasUI: true });
		await harness.command("");
		expect(harness.ctx.customCalls).toHaveLength(1);
	});

	test("enters, prunes the current worktree, and exits", async () => {
		const { harness, repo } = await withHarness();
		await harness.command("enter cmd");
		expect(harness.ctx.notices.at(-1)).toContain("Entered worktree");
		expect(existsSync(managedPath(repo, "cmd"))).toBe(true);

		await harness.command("prune");
		expect(harness.ctx.notices.at(-1)).toContain("current");

		await harness.command("exit");
		expect(harness.ctx.notices.at(-1)).toContain("Removed worktree");
		expect(existsSync(managedPath(repo, "cmd"))).toBe(false);
	});

	test("reports a declined exit as info, not an error", async () => {
		const repo = temps.track(await makeRepo("pi-wt-exit-"));
		const harness = await bootWorktree(repo, { hasUI: true, select: "Cancel" });
		await harness.run(WORKTREE_TOOLS.enter, { name: "declined-cmd" });
		writeFileSync(join(managedPath(repo, "declined-cmd"), "work.txt"), "x");

		await harness.command("exit");
		const notice = harness.ctx.noticeEntries.at(-1);
		expect(notice.kind).toBe("info");
		expect(notice.message).toMatch(/cancelled/i);
	});

	test("rejects an unknown or retired subcommand with usage", async () => {
		const { harness } = await withHarness();
		for (const sub of ["bogus", "status"]) {
			await harness.command(sub);
			expect(harness.ctx.notices.at(-1)).toContain(`Unknown worktree subcommand "${sub}"`);
			expect(harness.ctx.notices.at(-1)).toContain("Usage: /worktree");
		}
	});

	test("rejects an argument the subcommand does not take", async () => {
		const { harness } = await withHarness();
		for (const args of ["exit --remove", "exit --keep", "prune now", "enter one two"]) {
			await harness.command(args);
			expect(harness.ctx.notices.at(-1)).toContain("Unexpected argument");
			expect(harness.ctx.notices.at(-1)).toContain("Usage: /worktree");
		}
	});

	test("lists and filters the three subcommands and offers no flags", async () => {
		const { harness } = await withHarness();
		expect(completions(harness, "")?.map((item) => item.value)).toEqual(["enter ", "exit ", "prune "]);
		expect(completions(harness, "e")?.map((item) => item.label)).toEqual(["enter", "exit"]);
		expect(completions(harness, "exit ")).toBeNull();
		expect(completions(harness, "enter ")).toBeNull();
		expect(completions(harness, "x")).toBeNull();
	});
});

describe("extension registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "worktree" }, () => {
			const { pi, tools, commands, flags, handlers } = createFakePi();
			worktreeExtension(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(flags.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the string flag, one command, and every tool and root override", () => {
		const { pi, builtins } = makeWorktreePi();
		expect(pi.flags.get("worktree")?.type).toBe("string");
		expect([...pi.commands.keys()]).toEqual(["worktree"]);
		const expected = [...Object.values(WORKTREE_TOOLS), ...ROOT_TOOL_NAMES].sort();
		expect([...pi.tools.keys()].sort()).toEqual(expected);
		for (const name of ROOT_TOOL_NAMES) {
			expect(builtins.calls.some((call) => call.name === name)).toBe(true);
		}
	});

	test("clears a stale PI_WORKTREE_* at session start", async () => {
		await withEnv({ [ENV_ROOT]: "/stale/root", [ENV_BRANCH]: "stale", [ENV_MAIN]: "/stale/main" }, async () => {
			const { pi } = makeWorktreePi();
			const ctx = makeFakeCtx(pi, { cwd: tempDir("pi-wt-env-") });
			await emitEvent(pi, "session_start", { reason: "new" }, ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();
			expect(process.env[ENV_BRANCH]).toBeUndefined();
			expect(process.env[ENV_MAIN]).toBeUndefined();
		});
	});

	test("clears PI_WORKTREE_* on session shutdown", async () => {
		await withEnv({ [ENV_ROOT]: "/stale/root", [ENV_BRANCH]: "stale", [ENV_MAIN]: "/stale/main" }, async () => {
			const { pi } = makeWorktreePi();
			const ctx = makeFakeCtx(pi, { cwd: tempDir("pi-wt-env-") });
			await emitEvent(pi, "session_shutdown", {}, ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();
		});
	});
});

describe.skipIf(!runSlowSuites)("extension lifecycle", () => {
	test("forwards settings to the host built-in factories", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const settings = { images: { autoResize: false }, shellPath: "/bin/zsh", shellCommandPrefix: "source ~/.zshrc" };
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "opts" }, settings });
		await harness.run("read");
		await harness.run("bash");
		const read = harness.builtins.calls.filter((call) => call.name === "read").at(-1);
		const bash = harness.builtins.calls.filter((call) => call.name === "bash").at(-1);
		expect(read?.options.read).toEqual({ autoResizeImages: false });
		expect(bash?.options.bash).toEqual({ commandPrefix: "source ~/.zshrc", shellPath: "/bin/zsh" });
	});

	test("warns when another source owns a root tool and reports it as inactive", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const foreignBash = {
			name: "bash",
			description: "",
			parameters: {},
			promptGuidelines: [],
			exposure: "direct",
			sourceInfo: { path: "builtin:bash", source: "builtin", scope: "global", origin: "top-level" },
		};
		const harness = await bootWorktree(repo, { allTools: [foreignBash] });
		expect(harness.ctx.notices.at(-1)).toMatch(/not active for: bash/);

		const result = await harness.run(WORKTREE_TOOLS.list);
		expect(result.details.inactiveOverrides).toContain("bash");
		expect(result.content[0].text).toMatch(/not active for: bash/);
	});

	test("does not warn when the session reports our own overrides", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo);
		expect(harness.ctx.notices.some((notice: string) => /not active for/.test(notice))).toBe(false);
	});

	test("enters the worktree named by the startup flag and clears it on shutdown", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "flagged" } });
		expect(existsSync(join(repo, ".pi", "worktrees", "flagged"))).toBe(true);
		expect(harness.ctx.statuses.get("worktree")).toContain("flagged");

		await emitEvent(harness.pi, "session_shutdown", {}, harness.ctx);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("re-exports the isolated root when a session restores a worktree", async () => {
		await withEnv({ [ENV_ROOT]: undefined, [ENV_BRANCH]: undefined, [ENV_MAIN]: undefined }, async () => {
			const repo = temps.track(await makeRepo("pi-wt-env-"));
			const harness = await bootWorktree(repo, { flagDefaults: { worktree: "envsync" } });
			const path = join(repo, ".pi", "worktrees", "envsync");
			expect(process.env[ENV_ROOT]).toBe(path);

			// A replacement session in this process must not inherit the old root.
			await emitEvent(harness.pi, "session_shutdown", {}, harness.ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();

			// Resuming the recorded branch re-exports it.
			const resumed = sharedFakeCtx({ cwd: repo, hasUI: false, mode: "print", branch: harness.pi.entries }).ctx;
			await emitEvent(harness.pi, "session_start", { reason: "resume" }, resumed);
			expect(process.env[ENV_ROOT]).toBe(path);
		});
	});

	test("injects the worktree section and re-roots a path-taking tool", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "prompted" } });
		const event = { systemPromptOptions: { cwd: "/orig", sections: {} as Record<string, string> } };
		await emitEvent(harness.pi, "before_agent_start", event, harness.ctx);
		expect(event.systemPromptOptions.sections.worktree).toContain(join(repo, ".pi", "worktrees", "prompted"));

		const result = await harness.pi.tools.get("read").execute("read-1", {}, undefined, undefined, harness.ctx);
		expect(result.content[0].text).toContain(join(repo, ".pi", "worktrees", "prompted"));
	});
});

describe.skipIf(!runSlowSuites)("isolation gaps through the extension", () => {
	async function statusText(harness: WorktreeHarness): Promise<string> {
		const result = await harness.run(WORKTREE_TOOLS.list);
		return result.content[0].text;
	}

	test("names the shell it cannot isolate while the session is isolated", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "gaps" } });

		const text = await statusText(harness);
		expect(text).toContain("Not isolated:");
		expect(text).toContain("! shell");
		expect(text).toContain("unverifiable");
		expect(text).not.toContain("ran this session");
	});

	test("counts an unverified command but not a verifiable one", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "gaps" } });

		await emitEvent(harness.pi, "tool_call", { toolName: "bash", input: { command: "echo $(pwd)" } }, harness.ctx);
		expect(await statusText(harness)).toContain("1 ran this session");

		await emitEvent(harness.pi, "tool_call", { toolName: "bash", input: { command: "git status" } }, harness.ctx);
		expect(await statusText(harness)).toContain("1 ran this session");
	});

	test("refuses powershell while isolated and runs it when the switch is off", async () => {
		const guardedRepo = temps.track(await makeRepo("pi-wt-pwsh-"));
		const guarded = await bootWorktree(guardedRepo, { flagDefaults: { worktree: "guarded" } });

		const refused = await emitEvent(
			guarded.pi,
			"tool_call",
			{ toolName: "powershell", input: { command: "Set-Location ..; git commit -am x" } },
			guarded.ctx,
		);
		expect(refused?.block).toBe(true);
		expect(refused?.reason).toContain("main checkout");
		expect(await statusText(guarded)).not.toContain("powershell");

		const allowedRepo = temps.track(await makeRepo("pi-wt-pwsh-"));
		mkdirSync(join(allowedRepo, ".pi"), { recursive: true });
		writeFileSync(
			join(allowedRepo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { guard: { blockPowershell: false } } }),
		);
		const allowed = await bootWorktree(allowedRepo, { flagDefaults: { worktree: "allowed" } });

		// The Windows-only report row is pinned in `git.test.ts`; here the tool runs.
		expect(
			await emitEvent(
				allowed.pi,
				"tool_call",
				{ toolName: "powershell", input: { command: "Get-Location" } },
				allowed.ctx,
			),
		).toBeUndefined();
	});

	test("says nothing about gaps outside a worktree", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo);

		const text = await statusText(harness);
		expect(text).toContain("Not in a worktree.");
		expect(text).not.toContain("Not isolated:");
	});
});

describe.skipIf(!runSlowSuites)("managed worktree status", () => {
	test("keeps every row with its own branch and dirty mark", async () => {
		const repo = temps.track(await makeRepo("pi-wt-rows-"));
		const names = ["alpha", "beta", "gamma"];
		// Created with git directly: a session may sit in one worktree at a time, and
		// the status reads the managed set from git, not from this session's state.
		for (const name of names) {
			await execP("git", ["worktree", "add", "-q", join(repo, ".pi", "worktrees", name), "-b", `worktree-${name}`], {
				cwd: repo,
			});
		}
		// One checkout is dirty, so the marks prove each row was read for its own
		// path rather than for whichever row happened to finish first.
		writeFileSync(join(repo, ".pi", "worktrees", "beta", "dirty.txt"), "x\n");

		const harness = await bootWorktree(repo);
		const result = await harness.run(WORKTREE_TOOLS.list);
		const text = String(result.content[0]?.text ?? "");
		expect(text).toContain("Managed worktrees (3):");

		const rows = text.split("\n").filter((line) => line.includes("worktree-"));
		expect(rows).toHaveLength(3);
		for (const name of names) {
			const row = rows.filter((line) => line.includes(`worktree-${name}`));
			expect(row).toHaveLength(1);
			expect(row[0]).toContain(join(repo, ".pi", "worktrees", name));
		}
		expect(rows.filter((line) => line.includes("worktree-beta"))[0]).toContain("dirty (");
		expect(rows.filter((line) => line.includes("worktree-alpha"))[0]).not.toContain("dirty (");
	});
});
