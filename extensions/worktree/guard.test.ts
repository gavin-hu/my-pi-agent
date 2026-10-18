import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeBashCommand, guardFileTool, guardPowershellTool, isUnverifiable, resolveUnder } from "./guard.ts";
import { isInsideReal } from "../../lib/path.ts";
import type { WorktreeConfig } from "./config.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { testConfig } from "../../test/helpers/fixtures/worktree.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { tempDir } from "../../test/helpers/env.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function config(guard: Partial<WorktreeConfig["guard"]> = {}): WorktreeConfig {
	return testConfig({ guard });
}

const ROOT = "/wt";

// Windows requires Developer Mode/admin to create symlinks; skip those tests
// rather than fail when the privilege is unavailable.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

describe("resolveUnder", () => {
	test("treats a missing path as the root and resolves relative paths", () => {
		expect(resolveUnder("/a/b", undefined)).toBe("/a/b");
		expect(resolveUnder("/a/b", "")).toBe("/a/b");
		expect(resolveUnder("/a/b", "c")).toBe(resolve("/a/b", "c"));
		expect(resolveUnder("/a/b", "/x/y")).toBe(resolve("/x/y"));
	});
});

describe("guardFileTool", () => {
	test("blocks writes outside the worktree", () => {
		expect(guardFileTool("write", { path: "/main/file.txt" }, ROOT, config())?.block).toBe(true);
	});

	test("allows writes inside the worktree", () => {
		expect(guardFileTool("write", { path: "src/file.txt" }, ROOT, config())).toBeUndefined();
	});

	test("allows writes outside when blockFileEscapes is off", () => {
		expect(
			guardFileTool("write", { path: "/main/file.txt" }, ROOT, config({ blockFileEscapes: false })),
		).toBeUndefined();
	});

	test("allows reads outside by default", () => {
		expect(guardFileTool("read", { path: "/main/file.txt" }, ROOT, config())).toBeUndefined();
	});

	test("blocks reads outside when configured", () => {
		expect(guardFileTool("read", { path: "/main/file.txt" }, ROOT, config({ blockReadEscapes: true }))?.block).toBe(
			true,
		);
	});

	test("applies the same read containment to read_doc", () => {
		expect(guardFileTool("read_doc", { path: "/main/file.pdf" }, ROOT, config())).toBeUndefined();
		expect(guardFileTool("read_doc", { path: "/main/file.pdf" }, ROOT, config({ blockReadEscapes: true }))?.block).toBe(
			true,
		);
	});

	test("ignores tools without a path argument", () => {
		expect(guardFileTool("bash", { command: "ls" }, ROOT, config())).toBeUndefined();
	});
});

