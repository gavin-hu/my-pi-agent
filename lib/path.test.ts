import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isInside, isInsideReal, realPathOfNearest } from "./path.ts";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { canCreateSymlinks } from "../test/helpers/platform.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

// Windows requires Developer Mode/admin to create symlinks; skip those tests
// rather than fail when the privilege is unavailable.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

describe("isInside", () => {
	test("accepts the root and descendants", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b", "/a/b/c")).toBe(true);
		expect(isInside("/a/b", "/a/b/c/d")).toBe(true);
	});

	test("rejects siblings, parents, and prefixes", () => {
		expect(isInside("/a/b", "/a/c")).toBe(false);
		expect(isInside("/a/b", "/a")).toBe(false);
		expect(isInside("/a/b", "/a/bc")).toBe(false);
	});
});

describe("realPathOfNearest", () => {
	test("resolves a missing leaf through its parent", () => {
		const base = temps.track(tempDir("pi-path-real-"));
		expect(realPathOfNearest(join(base, "missing", "deep.txt"))).toBe(
			join(realpathSync.native(base), "missing", "deep.txt"),
		);
	});
});

describe("isInsideReal", () => {
	test("keeps ordinary paths inside the root", () => {
		const base = temps.track(tempDir("pi-path-real-"));
		const root = join(base, "root");
		mkdirSync(root);
		writeFileSync(join(root, "real.txt"), "x");
		expect(isInsideReal(root, join(root, "real.txt"))).toBe(true);
	});

	symlinkTest("refuses a symlink that leaves the root", () => {
		const base = temps.track(tempDir("pi-path-symlink-"));
		const root = join(base, "root");
		const outside = join(base, "outside");
		mkdirSync(root);
		mkdirSync(outside);
		symlinkSync(outside, join(root, "link"));
		expect(isInsideReal(root, join(root, "link", "file.txt"))).toBe(false);
	});
});
