import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS, ENV_ROOT, isExtensionEnabled, resolveEffectiveCwd, worktreeRoot } from "./env.ts";

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

describe("isExtensionEnabled", () => {
	test("is enabled when the variable is unset or empty", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: undefined }, () => expect(isExtensionEnabled("todo")).toBe(true));
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => expect(isExtensionEnabled("todo")).toBe(true));
	});

	test("is disabled when the name appears in a comma-separated list", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo,job" }, () => {
			expect(isExtensionEnabled("todo")).toBe(false);
			expect(isExtensionEnabled("job")).toBe(false);
		});
	});

	test("is disabled when the name appears in a whitespace-separated list", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo,  job\nplan" }, () => {
			expect(isExtensionEnabled("todo")).toBe(false);
			expect(isExtensionEnabled("job")).toBe(false);
			expect(isExtensionEnabled("plan")).toBe(false);
		});
	});

	test("stays enabled when the list names only other or unknown extensions", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "does-not-exist,job" }, () => {
			expect(isExtensionEnabled("todo")).toBe(true);
			expect(isExtensionEnabled("does-not-exist")).toBe(false);
		});
	});

	test("compares names case-insensitively", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "TODO" }, () => expect(isExtensionEnabled("todo")).toBe(false));
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
