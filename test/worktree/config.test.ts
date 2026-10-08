import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../../extensions/worktree/config.ts";

// Pass the agent dir explicitly so these tests never depend on
// `PI_CODING_AGENT_DIR` (other suites mock the host package, and that mock is
// process-global).
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
			join(globalDir, "worktree.json"),
			JSON.stringify({ baseRef: "head", pruneAfterDays: 30, guard: { blockReadEscapes: true } }),
		);
		writeFileSync(
			join(repo, ".pi", "worktree.json"),
			JSON.stringify({ branchPrefix: "wt-", guard: { blockGitRedirects: false } }),
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

	test("replaces include and skipOverrides wholesale instead of appending", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "worktree.json"), JSON.stringify({ include: ["a", "b"], skipOverrides: ["bash"] }));
		writeFileSync(join(repo, ".pi", "worktree.json"), JSON.stringify({ include: ["c"] }));

		const config = loadConfig(repo, globalDir);
		expect(config.include).toEqual(["c"]);
		expect(config.skipOverrides).toEqual(["bash"]);
	});

	test("ignores malformed files", () => {
		const globalDir = tempDir("worktree-global-");
		const repo = tempDir("worktree-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "worktree.json"), "{ not json");
		writeFileSync(join(repo, ".pi", "worktree.json"), "{ also not json");

		expect(loadConfig(repo, globalDir)).toEqual(DEFAULT_CONFIG);
	});
});
