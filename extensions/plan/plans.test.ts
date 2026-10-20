import { describe, expect, test } from "bun:test";
import {
	existsSync,
	lutimesSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createPlanStore, MAX_PLAN_BYTES, planTitle, slugify, stamp } from "./plans.ts";
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

describe("createPlanStore — latest", () => {
	test("returns the newest plan by modification time", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const older = await store.write(root, { title: "Older", content: "old" });
		const newer = await store.write(root, { title: "Newer", content: "new" });
		utimesSync(older.path, 1_700_000_000, 1_700_000_000);
		utimesSync(newer.path, 1_700_000_100, 1_700_000_100);

		expect((await store.latest(root))?.path).toBe(newer.path);
		expect((await store.latest(root))?.content).toBe("new");
	});

	test("ignores the plans directory's own files", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Kept", content: "body" });
		const dir = await store.dirFor(root);
		const notes = join(dir, "notes.txt");
		writeFileSync(notes, "not a plan");
		utimesSync(notes, 2_000_000_000, 2_000_000_000);

		expect((await store.latest(root))?.path).toBe(file.path);
	});

	test("returns undefined before any plan is written", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		expect(await store.latest(root)).toBeUndefined();
	});

	symlinkTest("skips a symlinked plan", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Real", content: "body" });
		const dir = await store.dirFor(root);
		const outside = join(root, "outside.md");
		writeFileSync(outside, "secret");
		const link = join(dir, "link.md");
		symlinkSync(outside, link);
		// The link itself is the newest entry by lstat, and must still be skipped.
		lutimesSync(link, 2_000_000_000, 2_000_000_000);

		expect((await store.latest(root))?.path).toBe(file.path);
	});
});

describe("createPlanStore — index", () => {
	/** Write a plan file directly, so the test controls the name and mtime. */
	function seed(root: string, name: string, content: string, mtimeSeconds: number): string {
		const dir = join(root, CONFIG_DIR_NAME, "plans");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, name);
		writeFileSync(path, content);
		utimesSync(path, mtimeSeconds, mtimeSeconds);
		return path;
	}

	test("lists plans newest first with their title, steps, and bytes", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const old = seed(root, "2026-10-01-0900-old.md", "# Old plan\n\n## Steps\n- [x] one\n- [ ] two", 1_700_000_000);
		const fresh = seed(root, "2026-10-02-0900-fresh.md", "# Fresh plan\n\n## Steps\n- [x] only", 1_700_000_500);

		const rows = await store.index(root);

		expect(rows.map((row) => row.path)).toEqual([fresh, old]);
		expect(rows[0]).toMatchObject({ title: "Fresh plan", steps: { done: 1, total: 1 } });
		expect(rows[1]).toMatchObject({ title: "Old plan", steps: { done: 1, total: 2 } });
		expect(rows[0]?.relativePath).toContain(join(CONFIG_DIR_NAME, "plans"));
		expect(rows[0]?.bytes).toBeGreaterThan(0);
		expect(rows[0]?.modified).toBeCloseTo(1_700_000_500_000, -3);
	});

	test("falls back to the file-name slug when a plan has no heading", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		seed(root, "2026-10-01-0900-slugged-title.md", "- one\n- two", 1_700_000_000);

		const [row] = await store.index(root);

		expect(row?.title).toBe("slugged-title");
		expect(row?.steps).toEqual({ done: 0, total: 2 });
	});

	test("lists a hundred plans from one walk", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		for (let index = 0; index < 100; index++) {
			seed(
				root,
				`2026-09-${String((index % 28) + 1).padStart(2, "0")}-0900-plan-${index}.md`,
				`# Plan ${index}\n\n## Steps\n- [x] done\n- [ ] open`,
				1_700_000_000 + index,
			);
		}

		const rows = await store.index(root);

		expect(rows).toHaveLength(100);
		expect(rows[0]?.title).toBe("Plan 99");
		expect(rows.at(-1)?.title).toBe("Plan 0");
		for (const row of rows) expect(row.steps).toEqual({ done: 1, total: 2 });
	});

	test("lists an over-limit file without reading it", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const big = "# Huge\n" + "x".repeat(MAX_PLAN_BYTES);
		seed(root, "2026-10-01-0900-huge.md", big, 1_700_000_000);

		const [row] = await store.index(root);

		expect(row).toMatchObject({ title: "huge", oversize: true, bytes: big.length });
		expect(row?.steps).toBeUndefined();
	});

	test("skips the directory's own files, other extensions, and directories", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const kept = seed(root, "2026-10-01-0900-kept.md", "# Kept", 1_700_000_000);
		const dir = join(root, CONFIG_DIR_NAME, "plans");
		writeFileSync(join(dir, ".gitignore"), "*\n");
		writeFileSync(join(dir, "notes.txt"), "not a plan");
		mkdirSync(join(dir, "sub.md"));

		expect((await store.index(root)).map((row) => row.path)).toEqual([kept]);
	});

	symlinkTest("skips a symlinked plan", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const kept = seed(root, "2026-10-01-0900-kept.md", "# Kept", 1_700_000_000);
		const dir = join(root, CONFIG_DIR_NAME, "plans");
		const outside = join(root, "outside.md");
		writeFileSync(outside, "# Outside");
		symlinkSync(outside, join(dir, "link.md"));

		expect((await store.index(root)).map((row) => row.path)).toEqual([kept]);
	});

	test("indexes the worktree's own plans, not the main checkout's", async () => {
		const main = tempDir();
		const worktree = tempDir();
		seed(main, "2026-10-01-0900-main.md", "# Main checkout plan", 1_700_000_000);
		const own = seed(worktree, "2026-10-02-0900-worktree.md", "# Worktree plan", 1_700_000_500);
		// Inside a worktree, `git rev-parse --show-toplevel` reports the worktree.
		const store = createPlanStore(repoPi(worktree), { now: () => FIXED });

		const rows = await store.index(worktree);

		expect(rows.map((row) => row.path)).toEqual([own]);
		expect(rows[0]?.title).toBe("Worktree plan");
	});

	test("lists nothing before any plan is written", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		expect(await store.index(root)).toEqual([]);
	});
});

