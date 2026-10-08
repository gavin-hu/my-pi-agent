import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegExp, isIncluded } from "../../extensions/worktree/include.ts";
import {
	isInside,
	isInsideReal,
	realPathOfNearest,
	resolveUnder,
	guardFileTool,
	analyzeBashCommand,
} from "../../extensions/worktree/guard.ts";
import { parsePrReference } from "../../extensions/worktree/git.ts";
import type { WorktreeConfig } from "../../extensions/worktree/config.ts";
import { cleanup, testConfig } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => cleanup(...temps));

function config(guard: Partial<WorktreeConfig["guard"]> = {}): WorktreeConfig {
	return testConfig({ guard });
}

const ROOT = "/wt";

describe("globToRegExp / isIncluded", () => {
	test("basename patterns match at any depth", () => {
		expect(isIncluded(".env", ["*.env"])).toBe(true);
		expect(isIncluded("nested/.env", ["*.env"])).toBe(true);
		expect(isIncluded("nested/deep/.env.local", ["*.env.local"])).toBe(true);
		expect(isIncluded("nested/config.json", ["*.env"])).toBe(false);
	});

	test("patterns with a slash are anchored to the repo root", () => {
		expect(isIncluded("config/secrets.json", ["config/secrets.json"])).toBe(true);
		expect(isIncluded("nested/config/secrets.json", ["config/secrets.json"])).toBe(false);
	});

	test("** spans directories", () => {
		expect(isIncluded("vendor/config.json", ["vendor/**/config.json"])).toBe(true);
		expect(isIncluded("vendor/a/b/config.json", ["vendor/**/config.json"])).toBe(true);
		expect(isIncluded("other/vendor/config.json", ["vendor/**/config.json"])).toBe(false);
	});

	test("trailing slash matches directory contents", () => {
		expect(isIncluded("logs", ["logs/"])).toBe(true);
		expect(isIncluded("logs/app.log", ["logs/"])).toBe(true);
		expect(isIncluded("logs2/app.log", ["logs/"])).toBe(false);
	});

	test("negation wins when it comes last", () => {
		expect(isIncluded("a.env", ["*.env", "!a.env"])).toBe(false);
		expect(isIncluded("b.env", ["*.env", "!a.env"])).toBe(true);
		expect(isIncluded("a.env", ["!a.env", "*.env"])).toBe(true);
	});

	test("returns a RegExp", () => {
		expect(globToRegExp("*.env")).toBeInstanceOf(RegExp);
	});

	test("supports character classes and backslash escapes", () => {
		expect(isIncluded("a.env", ["[ab].env"])).toBe(true);
		expect(isIncluded("c.env", ["[ab].env"])).toBe(false);
		expect(isIncluded("b.env", ["[a-c].env"])).toBe(true);
		expect(isIncluded("a.env", ["[!a].env"])).toBe(false);
		expect(isIncluded("b.env", ["[!a].env"])).toBe(true);
		expect(isIncluded("*.env", ["\\*.env"])).toBe(true);
		expect(isIncluded("a.env", ["\\*.env"])).toBe(false);
	});
});

describe("isInside / resolveUnder", () => {
	test("root itself and descendants are inside", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b", "/a/b/c/d")).toBe(true);
	});

	test("siblings, parents and prefixes are outside", () => {
		expect(isInside("/a/b", "/a/c")).toBe(false);
		expect(isInside("/a/b", "/a")).toBe(false);
		expect(isInside("/a/b", "/a/bc")).toBe(false);
	});

	test("resolveUnder treats a missing path as the root and resolves relative paths", () => {
		expect(resolveUnder("/a/b", undefined)).toBe("/a/b");
		expect(resolveUnder("/a/b", "")).toBe("/a/b");
		expect(resolveUnder("/a/b", "c")).toBe("/a/b/c");
		expect(resolveUnder("/a/b", "/x/y")).toBe("/x/y");
	});
});

describe("guardFileTool", () => {
	test("blocks writes outside the worktree", () => {
		const result = guardFileTool("write", { path: "/main/file.txt" }, ROOT, config());
		expect(result?.block).toBe(true);
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
		const result = guardFileTool("read", { path: "/main/file.txt" }, ROOT, config({ blockReadEscapes: true }));
		expect(result?.block).toBe(true);
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

describe("symlink-safe containment", () => {
	test("blocks a write through a symlink that leaves the worktree", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-wt-symlink-"));
		temps.push(base);
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
		const base = mkdtempSync(join(tmpdir(), "pi-wt-symlink-"));
		temps.push(base);
		const root = join(base, "worktree");
		mkdirSync(root);
		writeFileSync(join(root, "real.txt"), "x");
		expect(isInsideReal(root, join(root, "real.txt"))).toBe(true);
		expect(guardFileTool("write", { path: "real.txt" }, root, config())).toBeUndefined();
	});

	test("realPathOfNearest resolves a missing leaf through its parent", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-wt-real-"));
		temps.push(base);
		expect(realPathOfNearest(join(base, "missing", "deep.txt"))).toBe(join(realpathSync(base), "missing", "deep.txt"));
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
		expect(parsePrReference("https://gitlab.com/group/repo/-/merge_requests/7")).toEqual({ number: 7, host: "gitlab" });
	});

	test("returns undefined for ordinary names", () => {
		expect(parsePrReference("feature-auth")).toBeUndefined();
		expect(parsePrReference("https://example.com/not-a-pr")).toBeUndefined();
	});
});
