import { describe, expect, test } from "bun:test";
import { checkReadOnlyGit } from "./git-bash.ts";

const ok = (command: string): boolean => checkReadOnlyGit(command).ok;
const reason = (command: string): string => {
	const verdict = checkReadOnlyGit(command);
	return verdict.ok ? "" : verdict.reason;
};

describe("checkReadOnlyGit — allowed read-only commands", () => {
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

describe("checkReadOnlyGit — blocked commands", () => {
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
		"git status | sh",
		"git status > out",
		"$(git status)",
		"git status `whoami`",
		"git log --grep='a;b'",
		"git log --output=x",
		"git log --ext-diff",
		"git grep -O foo",
		"git -c alias.x=!sh x",
		"git --git-dir=/tmp/x status",
		"git branch -D foo",
		"git branch foo",
		"git tag -d v1",
		"git tag v1",
		"git remote add o url",
		"git remote set-url o url",
		"git config user.name x",
		"git stash",
		"git worktree add p",
		"git reflog expire --all",
		"cd /tmp",
		"cd /tmp && git status",
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
});

describe("checkReadOnlyGit — refusal wording", () => {
	test("explains that cd is unnecessary", () => {
		expect(reason("cd /tmp")).toContain("working directory");
	});

	test("names the git rule for a non-git command", () => {
		expect(reason("ls")).toContain("read-only git");
	});
});
