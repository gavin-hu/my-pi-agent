import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createPlanStore, isWithin, MAX_PLAN_BYTES, planTitle, slugify, stamp } from "./plans.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { fixedPlanDate } from "../../test/helpers/fixtures/plan.ts";

const FIXED = fixedPlanDate(); // 2026-10-08 15:30 local

// Windows requires Developer Mode/admin to create symlinks; skip those tests
// rather than fail when the privilege is unavailable.
const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

function tempDir(): string {
	// Native real path: `repoRoot` canonicalizes git's output the same way, so
	// expected and returned paths compare equal on Windows (8.3 short names).
	return realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-")));
}

/** A fake pi whose `git rev-parse` reports `root` as the repository root. */
function repoPi(root: string) {
	return createFakePi({
		exec: async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse") return { stdout: `${root}\n`, stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	}).pi;
}

/** A fake pi outside any repository. */
function noRepoPi() {
	return createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 128 }) }).pi;
}

describe("slugify", () => {
	test("turns a title into a lowercase hyphenated slug", () => {
		expect(slugify("Add rate limiting!")).toBe("add-rate-limiting");
	});

	test("strips accents and collapses punctuation", () => {
		expect(slugify("  Café / déjà-vu  ")).toBe("cafe-deja-vu");
	});

	test("falls back to plan when nothing survives", () => {
		expect(slugify("***")).toBe("plan");
		expect(slugify("")).toBe("plan");
	});

	test("caps the length and trims a trailing hyphen", () => {
		const slug = slugify("a".repeat(100));
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith("-")).toBe(false);
	});
});

describe("stamp", () => {
	test("formats local YYYY-MM-DD-HHmm", () => {
		expect(stamp(FIXED)).toBe("2026-10-08-1530");
	});
});

describe("isWithin", () => {
	test("accepts a nested path and rejects traversal", () => {
		const dir = join(tmpdir(), "plans");
		expect(isWithin(dir, join(dir, "a.md"))).toBe(true);
		expect(isWithin(dir, join(dir, "..", "escape.md"))).toBe(false);
		expect(isWithin(dir, dir)).toBe(false);
	});

	test("accepts an in-tree sibling whose name starts with ..", () => {
		const dir = join(tmpdir(), "plans");
		// `..notes` is inside: only `..` and `../` escape. A naive prefix check
		// would reject it.
		expect(isWithin(dir, join(dir, "..notes"))).toBe(true);
		expect(isWithin(dir, join(dir, "..", "plans2"))).toBe(false);
	});
});

describe("createPlanStore — directory resolution", () => {
	test("uses <repo>/.pi/plans inside a repository", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		expect(await store.dirFor(root)).toBe(join(root, CONFIG_DIR_NAME, "plans"));
	});

	test("falls back to the agent directory outside a repository", async () => {
		const store = createPlanStore(noRepoPi(), { now: () => FIXED });
		expect(await store.dirFor(process.cwd())).toBe(join(getAgentDir(), "plans"));
	});
});

describe("createPlanStore — write", () => {
	test("names the file by timestamp and slug and self-ignores the directory", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Add rate limiting", content: "# Plan\n1. Do it" });

		expect(file.path).toBe(join(root, CONFIG_DIR_NAME, "plans", "2026-10-08-1530-add-rate-limiting.md"));
		expect(readFileSync(file.path, "utf-8")).toContain("1. Do it");
		expect(readFileSync(join(root, CONFIG_DIR_NAME, "plans", ".gitignore"), "utf-8")).toBe("*\n");
		expect(file.relativePath).toBe(join(CONFIG_DIR_NAME, "plans", "2026-10-08-1530-add-rate-limiting.md"));
		expect(file.bytes).toBeGreaterThan(0);
	});

	test("suffixes a colliding name instead of overwriting", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const first = await store.write(root, { title: "Same", content: "one" });
		const second = await store.write(root, { title: "Same", content: "two" });
		expect(second.path).not.toBe(first.path);
		expect(second.path).toContain("-same-2.md");
		expect(readFileSync(first.path, "utf-8")).toBe("one");
	});

	test("overwrites an existing in-directory plan when plan_path is given", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const first = await store.write(root, { title: "First", content: "one" });
		const refined = await store.write(root, { title: "First", content: "two", planPath: first.path });
		expect(refined.path).toBe(first.path);
		expect(readFileSync(first.path, "utf-8")).toBe("two");
	});

	test("rejects a plan_path outside the plans directory", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		await expect(store.write(root, { title: "x", content: "x", planPath: join(root, "escape.md") })).rejects.toThrow(
			/inside the plans directory/,
		);
	});

	test("rejects an oversized plan and an empty title", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		await expect(store.write(root, { title: "big", content: "x".repeat(MAX_PLAN_BYTES + 1) })).rejects.toThrow(
			/too large/,
		);
		await expect(store.write(root, { title: "   ", content: "x" })).rejects.toThrow(/title is required/);
	});
});

