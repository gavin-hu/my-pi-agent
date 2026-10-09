import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "../test/helpers/env.ts";
import { ENV_ROOT, resolveEffectiveCwd, worktreeRoot } from "./env.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-worktree-env-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("worktreeRoot", () => {
	test("returns the env root when it is a real directory", async () => {
		const dir = tempDir();
		await withEnv({ [ENV_ROOT]: dir }, () => expect(worktreeRoot()).toBe(dir));
	});

	test("ignores a root that no longer exists on disk", async () => {
		await withEnv({ [ENV_ROOT]: join(tempDir(), "gone") }, () => expect(worktreeRoot()).toBeUndefined());
	});

	test("is undefined when the variable is unset or empty", async () => {
		await withEnv({ [ENV_ROOT]: undefined }, () => expect(worktreeRoot()).toBeUndefined());
		await withEnv({ [ENV_ROOT]: "" }, () => expect(worktreeRoot()).toBeUndefined());
	});
});

describe("resolveEffectiveCwd", () => {
	test("prefers the active worktree root over the session cwd", async () => {
		const dir = tempDir();
		await withEnv({ [ENV_ROOT]: dir }, () => expect(resolveEffectiveCwd("/main/checkout")).toBe(dir));
	});

	test("falls back to the session cwd with no active worktree", async () => {
		await withEnv({ [ENV_ROOT]: undefined }, () =>
			expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout"),
		);
	});

	test("falls back when the recorded worktree is gone", async () => {
		await withEnv({ [ENV_ROOT]: join(tempDir(), "gone") }, () =>
			expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout"),
		);
	});
});