describe("createPlanStore — atomic writes", () => {
	test("rewrites a plan in place without leaving a temp file", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Refine", content: "v1" });

		await store.write(root, { title: "Refine", content: "v2", planPath: file.path });

		const dir = await store.dirFor(root);
		expect(readFileSync(file.path, "utf-8")).toBe("v2");
		expect(readdirSync(dir).sort()).toEqual([".gitignore", basename(file.path)]);
	});

	test("a step edit leaves no temp file either", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "- One" });

		await store.setSteps(root, file.path, [{ step: 1, status: "completed", expected: "One" }]);

		const dir = await store.dirFor(root);
		expect(readdirSync(dir).sort()).toEqual([".gitignore", basename(file.path)]);
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

describe("createPlanStore — setSteps", () => {
	test("refuses a stale expected text and writes nothing", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "## Steps\n- [ ] One\n- [ ] Two" });

		await expect(
			store.setSteps(root, file.path, [{ step: 2, status: "completed", expected: "Wire it" }]),
		).rejects.toThrow('Step 2 is no longer "Wire it"; the file now has "Two"');
		expect(readFileSync(file.path, "utf-8")).toBe("## Steps\n- [ ] One\n- [ ] Two");
	});

	test("accepts an expected text that matches after normalization", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "1. Add the cache\n2. Wire it" });

		const updated = await store.setSteps(root, file.path, [
			{ step: 1, status: "completed", expected: " add   the CACHE " },
		]);
		expect(updated.content).toBe("1. [x] Add the cache\n2. Wire it");
	});

	test("ticks off a step and returns the rewritten plan", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "1. One\n2. Two" });

		const updated = await store.setSteps(root, file.path, [{ step: 2, status: "completed", expected: "Two" }]);
		expect(updated.content).toBe("1. One\n2. [x] Two");
		expect(readFileSync(file.path, "utf-8")).toBe("1. One\n2. [x] Two");
	});

	test("applies a batch in one write", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "1. One\n2. Two\n3. Three" });

		const updated = await store.setSteps(root, file.path, [
			{ step: 1, status: "completed", expected: "One" },
			{ step: 3, status: "completed", expected: "Three" },
		]);
		expect(updated.content).toBe("1. [x] One\n2. Two\n3. [x] Three");
	});

	test("rejects an out-of-range step without touching the file", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Steps", content: "- One" });

		await expect(
			store.setSteps(root, file.path, [
				{ step: 1, status: "completed", expected: "One" },
				{ step: 3, status: "completed", expected: "Three" },
			]),
		).rejects.toThrow(/out of range/);
		expect(readFileSync(file.path, "utf-8")).toBe("- One");
	});

	test("rejects a missing or outside plan", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		writeFileSync(join(root, "outside.md"), "- One");

		await expect(
			store.setSteps(root, join(root, ".pi", "plans", "nope.md"), [{ step: 1, status: "completed", expected: "One" }]),
		).rejects.toThrow(/No plan file/);
		await expect(
			store.setSteps(root, join(root, "outside.md"), [{ step: 1, status: "completed", expected: "One" }]),
		).rejects.toThrow(/No plan file/);
	});
});

describe("createPlanStore — saveFeedback", () => {
	test("writes feedback into the plan and returns the updated content", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Review", content: "# Plan\n- [ ] step" });

		const updated = await store.saveFeedback(root, file.path, [{ anchor: 2, comment: "too vague" }]);
		expect(updated.content).toBe("# Plan\n- [ ] step\n> [!REVIEW] too vague");
		expect(readFileSync(file.path, "utf-8")).toBe(updated.content);
	});

	test("replaces earlier feedback instead of accumulating", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Review", content: "- [ ] step" });

		await store.saveFeedback(root, file.path, [{ anchor: 0, comment: "first" }]);
		const updated = await store.saveFeedback(root, file.path, [{ anchor: 0, comment: "second" }]);
		expect(updated.content).toBe("- [ ] step\n> [!REVIEW] second");
	});

	test("rejects a missing or outside plan", async () => {
		const root = tempDir();
		const store = createPlanStore(repoPi(root), { now: () => FIXED });
		writeFileSync(join(root, "outside.md"), "- One");

		await expect(store.saveFeedback(root, join(root, ".pi", "plans", "nope.md"), [])).rejects.toThrow(/No plan file/);
		await expect(store.saveFeedback(root, join(root, "outside.md"), [])).rejects.toThrow(/No plan file/);
	});
});

describe("planTitle", () => {
	test("drops the extension and the timestamp prefix", () => {
		expect(planTitle("2026-10-08-1530-add-rate-limiting.md")).toBe("add-rate-limiting");
		expect(planTitle("custom-name.md")).toBe("custom-name");
	});
});
