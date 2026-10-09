import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyIncludes, globToRegExp, includePatterns, isIncluded } from "./include.ts";
import { cleanup, execP, makeRepo } from "../../test/helpers/git.ts";
import { makeFakePi } from "../../test/helpers/fixtures/worktree.ts";

const pi = makeFakePi();
const cleanups: string[] = [];

afterAll(() => cleanup(...cleanups));

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

	test("compiles a pattern to a sticky regular expression", () => {
		expect(globToRegExp("*.env").test("a.env")).toBe(true);
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

describe("includePatterns", () => {
	test("reads .worktreeinclude and ignores comments", async () => {
		const repo = await makeRepo("pi-wt-inc-");
		cleanups.push(repo);
		writeFileSync(join(repo, ".worktreeinclude"), "# comment\n.env\n\nconfig/secrets.json\n");
		expect(includePatterns(repo, ["fallback"])).toEqual([".env", "config/secrets.json"]);
	});

	test("falls back to the config list when the file is absent", async () => {
		const repo = await makeRepo("pi-wt-inc-");
		cleanups.push(repo);
		expect(includePatterns(repo, ["a", "b"])).toEqual(["a", "b"]);
	});
});

describe("copyIncludes", () => {
	let repo: string;
	let target: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-wt-copy-");
		target = mkdtempSync(join(tmpdir(), "pi-wt-target-"));
		cleanups.push(repo, target);

		writeFileSync(join(repo, ".gitignore"), ".env\nconfig/secrets.json\nbuild/\n.pi/worktrees/\n");
		writeFileSync(join(repo, ".env"), "SECRET=1\n");
		mkdirSync(join(repo, "config"));
		writeFileSync(join(repo, "config", "secrets.json"), "{}\n");
		mkdirSync(join(repo, "build"));
		writeFileSync(join(repo, "build", "out.txt"), "artifact\n");
		mkdirSync(join(repo, ".pi", "worktrees", "other"), { recursive: true });
		writeFileSync(join(repo, ".pi", "worktrees", "other", ".env"), "OTHER=1\n");
		writeFileSync(join(repo, ".worktreeinclude"), ".env\nconfig/secrets.json\nbuild/\n");
		await execP("git", ["add", ".gitignore", ".worktreeinclude"], { cwd: repo });
		await execP("git", ["commit", "-qm", "ignore"], { cwd: repo });
	});

	test("copies matching gitignored files, preserving paths, skipping the managed dir", async () => {
		const patterns = includePatterns(repo, []);
		const copied = await copyIncludes(pi, repo, target, patterns, ".pi/worktrees");

		expect(copied.sort()).toEqual([".env", "build/out.txt", "config/secrets.json"]);
		expect(existsSync(join(target, ".env"))).toBe(true);
		expect(existsSync(join(target, "config", "secrets.json"))).toBe(true);
		expect(existsSync(join(target, "build", "out.txt"))).toBe(true);
		// The other worktree's ignored .env matches the pattern but is excluded.
		expect(existsSync(join(target, ".pi", "worktrees", "other", ".env"))).toBe(false);
	});

	test("returns nothing when there are no patterns", async () => {
		const empty = mkdtempSync(join(tmpdir(), "pi-wt-target-"));
		cleanups.push(empty);
		expect(await copyIncludes(pi, repo, empty, [])).toEqual([]);
	});

	test("isIncluded matches the copied set", () => {
		expect(isIncluded(".env", [".env"])).toBe(true);
		expect(isIncluded("config/secrets.json", ["config/secrets.json"])).toBe(true);
		expect(isIncluded("README.md", [".env"])).toBe(false);
	});
});