describe("analyzeBashCommand", () => {
	test("blocks git -C into the main checkout", () => {
		expect(analyzeBashCommand("git -C /main status", ROOT, config())?.block).toBe(true);
	});

	test("allows git -C inside the worktree", () => {
		expect(analyzeBashCommand("git -C /wt/sub status", ROOT, config())).toBeUndefined();
	});

	test("blocks git redirects", () => {
		expect(analyzeBashCommand("GIT_DIR=/main/.git git status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("git --work-tree=/main status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("git --git-dir /main/.git status", ROOT, config())?.block).toBe(true);
	});

	test("blocks an exported GIT_DIR/GIT_WORK_TREE that leaves the worktree", () => {
		expect(analyzeBashCommand("export GIT_DIR=/main/.git && git status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("export GIT_WORK_TREE=/main && git status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("export GIT_DIR=sub/.git && git status", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("export FOO=bar && git status", ROOT, config())).toBeUndefined();
	});

	test("blocks cd outside the worktree", () => {
		expect(analyzeBashCommand("cd /etc && ls", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd ../outside", ROOT, config())?.block).toBe(true);
	});

	test("allows cd inside the worktree", () => {
		expect(analyzeBashCommand("cd sub && ls", ROOT, config())).toBeUndefined();
	});

	test("allows plain git commands", () => {
		expect(analyzeBashCommand("git status", ROOT, config())).toBeUndefined();
	});

	test("command-shape check is opt-in", () => {
		expect(analyzeBashCommand("echo $(pwd)", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("echo $(pwd)", ROOT, config({ blockUnparsableCommands: true }))?.block).toBe(true);
		expect(analyzeBashCommand("sh -c 'cd /main'", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("sh -c 'cd /main'", ROOT, config({ blockUnparsableCommands: true }))?.block).toBe(true);
		expect(
			analyzeBashCommand("bash -c 'git -C /main status'", ROOT, config({ blockUnparsableCommands: true }))?.block,
		).toBe(true);
	});

	test("isUnverifiable names exactly what the opt-in check refuses", () => {
		for (const command of ["echo $(pwd)", "echo `pwd`", "eval 'git status'", "sh -c 'git status'", "echo ${!x}"]) {
			expect(isUnverifiable(command)).toBe(true);
		}
		// Quote-blind by design, like the check it names: it errs toward "cannot
		// verify" rather than parsing a command shape it already gave up on.
		for (const command of ["git status", "git commit -m 'a message'", "ls -la"]) {
			expect(isUnverifiable(command)).toBe(false);
		}
	});

	test("blocks redirects that only escape after shell expansion", () => {
		expect(analyzeBashCommand("git -C ~/other status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("git -C $HOME/other status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("git --git-dir=${HOME}/x status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd ~", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd $HOME", ROOT, config())?.block).toBe(true);
	});

	test("blocks cd with no target or a previous-directory target", () => {
		expect(analyzeBashCommand("cd && rm -rf x", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd -", ROOT, config())?.block).toBe(true);
	});

	test("does not treat quoted option text or git copy detection as redirects", () => {
		expect(analyzeBashCommand("git log --grep='--git-dir=/tmp/x'", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand('echo "GIT_DIR=/main/.git"', ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("git log -C /main/file", ROOT, config())).toBeUndefined();
	});

	test("expands git redirects behind command prefixes and separators", () => {
		expect(analyzeBashCommand("sudo git --git-dir /main/.git status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd /main && ls", ROOT, config())?.block).toBe(true);
	});

	test("blocks output redirections that leave the worktree", () => {
		expect(analyzeBashCommand("echo x > /main/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x >> /main/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x >/main/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x > ../outside/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x > $HOME/f", ROOT, config())?.block).toBe(true);
	});

	test("allows in-worktree redirections and ignores fd dups and heredocs", () => {
		expect(analyzeBashCommand("echo x > out.txt", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("echo x 2>&1", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cmd >&2", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cat <<EOF", ROOT, config())).toBeUndefined();
	});

	test("allows the null device, which discards instead of writing", () => {
		expect(analyzeBashCommand("cmd 2>/dev/null", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cmd > /dev/null 2>&1", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand('cmd 2>"/dev/null"', ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cat < /dev/null", ROOT, config({ blockReadEscapes: true }))).toBeUndefined();
		// Any other device still counts as an escape, so the exemption stays narrow.
		expect(analyzeBashCommand("cmd > /dev/zero", ROOT, config())?.block).toBe(true);
	});

	test("gates input redirections behind blockReadEscapes", () => {
		expect(analyzeBashCommand("cat < /main/f", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cat < /main/f", ROOT, config({ blockReadEscapes: true }))?.block).toBe(true);
	});

	test("blocks directory changes hidden in subshells and groups", () => {
		expect(analyzeBashCommand("(cd /main && ls)", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("{ cd /main; }", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("pushd /main", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("popd", ROOT, config())?.block).toBe(true);
	});

	test("blocks cd options and -- before the target", () => {
		expect(analyzeBashCommand("cd -P /main", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd -L /main", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("cd -- /main", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("command cd -P /main", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("pushd -n /main", ROOT, config())?.block).toBe(true);
		// In-worktree targets with the same option forms stay allowed.
		expect(analyzeBashCommand("cd -P sub", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cd -- sub", ROOT, config())).toBeUndefined();
	});

	test("treats `>&file` as a file redirect but not `>&1` or `>&-`", () => {
		expect(analyzeBashCommand("echo x >&/main/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x >& /main/f", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("echo x >&2", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cmd 2>&1", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("cmd >&-", ROOT, config())).toBeUndefined();
	});

	test("blocks `git -c core.worktree=`", () => {
		expect(analyzeBashCommand("git -c core.worktree=/main status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("git -c core.worktree=sub status", ROOT, config())).toBeUndefined();
	});

	test("does not treat a GIT_DIR argument as a redirect", () => {
		expect(analyzeBashCommand("echo GIT_DIR=/etc/hosts", ROOT, config())).toBeUndefined();
		expect(analyzeBashCommand("env GIT_DIR=/main/.git git status", ROOT, config())?.block).toBe(true);
		expect(analyzeBashCommand("env -i GIT_DIR=/main/.git git status", ROOT, config())?.block).toBe(true);
	});
});

describe("guardPowershellTool", () => {
	test("refuses the tool while isolated, naming the way out", () => {
		const block = guardPowershellTool(config());

		expect(block?.block).toBe(true);
		expect(block?.reason).toContain("not re-rooted or guarded");
		expect(block?.reason).toContain("Use bash");
		expect(block?.reason).toContain("exit the worktree");
		expect(block?.reason).toContain("worktree.guard.blockPowershell");
	});

	test("refuses a Windows escape attempt instead of trying to parse it", () => {
		// The shape that motivated the guard: a relative-path tool that would edit
		// the main checkout, spelled in a grammar the bash checks cannot read.
		expect(guardPowershellTool(config())?.block).toBe(true);
		expect(guardPowershellTool(config())?.reason).toContain("main checkout");
	});

	test("lets the tool through when the switch is off", () => {
		expect(guardPowershellTool(config({ blockPowershell: false }))).toBeUndefined();
	});
});

describe("symlink-safe containment", () => {
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

		const allowed = guardFileTool("write", { path: "link/file.txt" }, root, config({ blockSymlinkEscapes: false }));
		expect(allowed).toBeUndefined();
	});

	test("keeps ordinary in-worktree paths allowed", () => {
		const base = temps.track(tempDir("pi-wt-symlink-"));
		const root = join(base, "worktree");
		mkdirSync(root);
		writeFileSync(join(root, "real.txt"), "x");
		expect(isInsideReal(root, join(root, "real.txt"))).toBe(true);
		expect(guardFileTool("write", { path: "real.txt" }, root, config())).toBeUndefined();
	});
});