describe("createPlanStore — read", () => {
	test("reads a written plan back", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Round trip", content: "# Hello" });
		const read = await store.read(root, file.path);
		expect(read?.content).toBe("# Hello");
	});

	test("returns undefined for a missing or outside path", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		expect(await store.read(root, join(root, "nope.md"))).toBeUndefined();
		expect(await store.read(root, join(root, "..", "escape.md"))).toBeUndefined();
		writeFileSync(join(root, "outside.md"), "secret");
		expect(await store.read(root, join(root, "outside.md"))).toBeUndefined();
	});

	test("accepts a path relative to the working directory", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Relative", content: "body" });
		const relative = join(CONFIG_DIR_NAME, "plans", "2026-10-08-1530-relative.md");
		expect(existsSync(file.path)).toBe(true);
		expect((await store.read(root, relative))?.content).toBe("body");
	});
});

describe("createPlanStore — containment", () => {
	test("refuses to overwrite the directory's .gitignore or a non-markdown file", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, ".gitignore"), "*\n");
		writeFileSync(join(dir, "notes.txt"), "keep");

		await expect(
			store.write(root, { title: "x", content: "!*.md\n", planPath: join(dir, ".gitignore") }),
		).rejects.toThrow(/markdown plan file/);
		await expect(store.write(root, { title: "x", content: "x", planPath: join(dir, "notes.txt") })).rejects.toThrow(
			/markdown plan file/,
		);

		expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe("*\n");
		expect(readFileSync(join(dir, "notes.txt"), "utf-8")).toBe("keep");
	});

	symlinkTest("refuses a symlink that points outside the plans directory", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		const outside = join(root, "outside.md");
		writeFileSync(outside, "secret");
		const link = join(dir, "link.md");
		symlinkSync(outside, link);

		expect(await store.read(root, link)).toBeUndefined();
		await expect(store.write(root, { title: "x", content: "pwn", planPath: link })).rejects.toThrow(
			/markdown plan file/,
		);
		expect(readFileSync(outside, "utf-8")).toBe("secret");
	});

	symlinkTest("skips a dangling symlink when choosing a new plan name", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		const target = join(root, "created-by-write.md");
		symlinkSync(target, join(dir, "2026-10-08-1530-dangling.md"));

		const file = await store.write(root, { title: "Dangling", content: "body" });
		expect(file.path).toContain("2026-10-08-1530-dangling-2.md");
		expect(existsSync(target)).toBe(false);
	});

	symlinkTest("refuses a symlinked subdirectory that escapes the plans directory", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		const outside = mkdtempSync(join(tmpdir(), "pi-plan-outside-"));
		symlinkSync(outside, join(dir, "sub"));

		await expect(
			store.write(root, { title: "x", content: "pwn", planPath: join(dir, "sub", "escape.md") }),
		).rejects.toThrow(/markdown plan file/);
	});
});

describe("planTitle", () => {
	test("drops the extension and the timestamp prefix", () => {
		expect(planTitle("2026-10-08-1530-add-rate-limiting.md")).toBe("add-rate-limiting");
		expect(planTitle("custom-name.md")).toBe("custom-name");
	});
});
