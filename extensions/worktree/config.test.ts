import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

// Pass the agent dir explicitly so these tests never read the developer's
// real config through `getAgentDir()`.
function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("loadConfig", () => {
	test("returns the defaults when no files exist", () => {
		expect(loadConfig(tempDir("worktree-repo-"), tempDir("worktree-global-"))).toEqual(DEFAULT_CONFIG);
	});

	test("merges the global file then the project file, with project winning", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(globalDir, "bytefly.json"),
			JSON.stringify({ worktree: { baseRef: "head", pruneAfterDays: 30, guard: { blockReadEscapes: true } } }),
		);
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { branchPrefix: "wt-", guard: { blockGitRedirects: false } } }),
		);

		const config = loadConfig(repo, globalDir);
		expect(config.baseRef).toBe("head");
		expect(config.pruneAfterDays).toBe(30);
		expect(config.branchPrefix).toBe("wt-");
		// Nested guard merges per key rather than replacing the whole object.
		expect(config.guard.blockReadEscapes).toBe(true);
		expect(config.guard.blockGitRedirects).toBe(false);
		expect(config.guard.blockFileEscapes).toBe(DEFAULT_CONFIG.guard.blockFileEscapes);
	});

	test("refuses powershell while isolated unless the switch turns it off", () => {
		const repo = tempDir("worktree-repo-");
		expect(loadConfig(repo, tempDir("worktree-global-")).guard.blockPowershell).toBe(true);

		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { guard: { blockPowershell: false } } }),
		);

		expect(loadConfig(repo, tempDir("worktree-global-")).guard.blockPowershell).toBe(false);
	});

	test("replaces include and skipOverrides wholesale instead of appending", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(
			join(globalDir, "bytefly.json"),
			JSON.stringify({ worktree: { include: ["a", "b"], skipOverrides: ["bash"] } }),
		);
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ worktree: { include: ["c"] } }));

		const config = loadConfig(repo, globalDir);
		expect(config.include).toEqual(["c"]);
		expect(config.skipOverrides).toEqual(["bash"]);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
		writeFileSync(join(repo, ".pi", "bytefly.json"), "{ also not json");

		expect(loadConfig(repo, globalDir)).toEqual(DEFAULT_CONFIG);
	});

	test("coerces a malformed nested guard to the defaults", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ worktree: { guard: "nope" } }));
		writeFileSync(
			join(repo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { guard: { blockFileEscapes: "yes" } } }),
		);

		// A non-object guard falls back wholesale; a non-boolean flag keeps the
		// base value, so no malformed value can reach the guard checks.
		expect(loadConfig(repo, globalDir).guard).toEqual(DEFAULT_CONFIG.guard);
	});
});
