/**
 * The read-only git shell guard: the command shapes plan mode's `bash` accepts, and the
 * ones it refuses, each stated by the command it runs.
 *
 * `checkReadOnlyGit` is the whole boundary — `index.ts` only prefixes its reason — so a
 * shape is proved against the guard directly rather than through a tool call.
 */

import { describe, expect, test } from "bun:test";
import { checkReadOnlyGit } from "./git-bash.ts";

describe("read-only git shell guard — allowed shapes", () => {
	const ok = (command: string): boolean => checkReadOnlyGit(command).ok;
	const reason = (command: string): string => {
		const verdict = checkReadOnlyGit(command);
		return verdict.ok ? "" : verdict.reason;
	};

	const allowed = [
		"git status",
		"git status --short --branch",
		"git diff --stat",
		"git diff HEAD -- src/a.ts",
		"git log --oneline -n 5",
		"git log --oneline --decorate --all --graph -20",
		"git show HEAD",
		"git branch",
		"git branch -a",
		"git branch -l 'feature/*'",
		"git branch --format=refname",
		"git rev-parse HEAD",
		"git describe --tags",
		"git blame src/a.ts",
		"git grep TODO",
		"git shortlog -sn",
		"git ls-files",
		"git ls-tree HEAD",
		"git show-ref",
		"git merge-base main HEAD",
		"git stash list",
		"git stash show -p",
		"git worktree list",
		"git reflog",
		"git reflog show",
		"git remote -v",
		"git remote show origin",
		"git config --get user.name",
		"git config --get-all remote.origin.fetch",
		"git config user.name",
		"git config --list --show-origin",
		"git config --get-regexp '^user\\..*'",
		"git config --type=bool core.fsmonitor",
		"git config --file .git/config --get user.name",
		"git tag",
		"git tag -l",
		"git tag --list 'v*'",
		"git tag --sort=-creatordate",
		"git version",
		"git --version",
		"git status && git diff --stat",
		"git status; git log --oneline -n 5",
		"git branch && git status",
		"git status&&git status",
		"git status --short",
		// A backslash before an ordinary character is a Windows path separator.
		"git diff -- extensions\\plan",
		"git ls-files -- extensions\\plan",
		"git ls-files -- 'extensions\\plan'",
		'git diff -- "C:\\repo\\src\\a.ts"',
		"git log --oneline -- C:\\repo",
		"git log --format='%h\\t%s'",
	];
	for (const command of allowed) {
		test(`allows: ${command}`, () => {
			expect(ok(command), reason(command)).toBe(true);
		});
	}
});

describe("read-only git shell guard — refused shapes", () => {
	const ok = (command: string): boolean => checkReadOnlyGit(command).ok;
	const reason = (command: string): string => {
		const verdict = checkReadOnlyGit(command);
		return verdict.ok ? "" : verdict.reason;
	};

	const blocked = [
		"",
		"   ",
		"rm -rf x",
		"echo hi",
		"git commit -m x",
		"git add .",
		"git push",
		"git checkout main",
		"git reset --hard",
		"git switch main",
		"git fetch",
		// One refused segment refuses the whole chain.
		"git status; rm -rf x",
		"git status && rm -rf x",
		"git status && git push",
		"git status && git status > out",
		"git status && git status | sh",
		"git status && $(git log)",
		"git status || git status",
		"git status &&",
		"&& git status",
		"git status;; git log",
		"git status || true",
		// Pipes, redirection, substitution, and backticks are never a read.
		"git status | sh",
		"git status > out",
		"$(git status)",
		"git status `whoami`",
		"git log --grep='a;b'",
		// Options that write a file or run another program.
		"git log --output=x",
		"git log --ext-diff",
		"git grep -O foo",
		"git grep -Ocat TODO",
		"git grep -O=cat TODO",
		"git cat-file --filters --path=src/a.ts blob",
		"git -c alias.x=!sh x",
		"git --git-dir=/tmp/x status",
		// Dual-use subcommands must be in their listing form.
		"git branch -D foo",
		"git branch foo",
		"git tag -d v1",
		"git tag v1",
		"git remote add o url",
		"git remote set-url o url",
		"git config user.name x",
		// `git config` writes, each one paired with a read flag: a guard that only asks
		// whether a read flag appears anywhere ran every one of these.
		"git config --show-scope --replace-all core.fsmonitor /tmp/hook.sh",
		"git config --show-origin --add core.fsmonitor /tmp/hook.sh",
		"git config --show-scope --unset user.name",
		"git config --list --unset-all user.name",
		"git config --show-origin --edit",
		"git config -l -e",
		"git config --show-scope --rename-section a b",
		"git config --show-origin --remove-section a",
		"git config --show-origin --file .git/config user.name x",
		"git stash",
		"git worktree add p",
		"git reflog expire --all",
		"cd /tmp",
		"cd /tmp && git status",
		// An escaped separator or metacharacter is a shell escape, not a path.
		"git diff -- C:\\repo\\src; rm -rf x",
		"git status \\; rm -rf x",
		"git status \\| sh",
		"git status \\& rm",
		"git diff -- C:\\repo\\",
	];
	for (const command of blocked) {
		test(`blocks: ${command || "(empty)"}`, () => {
			expect(ok(command)).toBe(false);
			expect(reason(command).length).toBeGreaterThan(0);
		});
	}

	test("explains that cd is unnecessary", () => {
		expect(reason("cd /tmp")).toContain("working directory");
	});

	test("names the git rule for a non-git command", () => {
		expect(reason("ls")).toContain("read-only git");
	});

	test("names the config write it refuses, and the form that writes without a flag", () => {
		expect(reason("git config --show-scope --replace-all core.fsmonitor /tmp/hook.sh")).toContain("--replace-all");
		expect(reason("git config user.name x")).toContain("<name> <value>");
	});
});
