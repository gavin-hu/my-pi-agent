/**
 * The plan store's location and its path rules, as the two extensions that have to
 * agree about a plan file read them.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { isContainedPlan, isPlanFileName, PLANS_DIR_NAME, plansDir, plansDirFor, resolvePlanArg } from "./paths.ts";

// A path the store can be built under, spelled the way the platform roots one: the
// POSIX literal `/agent` is drive-less on Windows, and `resolve` would then return a path
// that the join below cannot produce.
const AGENT = resolve("/agent");
const STORE = join(AGENT, PLANS_DIR_NAME, "abc123");

const ROOT = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-paths-")));
const STORE_DIR = join(ROOT, "plans", "abc123");
mkdirSync(STORE_DIR, { recursive: true });
afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
});

const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

describe("plansDir", () => {
	test("files a repository's plans under its key", () => {
		expect(plansDir(AGENT, "abc123")).toBe(STORE);
	});

	test("keeps the unkeyed directory for a directory outside a repository", () => {
		expect(plansDir(AGENT)).toBe(join(AGENT, PLANS_DIR_NAME));
	});
});

describe("plansDirFor", () => {
	test("keys on the repository git resolved, and leaves a directory outside one unkeyed", () => {
		// The branch both extensions used to carry a copy of.
		expect(plansDirFor(AGENT, { key: "abc123", fromGit: true })).toBe(STORE);
		expect(plansDirFor(AGENT, { key: "abc123", fromGit: false })).toBe(join(AGENT, PLANS_DIR_NAME));
	});
});

describe("isPlanFileName", () => {
	test("accepts markdown, at any depth", () => {
		expect(isPlanFileName("a.md")).toBe(true);
		expect(isPlanFileName("2026-10-08-1530-add-rate-limiting.md")).toBe(true);
		expect(isPlanFileName("A.MD")).toBe(true);
		expect(isPlanFileName(join("some", "dir", "a.md"))).toBe(true);
	});

	test("refuses a dotfile, and anything that is not markdown", () => {
		expect(isPlanFileName(".a.md")).toBe(false);
		expect(isPlanFileName(".gitignore")).toBe(false);
		expect(isPlanFileName("a.txt")).toBe(false);
		expect(isPlanFileName("a.md.tmp")).toBe(false);
	});
});

describe("resolvePlanArg", () => {
	test("accepts the `~/…` form the tools display", () => {
		expect(resolvePlanArg(STORE, "~/p/one.md")).toBe(join(homedir(), "p", "one.md"));
		expect(resolvePlanArg(STORE, "~")).toBe(homedir());
	});

	test("accepts an absolute path as it is", () => {
		const absolute = join(ROOT, "one.md");
		expect(resolvePlanArg(STORE, absolute)).toBe(absolute);
	});

	test("resolves a bare name inside the store, and trims", () => {
		expect(resolvePlanArg(STORE, "one.md")).toBe(join(STORE, "one.md"));
		expect(resolvePlanArg(STORE, "  one.md  ")).toBe(join(STORE, "one.md"));
	});
});

describe("isContainedPlan", () => {
	test("accepts a plan in the store, including one not written yet", () => {
		writeFileSync(join(STORE_DIR, "written.md"), "# one\n");
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, "written.md"))).toBe(true);
		// A missing file is a new plan, not an escape.
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, "future.md"))).toBe(true);
	});

	test("refuses a path outside the store", () => {
		expect(isContainedPlan(STORE_DIR, join(ROOT, "one.md"))).toBe(false);
		// A sibling whose name prefixes the store's is not inside it.
		expect(isContainedPlan(STORE_DIR, `${STORE_DIR}-other/one.md`)).toBe(false);
	});

	test("refuses a dotfile and a non-markdown file", () => {
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, ".one.md"))).toBe(false);
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, "one.txt"))).toBe(false);
	});

	symlinkTest("refuses a symlink, and a directory reached through one", () => {
		const outside = join(ROOT, "outside");
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "one.md"), "# one\n");
		symlinkSync(join(outside, "one.md"), join(STORE_DIR, "link.md"));
		symlinkSync(outside, join(STORE_DIR, "linked-dir"));
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, "link.md"))).toBe(false);
		expect(isContainedPlan(STORE_DIR, join(STORE_DIR, "linked-dir", "one.md"))).toBe(false);
	});
});
