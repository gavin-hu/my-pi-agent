import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createPlanStore, isWithin, MAX_PLAN_BYTES, slugify, stamp } from "../../extensions/plan-mode/plans.ts";
import { createFakePi } from "../helpers/fakes.ts";

const FIXED = new Date(2026, 9, 8, 15, 30); // 2026-10-08 15:30 local

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-plan-"));
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
		await expect(store.write(root, { title: "big", content: "x".repeat(MAX_PLAN_BYTES + 1) })).rejects.toThrow(/too large/);
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
