/**
 * The read-only git shell guard: the command shapes plan mode's `bash` accepts, and the
 * ones it refuses, each stated by the command it runs.
 *
 * `readOnlyGitCommand` is the whole boundary — it answers with the command to run, and
 * `index.ts` only prefixes a refusal's reason — so a shape is proved against the guard
 * directly rather than through a tool call.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { readOnlyGitCommand } from "./git-bash.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("read-only git shell guard — allowed shapes", () => {
	const ok = (command: string): boolean => readOnlyGitCommand(command).ok;
	const reason = (command: string): string => {
		const verdict = readOnlyGitCommand(command);
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
	const ok = (command: string): boolean => readOnlyGitCommand(command).ok;
	const reason = (command: string): string => {
		const verdict = readOnlyGitCommand(command);
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
		// `show` connects to the remote and `get-url` reads past this repository's config;
		// `-v` prints both URLs, so the narrowed form is what a plan is offered.
		"git remote show origin",
		"git remote get-url origin",
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

	test("names the form a narrowed remote should use", () => {
		expect(reason("git remote show origin")).toContain('"git remote -v"');
	});
});

describe("read-only git shell guard — the command it hands back", () => {
	const ran = (command: string): string => {
		const verdict = readOnlyGitCommand(command);
		if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
		return verdict.command;
	};

	// A repository can name a program for a diff — `diff.<driver>.textconv` and
	// `diff.external` — so every command that runs one carries the switches that stop it.
	test("forces the diff switches after the subcommand that runs a diff", () => {
		expect(ran("git diff")).toBe("git diff --no-textconv --no-ext-diff");
		expect(ran("git diff --stat")).toBe("git diff --no-textconv --no-ext-diff --stat");
		expect(ran("git show HEAD")).toBe("git show --no-textconv --no-ext-diff HEAD");
		expect(ran("git log -p -3")).toBe("git log --no-textconv --no-ext-diff -p -3");
		expect(ran("git diff-tree HEAD")).toBe("git diff-tree --no-textconv --no-ext-diff HEAD");
		// `git stash show` runs a diff under a second word, so the switches follow it.
		expect(ran("git stash show -p")).toBe("git stash show --no-textconv --no-ext-diff -p");
	});

	test("leaves a command that runs no diff exactly as written", () => {
		expect(ran("git status")).toBe("git status");
		expect(ran("git branch -a")).toBe("git branch -a");
		expect(ran("git stash list")).toBe("git stash list");
		expect(ran("git --version")).toBe("git --version");
		// Quoting survives: the guard never rebuilds a segment from tokens.
		expect(ran("git branch -l 'feature/*'")).toBe("git branch -l 'feature/*'");
		// A subcommand a diff name is a prefix of must not be read as that name: `show-ref`
		// is not `show`, and a prefix rule would have spliced flags into it.
		expect(ran("git show-ref")).toBe("git show-ref");
		expect(ran("git reflog")).toBe("git reflog");
	});

	test("is its own fixed point, and adds only the switch that is missing", () => {
		const once = ran("git show HEAD");
		expect(ran(once)).toBe(once);
		// A caller may pass one of the two; the other is still forced.
		expect(ran("git diff --no-textconv")).toBe("git diff --no-ext-diff --no-textconv");
	});

	test("rewrites every segment of a chain and keeps the separator as written", () => {
		expect(ran("git status && git diff --stat")).toBe("git status && git diff --no-textconv --no-ext-diff --stat");
		expect(ran("git show HEAD; git log -1")).toBe(
			"git show --no-textconv --no-ext-diff HEAD; git log --no-textconv --no-ext-diff -1",
		);
	});

	test("a caller cannot re-enable either program by name", () => {
		// The denylist refuses both, so the forced flag cannot be out-ordered.
		expect(readOnlyGitCommand("git diff --textconv").ok).toBe(false);
		expect(readOnlyGitCommand("git log --ext-diff -p").ok).toBe(false);
	});
});

describe("read-only git shell guard — a repository's own diff program", () => {
	/** A repo whose `.gitattributes` names a textconv driver that leaves a marker. */
	async function repoWithConverter(): Promise<{ repo: string; marker: string }> {
		const repo = temps.track(await makeRepo("pi-plan-guard-"));
		const marker = join(repo, "marker");
		const converter = join(repo, "converter.sh");
		writeFileSync(converter, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\ncat "$1"\n`, { mode: 0o755 });
		writeFileSync(join(repo, ".gitattributes"), "*.txt diff=evil\n");
		await execP("git", ["config", "diff.evil.textconv", converter], { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "one\n");
		await execP("git", ["add", "."], { cwd: repo });
		await execP("git", ["commit", "-qm", "one"], { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "two\n");
		return { repo, marker };
	}

	test("the command the guard hands back does not run it", async () => {
		const { repo, marker } = await repoWithConverter();
		// The claim is about what git executes, so this one case runs the produced command
		// rather than asserting on its text. It only ever gains bare flags, so splitting it is
		// the whole parse the guard's own output needs.
		const produced = readOnlyGitCommand("git diff");
		if (!produced.ok) throw new Error(`refused: ${produced.reason}`);
		const argv = produced.command.split(" ");
		const { code } = await execP(argv[0] ?? "git", argv.slice(1), { cwd: repo });
		expect(code).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	test("without the forced switches, the same repo runs it", async () => {
		// The control: a guard that only refused `--textconv` by name left this open.
		const { repo, marker } = await repoWithConverter();
		const { code } = await execP("git", ["diff"], { cwd: repo });
		expect(code).toBe(0);
		expect(existsSync(marker)).toBe(true);
	});
});
