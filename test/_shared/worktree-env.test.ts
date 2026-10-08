import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_ROOT, resolveEffectiveCwd, worktreeRoot } from "../../extensions/_shared/worktree-env.ts";

const saved = process.env[ENV_ROOT];
const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-worktree-env-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	if (saved === undefined) delete process.env[ENV_ROOT];
	else process.env[ENV_ROOT] = saved;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("worktreeRoot", () => {
	test("returns the env root when it is a real directory", () => {
		const dir = tempDir();
		process.env[ENV_ROOT] = dir;
		expect(worktreeRoot()).toBe(dir);
	});

	test("ignores a root that no longer exists on disk", () => {
		process.env[ENV_ROOT] = join(tempDir(), "gone");
		expect(worktreeRoot()).toBeUndefined();
	});

	test("is undefined when the variable is unset or empty", () => {
		delete process.env[ENV_ROOT];
		expect(worktreeRoot()).toBeUndefined();
		process.env[ENV_ROOT] = "";
		expect(worktreeRoot()).toBeUndefined();
	});
});

describe("resolveEffectiveCwd", () => {
	test("prefers the active worktree root over the session cwd", () => {
		const dir = tempDir();
		process.env[ENV_ROOT] = dir;
		expect(resolveEffectiveCwd("/main/checkout")).toBe(dir);
	});

	test("falls back to the session cwd with no active worktree", () => {
		delete process.env[ENV_ROOT];
		expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout");
	});

	test("falls back when the recorded worktree is gone", () => {
		process.env[ENV_ROOT] = join(tempDir(), "gone");
		expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout");
	});
});
