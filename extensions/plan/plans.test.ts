import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	lutimesSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { blockAt, codeBody, contentBlockAt, fenceInfo, planBlocks, type PlanBlockKind } from "./blocks.ts";
import { formatPlanIndex, PlanIndexComponent, relativeAge } from "./plan-index.ts";
import { changedSections, type SectionDigest, sameSections, sanitizePlanText, sectionDigests } from "./plan-text.ts";
import { parseFeedback, stripFeedback } from "./feedback.ts";
import { createPlanStore, MAX_PLAN_BYTES, planTitle, slugify, stamp, type PlanSummary } from "./plans.ts";
import { ENV_ROOT } from "../../lib/env.ts";
import { createPlanPolicy, PLAN_ALLOWED_TOOLS, PLAN_SAFE_TOOLS } from "./policy.ts";
import {
	extractPlanSections,
	extractPlanSteps,
	goalSection,
	matchesStepText,
	MAX_STEP_LENGTH,
	MAX_STEPS,
	PLAN_OUTLINE,
	PLAN_SECTIONS,
	planStepSummary,
	setStepStatuses,
	verificationItem,
} from "./steps.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { useEnv } from "../../test/helpers/env.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { shortenPath } from "../../lib/format.ts";
import { createFakePi, fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { fixedPlanDate } from "../../test/helpers/fixtures/plan.ts";
import { settle } from "../../test/helpers/process.ts";

const FIXED = fixedPlanDate(); // 2026-10-08 15:30 local

/**
 * One agent directory for this file. Plans live outside the project now, so
 * every test that writes one must not reach the machine's real agent dir.
 */
const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-agent-"));
let scoped: { restore: () => void } | undefined;
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

/** The store one repository's plans land in: the agent dir, keyed by its common git dir. */
function storeDir(root: string): string {
	return join(AGENT, "plans", repoKeyOf(join(root, ".git")));
}

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
			if (command !== "git" || args[0] !== "rev-parse") return { stdout: "", stderr: "", code: 1 };
			const out = args.includes("--git-common-dir") ? join(root, ".git") : root;
			return { stdout: `${out}\n`, stderr: "", code: 0 };
		},
	}).pi;
}

/** A fake pi outside any repository. */
function noRepoPi() {
	return createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 128 }) }).pi;
}

/** A store in a fresh repository rooted at `root`. */
function repoStore(root: string) {
	return createPlanStore(repoPi(root), { now: () => FIXED });
}

/** A fake pi whose `git rev-parse` answers for the directory it is asked about. */
function worktreePi(main: string, worktree: string) {
	return createFakePi({
		exec: async (command: string, args: string[], options?: { cwd?: string }) => {
			if (command !== "git" || args[0] !== "rev-parse") return { stdout: "", stderr: "", code: 1 };
			// The common dir is shared by both checkouts, exactly as git reports it.
			if (args.includes("--git-common-dir")) return { stdout: `${join(main, ".git")}\n`, stderr: "", code: 0 };
			return { stdout: `${options?.cwd === worktree ? worktree : main}\n`, stderr: "", code: 0 };
		},
	}).pi;
}

describe("plan naming", () => {
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

	test("caps the slug length and trims a trailing hyphen", () => {
		const slug = slugify("a".repeat(100));
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith("-")).toBe(false);
	});

	test("stamps a local YYYY-MM-DD-HHmm", () => {
		expect(stamp(FIXED)).toBe("2026-10-08-1530");
	});

	test("derives a human title from a file name", () => {
		expect(planTitle("2026-10-08-1530-add-rate-limiting.md")).toBe("add-rate-limiting");
		expect(planTitle("custom-name.md")).toBe("custom-name");
	});
});

describe("plan store — directory resolution", () => {
	test("files a repository's plans in the agent directory keyed by its common git dir", async () => {
		const root = tempDir();
		expect(await repoStore(root).dirFor(root)).toBe(storeDir(root));
	});

	test("falls back to an unkeyed agent directory outside a repository", async () => {
		const store = createPlanStore(noRepoPi(), { now: () => FIXED });
		expect(await store.dirFor(process.cwd())).toBe(join(AGENT, "plans"));
	});

	test("is the same store from the main checkout and from a worktree", async () => {
		const main = tempDir();
		const worktree = tempDir();
		const store = createPlanStore(worktreePi(main, worktree), { now: () => FIXED });

		expect(await store.dirFor(main)).toBe(storeDir(main));
		await withEnv({ [ENV_ROOT]: worktree }, async () => {
			expect(await store.dirFor(main)).toBe(storeDir(main));
		});
	});

	test("writes from a worktree into the shared store and shows the path from home", async () => {
		const main = tempDir();
		const worktree = tempDir();
		const store = createPlanStore(worktreePi(main, worktree), { now: () => FIXED });

		await withEnv({ [ENV_ROOT]: worktree }, async () => {
			const file = await store.write(main, { title: "Add rate limiting", content: "# Plan\n1. Do it" });
			expect(file.path).toStartWith(storeDir(main));
			expect(existsSync(file.path)).toBe(true);
			expect(file.relativePath).toBe(shortenPath(file.path));
		});
	});

	test("moves a store an older version kept in the checkout, once", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const legacy = join(root, ".pi", "plans");
		mkdirSync(legacy, { recursive: true });
		writeFileSync(join(legacy, "2026-10-01-0900-old.md"), "# Old\n- [ ] one");
		writeFileSync(join(legacy, ".gitignore"), "*\n");

		const dir = await store.dirFor(root);

		expect(store.takeNotice()).toContain("Moved 1 plan");
		expect(existsSync(join(legacy, "2026-10-01-0900-old.md"))).toBe(false);
		expect(existsSync(join(dir, "2026-10-01-0900-old.md"))).toBe(true);
		expect(existsSync(legacy)).toBe(false);
		// The notice is one-shot: nothing repeats it on the next turn.
		expect(store.takeNotice()).toBeUndefined();
	});

	test("suffixes a legacy plan instead of overwriting one already in the store", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const dir = storeDir(root);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "2026-10-01-0900-old.md"), "current");
		const legacy = join(root, ".pi", "plans");
		mkdirSync(legacy, { recursive: true });
		writeFileSync(join(legacy, "2026-10-01-0900-old.md"), "ancient");

		await store.dirFor(root);

		expect(readFileSync(join(dir, "2026-10-01-0900-old.md"), "utf-8")).toBe("current");
		expect(readFileSync(join(dir, "2026-10-01-0900-old-2.md"), "utf-8")).toBe("ancient");
	});

	test("leaves a legacy directory that still holds something else", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const legacy = join(root, ".pi", "plans");
		mkdirSync(legacy, { recursive: true });
		writeFileSync(join(legacy, "notes.txt"), "mine");

		await store.dirFor(root);

		expect(existsSync(join(legacy, "notes.txt"))).toBe(true);
		expect(store.takeNotice()).toBeUndefined();
	});
});

describe("plan store — write", () => {
	test("names the file by timestamp and slug in the keyed store", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Add rate limiting", content: "# Plan\n1. Do it" });

		expect(file.path).toBe(join(storeDir(root), "2026-10-08-1530-add-rate-limiting.md"));
		expect(readFileSync(file.path, "utf-8")).toContain("1. Do it");
		expect(file.relativePath).toBe(shortenPath(file.path));
		expect(file.bytes).toBeGreaterThan(0);
	});

	test("writes nothing into the checkout, not even an ignore file", async () => {
		const root = tempDir();
		await repoStore(root).write(root, { title: "Kept", content: "body" });

		expect(readdirSync(root)).toEqual([]);
	});

	test("suffixes a colliding name instead of overwriting", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const first = await store.write(root, { title: "Same", content: "one" });
		const second = await store.write(root, { title: "Same", content: "two" });
		expect(second.path).not.toBe(first.path);
		expect(second.path).toContain("-same-2.md");
		expect(readFileSync(first.path, "utf-8")).toBe("one");
	});

	test("overwrites an existing in-directory plan when plan_path is given", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const first = await store.write(root, { title: "First", content: "one" });
		const refined = await store.write(root, { title: "First", content: "two", planPath: first.path });
		expect(refined.path).toBe(first.path);
		expect(readFileSync(first.path, "utf-8")).toBe("two");
	});

	test("rejects a plan_path outside the plans directory", async () => {
		const root = tempDir();
		const store = repoStore(root);
		await expect(store.write(root, { title: "x", content: "x", planPath: join(root, "escape.md") })).rejects.toThrow(
			/inside the plans directory/,
		);
	});

	test("rejects an oversized plan and an empty title", async () => {
		const root = tempDir();
		const store = repoStore(root);
		await expect(store.write(root, { title: "big", content: "x".repeat(MAX_PLAN_BYTES + 1) })).rejects.toThrow(
			/too large/,
		);
		await expect(store.write(root, { title: "   ", content: "x" })).rejects.toThrow(/title is required/);
	});
});

describe("plan store — read", () => {
	test("reads a written plan back", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Round trip", content: "# Hello" });
		const read = await store.read(root, file.path);
		expect(read?.content).toBe("# Hello");
	});

	test("returns undefined for a missing or outside path", async () => {
		const root = tempDir();
		const store = repoStore(root);
		expect(await store.read(root, join(root, "nope.md"))).toBeUndefined();
		expect(await store.read(root, join(root, "..", "escape.md"))).toBeUndefined();
		writeFileSync(join(root, "outside.md"), "secret");
		expect(await store.read(root, join(root, "outside.md"))).toBeUndefined();
	});

	test("accepts a path relative to the store, and the ~/ form it displays", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Relative", content: "body" });
		expect(existsSync(file.path)).toBe(true);
		expect((await store.read(root, basename(file.path)))?.content).toBe("body");
		expect((await store.read(root, file.relativePath))?.content).toBe("body");
	});
});

describe("plan store — latest", () => {
	test("returns the newest plan by modification time", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const older = await store.write(root, { title: "Older", content: "old" });
		const newer = await store.write(root, { title: "Newer", content: "new" });
		utimesSync(older.path, 1_700_000_000, 1_700_000_000);
		utimesSync(newer.path, 1_700_000_100, 1_700_000_100);

		expect((await store.latest(root))?.path).toBe(newer.path);
		expect((await store.latest(root))?.content).toBe("new");
	});

	test("breaks a modification-time tie by file name, newest stamp first", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		const older = join(dir, "2026-10-01-0900-older.md");
		const newer = join(dir, "2026-10-02-0900-newer.md");
		for (const path of [older, newer]) {
			writeFileSync(path, `# ${basename(path)}`);
			utimesSync(path, 1_700_000_000, 1_700_000_000);
		}

		expect((await store.latest(root))?.path).toBe(newer);
	});

	test("ignores the plans directory's own files", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Kept", content: "body" });
		const dir = await store.dirFor(root);
		const notes = join(dir, "notes.txt");
		writeFileSync(notes, "not a plan");
		utimesSync(notes, 2_000_000_000, 2_000_000_000);

		expect((await store.latest(root))?.path).toBe(file.path);
	});

	test("returns undefined before any plan is written", async () => {
		const root = tempDir();
		expect(await repoStore(root).latest(root)).toBeUndefined();
	});

	symlinkTest("skips a symlinked plan", async () => {
		const root = tempDir();
		const store = repoStore(root);
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

describe("plan store — index", () => {
	/** Write a plan file directly, so the test controls the name and mtime. */
	function seed(root: string, name: string, content: string, mtimeSeconds: number, dir = storeDir(root)): string {
		mkdirSync(dir, { recursive: true });
		const path = join(dir, name);
		writeFileSync(path, content);
		utimesSync(path, mtimeSeconds, mtimeSeconds);
		return path;
	}

	test("lists plans newest first with their title, steps, and bytes", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const old = seed(root, "2026-10-01-0900-old.md", "# Old plan\n\n## Steps\n- [x] one\n- [ ] two", 1_700_000_000);
		const fresh = seed(root, "2026-10-02-0900-fresh.md", "# Fresh plan\n\n## Steps\n- [x] only", 1_700_000_500);

		const rows = await store.index(root);

		expect(rows.map((row) => row.path)).toEqual([fresh, old]);
		expect(rows[0]).toMatchObject({ title: "Fresh plan", steps: { done: 1, total: 1 } });
		expect(rows[1]).toMatchObject({ title: "Old plan", steps: { done: 1, total: 2 } });
		expect(rows[0]?.relativePath).toBe(shortenPath(rows[0]?.path ?? ""));
		expect(rows[0]?.bytes).toBeGreaterThan(0);
		expect(rows[0]?.modified).toBeCloseTo(1_700_000_500_000, -3);
	});

	test("falls back to the file-name slug when a plan has no heading", async () => {
		const root = tempDir();
		const store = repoStore(root);
		seed(root, "2026-10-01-0900-slugged-title.md", "- one\n- two", 1_700_000_000);

		const [row] = await store.index(root);

		expect(row?.title).toBe("slugged-title");
		expect(row?.steps).toEqual({ done: 0, total: 2 });
	});

	test("lists an over-limit file without reading it", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const big = "# Huge\n" + "x".repeat(MAX_PLAN_BYTES);
		seed(root, "2026-10-01-0900-huge.md", big, 1_700_000_000);

		const [row] = await store.index(root);

		expect(row).toMatchObject({ title: "huge", oversize: true, bytes: big.length });
		expect(row?.steps).toBeUndefined();
	});

	test("skips the directory's own files, other extensions, and directories", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const kept = seed(root, "2026-10-01-0900-kept.md", "# Kept", 1_700_000_000);
		const dir = storeDir(root);
		writeFileSync(join(dir, ".nearby"), "state");
		writeFileSync(join(dir, "notes.txt"), "not a plan");
		mkdirSync(join(dir, "sub.md"));

		expect((await store.index(root)).map((row) => row.path)).toEqual([kept]);
	});

	symlinkTest("skips a symlinked plan", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const kept = seed(root, "2026-10-01-0900-kept.md", "# Kept", 1_700_000_000);
		const dir = storeDir(root);
		const outside = join(root, "outside.md");
		writeFileSync(outside, "# Outside");
		symlinkSync(outside, join(dir, "link.md"));

		expect((await store.index(root)).map((row) => row.path)).toEqual([kept]);
	});

	test("indexes the repository's one store from either checkout", async () => {
		const main = tempDir();
		const worktree = tempDir();
		seed(main, "2026-10-01-0900-main.md", "# Main checkout plan", 1_700_000_000);
		const own = seed(worktree, "2026-10-02-0900-worktree.md", "# Worktree plan", 1_700_000_500, storeDir(main));
		// Both checkouts share one key, so a plan written in either is a plan in both.
		const store = createPlanStore(worktreePi(main, worktree), { now: () => FIXED });

		const rows = await store.index(worktree);

		expect(rows.map((row) => row.path)).toEqual([own, join(storeDir(main), "2026-10-01-0900-main.md")]);
		expect(rows[0]?.title).toBe("Worktree plan");
	});

	test("lists nothing before any plan is written", async () => {
		const root = tempDir();
		expect(await repoStore(root).index(root)).toEqual([]);
	});
});

describe("plan store — atomic writes", () => {
	test("rewrites a plan in place without leaving a temp file", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Refine", content: "v1" });

		await store.write(root, { title: "Refine", content: "v2", planPath: file.path });

		const dir = await store.dirFor(root);
		expect(readFileSync(file.path, "utf-8")).toBe("v2");
		expect(readdirSync(dir).sort()).toEqual([basename(file.path)]);
	});

	test("a step edit leaves no temp file either", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "- One" });

		await store.setSteps(root, file.path, [{ step: 1, status: "completed", expected: "One" }]);

		const dir = await store.dirFor(root);
		expect(readdirSync(dir).sort()).toEqual([basename(file.path)]);
	});
});

describe("plan store — containment", () => {
	test("refuses to overwrite a dotfile or a non-markdown file beside the plans", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, ".state"), "keep");
		writeFileSync(join(dir, "notes.txt"), "keep");

		await expect(store.write(root, { title: "x", content: "x", planPath: join(dir, ".state") })).rejects.toThrow(
			/markdown plan file/,
		);
		await expect(store.write(root, { title: "x", content: "x", planPath: join(dir, "notes.txt") })).rejects.toThrow(
			/markdown plan file/,
		);

		expect(readFileSync(join(dir, ".state"), "utf-8")).toBe("keep");
		expect(readFileSync(join(dir, "notes.txt"), "utf-8")).toBe("keep");
	});

	symlinkTest("refuses a symlink that points outside the plans directory", async () => {
		const root = tempDir();
		const store = repoStore(root);
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
		const store = repoStore(root);
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
		const store = repoStore(root);
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		const outside = mkdtempSync(join(tmpdir(), "pi-plan-outside-"));
		symlinkSync(outside, join(dir, "sub"));

		await expect(
			store.write(root, { title: "x", content: "pwn", planPath: join(dir, "sub", "escape.md") }),
		).rejects.toThrow(/markdown plan file/);
	});
});

describe("plan store — setSteps", () => {
	test("refuses a stale expected text and writes nothing", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "## Steps\n- [ ] One\n- [ ] Two" });

		await expect(
			store.setSteps(root, file.path, [{ step: 2, status: "completed", expected: "Wire it" }]),
		).rejects.toThrow('Step 2 is no longer "Wire it"; the file now has "Two"');
		expect(readFileSync(file.path, "utf-8")).toBe("## Steps\n- [ ] One\n- [ ] Two");
	});

	test("accepts an expected text that matches after normalization", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "1. Add the cache\n2. Wire it" });

		const updated = await store.setSteps(root, file.path, [
			{ step: 1, status: "completed", expected: " add   the CACHE " },
		]);
		expect(updated.content).toBe("1. [x] Add the cache\n2. Wire it");
	});

	test("ticks off a step and returns the rewritten plan", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "1. One\n2. Two" });

		const updated = await store.setSteps(root, file.path, [{ step: 2, status: "completed", expected: "Two" }]);
		expect(updated.content).toBe("1. One\n2. [x] Two");
		expect(readFileSync(file.path, "utf-8")).toBe("1. One\n2. [x] Two");
	});

	test("applies a batch in one write", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "1. One\n2. Two\n3. Three" });

		const updated = await store.setSteps(root, file.path, [
			{ step: 1, status: "completed", expected: "One" },
			{ step: 3, status: "completed", expected: "Three" },
		]);
		expect(updated.content).toBe("1. [x] One\n2. Two\n3. [x] Three");
	});

	test("rejects an out-of-range step without touching the file", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "- One" });

		await expect(
			store.setSteps(root, file.path, [
				{ step: 1, status: "completed", expected: "One" },
				{ step: 3, status: "completed", expected: "Three" },
			]),
		).rejects.toThrow(/out of range/);
		expect(readFileSync(file.path, "utf-8")).toBe("- One");
	});

	test("names the valid range, or that the plan has no steps", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Steps", content: "Just prose." });

		await expect(store.setSteps(root, file.path, [{ step: 1, status: "completed", expected: "One" }])).rejects.toThrow(
			/it has no steps/,
		);
	});

	test("rejects a missing or outside plan", async () => {
		const root = tempDir();
		const store = repoStore(root);
		writeFileSync(join(root, "outside.md"), "- One");

		await expect(
			store.setSteps(root, join(root, ".pi", "plans", "nope.md"), [{ step: 1, status: "completed", expected: "One" }]),
		).rejects.toThrow(/No plan file/);
		await expect(
			store.setSteps(root, join(root, "outside.md"), [{ step: 1, status: "completed", expected: "One" }]),
		).rejects.toThrow(/No plan file/);
	});
});

describe("plan store — saveFeedback", () => {
	test("writes feedback into the plan and returns the updated content", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Review", content: "# Plan\n- [ ] step" });

		const updated = await store.saveFeedback(root, file.path, [{ anchor: 2, comment: "too vague" }]);
		expect(updated.content).toBe("# Plan\n- [ ] step\n> [!REVIEW] too vague");
		expect(readFileSync(file.path, "utf-8")).toBe(updated.content);
	});

	test("replaces earlier feedback instead of accumulating", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Review", content: "- [ ] step" });

		await store.saveFeedback(root, file.path, [{ anchor: 0, comment: "first" }]);
		const updated = await store.saveFeedback(root, file.path, [{ anchor: 0, comment: "second" }]);
		expect(updated.content).toBe("- [ ] step\n> [!REVIEW] second");
	});

	test("rejects a missing or outside plan", async () => {
		const root = tempDir();
		const store = repoStore(root);
		writeFileSync(join(root, "outside.md"), "- One");

		await expect(store.saveFeedback(root, join(root, ".pi", "plans", "nope.md"), [])).rejects.toThrow(/No plan file/);
		await expect(store.saveFeedback(root, join(root, "outside.md"), [])).rejects.toThrow(/No plan file/);
	});
});

describe("plan store — authored review comments", () => {
	/** A repo store with one plan holding two steps. */
	async function seeded(): Promise<{ root: string; store: ReturnType<typeof repoStore>; path: string }> {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Review", content: "# Plan\n- [ ] one\n- [ ] two" });
		return { root, store, path: file.path };
	}

	test("a save writes one writer's comments and keeps the other writer's", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 2, comment: "bob's" }], { author: "bob" });
		expect(updated.content).toBe("# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n- [ ] two\n> [!REVIEW] @bob: bob's");
	});

	test("the owner's save keeps every reviewer's comment", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		await store.saveFeedback(root, path, [{ anchor: 2, comment: "bob's" }], { author: "bob" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 1, comment: "owner's" }]);
		expect(updated.content).toBe(
			"# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n> [!REVIEW] owner's\n- [ ] two\n> [!REVIEW] @bob: bob's",
		);
	});

	test("a save cannot re-sign another writer's comment", async () => {
		const { root, store, path } = await seeded();
		const updated = await store.saveFeedback(
			root,
			path,
			[
				{ anchor: 1, comment: "pretending", author: "alice" },
				{ anchor: 2, comment: "mine" },
			],
			{ author: "bob" },
		);
		expect(updated.content).toBe("# Plan\n- [ ] one\n- [ ] two\n> [!REVIEW] @bob: mine");
	});

	test("a reviewer's own save replaces their earlier comments", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "first" }], { author: "alice" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 2, comment: "second" }], { author: "alice" });
		expect(updated.content).toBe("# Plan\n- [ ] one\n- [ ] two\n> [!REVIEW] @alice: second");
	});

	test("refuses a missing or outside plan", async () => {
		const { root, store } = await seeded();
		writeFileSync(join(root, "outside.md"), "- One");
		await expect(
			store.saveFeedback(root, join(root, ".pi", "plans", "nope.md"), [], { author: "alice" }),
		).rejects.toThrow(/No plan file/);
		await expect(store.saveFeedback(root, join(root, "outside.md"), [], { author: "alice" })).rejects.toThrow(
			/No plan file/,
		);
	});

	test("a refinement carries the review onto the rewritten plan", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		const rewritten = await store.write(root, {
			title: "Review",
			planPath: path,
			content: "# Plan\n- [ ] one\n- [ ] two\n- [ ] three",
		});
		expect(rewritten.content).toBe("# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n- [ ] two\n- [ ] three");
		expect(readFileSync(path, "utf-8")).toBe(rewritten.content);
	});

	test("a refinement keeps a carried comment on a block the page renders", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 2, comment: "about two" }]);
		// The step the comment hung on is gone; the section it lived in is not.
		await store.write(root, { title: "Review", planPath: path, content: "# Plan\n- [ ] one\n\n## Notes\nGreen.\n" });

		const stored = readFileSync(path, "utf-8");
		expect(stored).toContain("- [ ] one\n> [!REVIEW] about two\n");
		const starts = planBlocks(stripFeedback(stored))
			.filter((block) => block.kind !== "blank")
			.map((block) => block.start);
		const annotations = parseFeedback(stored);
		expect(annotations.length).toBe(1);
		for (const annotation of annotations) expect(starts).toContain(annotation.anchor);
	});

	test("a new plan never inherits markers from the content it is given", async () => {
		const root = tempDir();
		const store = repoStore(root);
		const file = await store.write(root, { title: "Fresh", content: "- [ ] one\n> [!REVIEW] stray" });
		expect(file.content).toBe("- [ ] one");
	});
});

describe("step extraction", () => {
	const pending = (content: string) => ({ content, status: "pending" as const });
	const completed = (content: string) => ({ content, status: "completed" as const });

	test("reads a numbered plan", () => {
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			pending("Read the parser"),
			pending("Add a tokenizer"),
			pending("Update tests"),
		]);
	});

	test("reads `1)` numbering and bullet lists", () => {
		expect(extractPlanSteps("1) First\n2) Second")).toEqual([pending("First"), pending("Second")]);
		expect(extractPlanSteps("- Alpha\n* Beta\n+ Gamma")).toEqual([pending("Alpha"), pending("Beta"), pending("Gamma")]);
	});

	test("strips emphasis, code, and done markers", () => {
		const plan = "1. **Bold** step with `code` [DONE:1]\n2. _Italic_ one";
		expect(extractPlanSteps(plan)).toEqual([completed("Bold step with code"), pending("Italic one")]);
	});

	test("keeps underscores inside identifiers", () => {
		const plan = "1. Rename user_id to account_id\n2. Read snake_case_file.ts";
		expect(extractPlanSteps(plan)).toEqual([
			pending("Rename user_id to account_id"),
			pending("Read snake_case_file.ts"),
		]);
	});

	test("turns checkboxes into status", () => {
		const plan = ["- [ ] First task", "- [x] Done task", "- [X] Also done"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("First task"), completed("Done task"), completed("Also done")]);
	});

	test("skips nested sub-bullets but keeps a uniformly indented plan", () => {
		const nested = ["1. Add the lexer", "   - nested note", "   - another note", "2. Update tests"].join("\n");
		expect(extractPlanSteps(nested)).toEqual([pending("Add the lexer"), pending("Update tests")]);
		expect(extractPlanSteps("  - One\n  - Two")).toEqual([pending("One"), pending("Two")]);
	});

	test("ignores list items inside fenced code blocks", () => {
		const plan = [
			"Plan:",
			"```yaml",
			"- name: foo",
			"  1. nested example",
			"```",
			"1. Real step one",
			"2. Real step two",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Real step one"), pending("Real step two")]);
	});

	test("ignores tilde fences and hides the rest after an unclosed fence", () => {
		expect(extractPlanSteps(["~~~", "- not a step", "~~~", "- Real step"].join("\n"))).toEqual([pending("Real step")]);
		expect(extractPlanSteps(["1. Before fence", "```", "- inside"].join("\n"))).toEqual([pending("Before fence")]);
	});

	test("uses the shallowest list as the top level regardless of order", () => {
		const plan = ["  - nested first", "- top level", "  - another nested", "- second top"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("top level"), pending("second top")]);
	});

	test("skips prose, blank lines, and de-duplicates steps", () => {
		expect(extractPlanSteps(["Here is the plan.", "", "1. Only real step", "Done."].join("\n"))).toEqual([
			pending("Only real step"),
		]);
		expect(extractPlanSteps("1. Same\n2. same\n3. Other")).toEqual([pending("Same"), pending("Other")]);
	});

	test("joins indented continuation lines to their step", () => {
		const plan = [
			"- [ ] Replace the body of the file, keeping the",
			"  opening notice and the commit rule",
			"- [ ] Read it back and re-check it against the",
			"  checklist",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			pending("Replace the body of the file, keeping the opening notice and the commit rule"),
			pending("Read it back and re-check it against the checklist"),
		]);
	});

	test("ends a step at a nested marker, a blank line, or a shallow line", () => {
		const nested = ["- [ ] Add the lexer", "  handles tokens", "  - nested note", "- [ ] Update tests"].join("\n");
		expect(extractPlanSteps(nested)).toEqual([pending("Add the lexer handles tokens"), pending("Update tests")]);

		const blank = ["- [ ] First step", "  continued", "", "  prose after a blank line", "- [ ] Second"].join("\n");
		expect(extractPlanSteps(blank)).toEqual([pending("First step continued"), pending("Second")]);

		const shallow = ["- [ ] Only real step", "  continued", "Done."].join("\n");
		expect(extractPlanSteps(shallow)).toEqual([pending("Only real step continued")]);
	});

	test("elides very long steps and caps the list", () => {
		const [step] = extractPlanSteps(`1. ${"x".repeat(MAX_STEP_LENGTH + 50)}`);
		expect(step.content.length).toBe(MAX_STEP_LENGTH);
		expect(step.content.endsWith("…")).toBe(true);

		const plan = Array.from({ length: MAX_STEPS + 10 }, (_, i) => `${i + 1}. step ${i}`).join("\n");
		expect(extractPlanSteps(plan)).toHaveLength(MAX_STEPS);
	});

	test("returns nothing for a plan without steps", () => {
		expect(extractPlanSteps("Just some prose.")).toEqual([]);
		expect(extractPlanSteps("")).toEqual([]);
	});
});

describe("step extraction — the Steps section", () => {
	const pending = (content: string) => ({ content, status: "pending" as const });

	test("reads only the Steps section when the plan has one", () => {
		const plan = [
			"# Plan",
			"## Context",
			"- the repo is large",
			"- prior art exists",
			"## Approach",
			"- use a cache",
			"## Steps",
			"- [ ] Add the cache",
			"- [ ] Wire it",
			"## Risks",
			"- stale reads",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the cache"), pending("Wire it")]);
	});

	test("keeps nested notes inside the section but not as steps", () => {
		const plan = [
			"## Steps",
			"1. Add the cache",
			"   - a nested note",
			"### Check the cache",
			"2. Wire it",
			"## Risks",
			"- stale reads",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the cache"), pending("Wire it")]);
	});

	test("an empty Steps section means no steps", () => {
		expect(extractPlanSteps(["## Steps", "", "## Risks", "- stale reads"].join("\n"))).toEqual([]);
	});

	test("ignores a Steps heading inside a fence", () => {
		const plan = ["```md", "## Steps", "- not a step", "```", "- Real step"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Real step")]);
	});

	test("falls back to the whole plan without a Steps heading", () => {
		const plan = ["## Goal", "- first", "## Approach", "- second"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("first"), pending("second")]);
	});

	test("matches the heading case-insensitively and through emphasis", () => {
		const plan = ["## **STEPS**", "- One", "## Risks", "- two"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("One")]);
	});

	test("setStepStatuses edits the section-scoped steps", () => {
		const plan = ["## Context", "- prose", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");
		expect(setStepStatuses(plan, [{ step: 1, status: "completed" }])).toBe(
			["## Context", "- prose", "## Steps", "- [x] One", "- [ ] Two"].join("\n"),
		);
	});
});

describe("step summary and text match", () => {
	test("counts past the cap and counts steps whose text will be shortened", () => {
		const plan = Array.from({ length: MAX_STEPS + 3 }, (_, index) => `${index + 1}. step ${index}`).join("\n");
		expect(planStepSummary(plan)).toEqual({ total: MAX_STEPS + 3, elided: 0 });
		expect(planStepSummary(`1. ${"x".repeat(MAX_STEP_LENGTH + 1)}\n2. Short`)).toEqual({ total: 2, elided: 1 });
	});

	test("scopes the count to the Steps section", () => {
		const plan = ["## Context", "- prose", "## Steps", "- One", "- Two"].join("\n");
		expect(planStepSummary(plan)).toEqual({ total: 2, elided: 0 });
	});

	test("matches step text ignoring case, surrounding space, and collapsed whitespace", () => {
		expect(matchesStepText("Add  the cache", " add the CACHE ")).toBe(true);
		expect(matchesStepText("Add the cache", "Wire it")).toBe(false);
	});
});

describe("plan outline", () => {
	test("documents the sections in order and a checkbox step", () => {
		const headings = PLAN_OUTLINE.split("\n")
			.filter((line) => line.startsWith("## "))
			.map((line) => line.slice(3).trim());
		expect(headings).toEqual([...PLAN_SECTIONS]);
		expect(PLAN_OUTLINE.startsWith("# <Title>")).toBe(true);
		expect(PLAN_OUTLINE.split("## Steps")[1].split("\n## ")[0]).toContain("- [ ] ");
	});

	test("shows the surface before and after under Visual, before the steps", () => {
		const visual = PLAN_OUTLINE.split("## Visual")[1].split("\n## ")[0];
		// Two frames, both untagged: a transcript carries its output, so it is not code.
		expect(visual.match(/^```/gm)?.length).toBe(4);
		expect(visual).not.toContain("```bash");
		// The caption names what to look at, and that the two frames are a comparison.
		const caption = visual.split("\n").filter((line) => line.trim() !== "")[0];
		expect(caption).toContain("startup");
		expect(caption).toContain("before and after");
		expect(PLAN_OUTLINE.indexOf("## Visual")).toBeGreaterThan(PLAN_OUTLINE.indexOf("## Approach"));
		expect(PLAN_OUTLINE.indexOf("## Visual")).toBeLessThan(PLAN_OUTLINE.indexOf("## Steps"));
	});

	test("asks for a one-sentence goal and commands to verify", () => {
		expect(PLAN_OUTLINE).toContain("One sentence: the outcome this change delivers");
		expect(PLAN_OUTLINE.split("## Verification")[1]).toContain("```bash");
	});

	test("is itself a valid plan", () => {
		// The template is what a model copies, so the example document has to parse:
		// eight sections in order, two tracked steps, and one verification item.
		expect(extractPlanSections(PLAN_OUTLINE).map((section) => section.title)).toEqual(["<Title>", ...PLAN_SECTIONS]);
		expect(planStepSummary(PLAN_OUTLINE)).toEqual({ total: 2, elided: 0 });
		expect(verificationItem(PLAN_OUTLINE)?.content).toBe("Verify: bun test src/config.test.ts; bun run check");
	});
});

describe("plan sections", () => {
	test("splits a canonical plan at its headings", () => {
		const plan = ["# Title", "", "## Goal", "Ship it.", "", "## Steps", "- [ ] One"].join("\n");
		expect(extractPlanSections(plan).map((s) => s.title)).toEqual(["Title", "Goal", "Steps"]);
		expect(extractPlanSections(plan)[1].text.split("\n")[0]).toBe("## Goal");
		expect(extractPlanSections(plan)[1].text).toContain("Ship it.");
	});

	test("keeps content before the first heading as an untitled section", () => {
		const plan = ["intro line", "", "## Goal", "x"].join("\n");
		const sections = extractPlanSections(plan);
		expect(sections[0].title).toBe("");
		expect(sections[0].text).toContain("intro line");
	});

	test("drops a blank preamble and strips inline formatting from titles", () => {
		expect(extractPlanSections("\n\n## **Goal** `x`")[0].title).toBe("Goal x");
	});

	test("ignores `#` lines inside code fences", () => {
		const plan = ["## Real", "```sh", "# not a heading", "```", "## Also real"].join("\n");
		expect(extractPlanSections(plan).map((s) => s.title)).toEqual(["Real", "Also real"]);
	});

	test("reads a tab-indented fence as prose, the same as the block parser", () => {
		// The fence rule is shared with `blocks.ts`, whose rule is spaces-only: a
		// tab-indented fence must not be code for one parser and prose for the other.
		const plan = ["\t```", "## Inside", "\t```", "## After"].join("\n");
		expect(extractPlanSections(plan).map((s) => s.title)).toEqual(["", "Inside", "After"]);
	});

	test("returns nothing for an empty plan", () => {
		expect(extractPlanSections("")).toEqual([]);
		expect(extractPlanSections("\n\n")).toEqual([]);
	});

	test("reports each heading's source line and level", () => {
		const plan = ["# Title", "", "## **Goal**", "", "### `Code` step"].join("\n");
		expect(extractPlanSections(plan).map((s) => ({ line: s.line, level: s.level, title: s.title }))).toEqual([
			{ line: 0, level: 1, title: "Title" },
			{ line: 2, level: 2, title: "Goal" },
			{ line: 4, level: 3, title: "Code step" },
		]);
	});

	test("keeps a heading's own trailing hash, not a closing run", () => {
		expect(extractPlanSections("## C#\nx")[0].title).toBe("C#");
		expect(extractPlanSections("## Notes ##\nx")[0].title).toBe("Notes");
	});
});

describe("step status edits", () => {
	const pending = (content: string) => ({ content, status: "pending" as const });

	test("marks a numbered step done and leaves its text alone", () => {
		const plan = ["1. Read the parser", "2. Add a tokenizer"].join("\n");
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe(
			"1. Read the parser\n2. [x] Add a tokenizer",
		);
	});

	test("adds a checkbox to a plain list item and returns it to pending", () => {
		expect(setStepStatuses("- Do the thing", [{ step: 1, status: "completed" }])).toBe("- [x] Do the thing");
		expect(setStepStatuses("- [x] Done", [{ step: 1, status: "pending" }])).toBe("- [ ] Done");
	});

	test("applies several steps in one pass", () => {
		const plan = ["1. One", "2. Two", "3. Three"].join("\n");
		const result = setStepStatuses(plan, [
			{ step: 1, status: "completed" },
			{ step: 3, status: "completed" },
		]);
		expect(result).toBe("1. [x] One\n2. Two\n3. [x] Three");
	});

	test("reopening drops a DONE marker; completing keeps it", () => {
		const reopened = setStepStatuses("- First [DONE:1]\n- Second", [{ step: 1, status: "pending" }]);
		expect(reopened).toBe("- [ ] First\n- Second");
		expect(extractPlanSteps(reopened as string)).toEqual([pending("First"), pending("Second")]);
		expect(setStepStatuses("- First [DONE:1]", [{ step: 1, status: "completed" }])).toBe("- [x] First [DONE:1]");
	});

	test("a duplicate step takes the last entry", () => {
		const result = setStepStatuses("- One", [
			{ step: 1, status: "completed" },
			{ step: 1, status: "pending" },
		]);
		expect(result).toBe("- [ ] One");
	});

	test("aligns its numbering with extractPlanSteps", () => {
		const plan = ["1. Same", "2. same", "3. Other"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Same"), pending("Other")]);
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe("1. Same\n2. same\n3. [x] Other");
	});

	test("keeps a wrapped step's continuation when the checkbox changes", () => {
		const plan = ["- [ ] First step", "  continues here", "- [ ] Second"].join("\n");
		expect(setStepStatuses(plan, [{ step: 1, status: "completed" }])).toBe(
			["- [x] First step", "  continues here", "- [ ] Second"].join("\n"),
		);
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe(
			["- [ ] First step", "  continues here", "- [x] Second"].join("\n"),
		);
	});

	test("ignores steps inside fences", () => {
		const result = setStepStatuses(["```", "- nope", "```", "- Real"].join("\n"), [{ step: 1, status: "completed" }]);
		expect(result).toContain("- [x] Real");
		expect(result).toContain("- nope");
	});

	test("changes nothing when any step is out of range or non-integer", () => {
		expect(setStepStatuses("- One", [{ step: 0, status: "completed" }])).toBeUndefined();
		expect(setStepStatuses("- One", [{ step: 2, status: "completed" }])).toBeUndefined();
		expect(setStepStatuses("- One", [{ step: 1.5, status: "completed" }])).toBeUndefined();
		expect(
			setStepStatuses("- One\n- Two", [
				{ step: 1, status: "completed" },
				{ step: 9, status: "completed" },
			]),
		).toBeUndefined();
	});
});

describe("plan verification item", () => {
	const plan = (verification: string): string =>
		["# Plan", "", "## Steps", "- [ ] One", "", "## Verification", verification].join("\n");

	test("collapses the section into one trailing item", () => {
		expect(verificationItem(plan("- `bun run check` passes\n- approve and merge"))).toEqual({
			content: "Verify: bun run check passes; approve and merge",
			status: "pending",
		});
	});

	test("finds the heading whatever its case or emphasis", () => {
		const source = ["# Plan", "## Steps", "- [ ] One", "## **VERIFICATION**", "Run the suite"].join("\n");
		expect(verificationItem(source)?.content).toBe("Verify: Run the suite");
	});

	test("strips checkboxes and numbered markers", () => {
		expect(verificationItem(plan("1. [ ] first check\n2. second check"))?.content).toBe(
			"Verify: first check; second check",
		);
	});

	test("carries a fenced block's commands without its fence", () => {
		// The outline asks for the commands in a fence, so the fence lines are
		// punctuation: the tracked item is the commands, joined.
		expect(verificationItem(plan("```bash\nbun test\nbun run check\n```"))?.content).toBe(
			"Verify: bun test; bun run check",
		);
	});

	test("drops a fence line even without a closing fence", () => {
		// A trailing fence is still a fence line, so the rule is one rule: the
		// command lines inside the section are what the item carries.
		expect(verificationItem(plan("run the suite\n```sh\nbun test"))?.content).toBe("Verify: run the suite; bun test");
	});

	test("ignores a verification heading inside a fence", () => {
		expect(
			verificationItem(["# Plan", "```md", "## Verification", "- not a section", "```"].join("\n")),
		).toBeUndefined();
	});

	test("returns undefined without the section, or with an empty one", () => {
		expect(verificationItem("# Plan\n\n## Steps\n- [ ] One")).toBeUndefined();
		expect(verificationItem(plan("   "))).toBeUndefined();
	});

	test("elides a long section like a long step", () => {
		const item = verificationItem(plan("- " + "x".repeat(400)));
		expect(item?.content.length).toBe(MAX_STEP_LENGTH);
		expect(item?.content.endsWith("…")).toBe(true);
	});

	test("uses the first of two verification headings", () => {
		const source = ["# Plan", "## Steps", "- [ ] One", "## Verification", "first", "## Verification", "second"].join(
			"\n",
		);
		expect(verificationItem(source)?.content).toBe("Verify: first");
	});

	test("returns undefined for a plan with no Steps heading, whose list is the plan", () => {
		expect(verificationItem(["# Plan", "## Verification", "- run the suite"].join("\n"))).toBeUndefined();
	});
});

describe("plan goal section", () => {
	test("reads the first paragraph of the Goal section", () => {
		const source = [
			"# Plan",
			"",
			"## Goal",
			"Protect the public API",
			"without breaking existing clients.",
			"",
			"## Steps",
			"- [ ] One",
		].join("\n");
		expect(goalSection(source)).toBe("Protect the public API without breaking existing clients.");
	});

	test("strips a list marker and inline markdown", () => {
		expect(goalSection("## Goal\n- **Ship** the `parser`\n")).toBe("Ship the parser");
	});

	test("skips leading blank lines and reports an empty section as undefined", () => {
		expect(goalSection("## Goal\n\n  ship it\n")).toBe("ship it");
		expect(goalSection("## Goal\n\n## Steps\n- [ ] One")).toBeUndefined();
	});

	test("ignores a Goal heading inside a code fence", () => {
		expect(goalSection("```md\n## Goal\nnot this\n```\n")).toBeUndefined();
	});

	test("is undefined without the section, and for a deeper heading", () => {
		expect(goalSection("# Plan\n\n## Context\nx")).toBeUndefined();
		expect(goalSection("### Goal\nnot the outline's section")).toBeUndefined();
	});
});

describe("plan text — sanitizing and review comparison", () => {
	test("strips control characters but keeps newlines", () => {
		// Each control character becomes a printable space, so a plan cannot drive
		// the terminal; the newlines that split sections are kept.
		const text = sanitizePlanText("hello\u001b[31mred\u001b[0m\u0007\nworld\u009b");
		expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
		expect(text.split("\n")).toEqual(["hello [31mred [0m ", "world "]);
	});

	test("expands a tab to four spaces so the terminal width model holds", () => {
		// Built rather than written out, so the width rule stays the assertion.
		expect(sanitizePlanText("-\tstep")).toBe(`-${" ".repeat(4)}step`);
	});

	test("keeps one digest per heading section, in document order", () => {
		const digests = sectionDigests(["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n"));
		expect(digests.map((section) => section.title)).toEqual(["Plan", "Goal", "Steps"]);
		for (const section of digests) expect(section.digest).toMatch(/^[0-9a-f]{64}$/);
	});

	test("labels a section the way the review screen does", () => {
		expect(sectionDigests(["## **Goal**", "Ship it."].join("\n")).map((section) => section.title)).toEqual(["Goal"]);
	});

	test("digests the plan with its stored review comments removed", () => {
		const plain = ["# Plan", "## Goal", "Ship it."].join("\n");
		const withComment = ["# Plan", "## Goal", "Ship it.", "> [!REVIEW] make it concrete"].join("\n");
		expect(sectionDigests(withComment)).toEqual(sectionDigests(plain));
	});

	test("sameSections reports an identical baseline as unchanged", () => {
		const plan = ["# Plan", "## Goal", "Ship it."].join("\n");
		expect(sameSections(sectionDigests(plan), sectionDigests(plan))).toBe(true);
	});

	test("sameSections reports a changed section, and a different section count", () => {
		const plan = ["# Plan", "## Goal", "Ship it."].join("\n");
		expect(sameSections(sectionDigests(plan), sectionDigests(plan.replace("Ship it.", "Ship it now.")))).toBe(false);
		expect(sameSections(sectionDigests(plan), sectionDigests(`${plan}\n## Risks\n- stale reads`))).toBe(false);
	});
});

describe("plan text — changed sections", () => {
	const before = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");
	/** Just the flags, in document order; the section each one belongs to is pinned below. */
	const flags = (baseline: SectionDigest[] | undefined, current: string): boolean[] =>
		changedSections(baseline, current).map((mark) => mark.changed);

	test("hands each flag back with its own section", () => {
		const marks = changedSections(sectionDigests(before), before.replace("Ship it.", "Ship it well."));
		expect(marks.map((mark) => [mark.section.title, mark.changed])).toEqual([
			["Plan", false],
			["Goal", true],
			["Steps", false],
		]);
	});

	test("returns nothing for an identical plan", () => {
		expect(flags(sectionDigests(before), before)).toEqual([false, false, false]);
	});

	test("marks a section whose text changed", () => {
		expect(flags(sectionDigests(before), before.replace("Ship it.", "Ship it well."))).toEqual([false, true, false]);
	});

	test("marks a new section but not a removed one", () => {
		expect(flags(sectionDigests(before), `${before}\n## Risks\n- stale reads`)).toEqual([false, false, false, true]);
		// The array follows the current plan, so a dropped section only shortens it.
		expect(flags(sectionDigests(before), ["# Plan", "## Goal", "Ship it."].join("\n"))).toEqual([false, false]);
	});

	test("flags a duplicate title by occurrence, not by title", () => {
		const previous = ["## Steps", "- One", "## Steps", "- Two"].join("\n");
		// Only the second occurrence changed, so only it is flagged.
		expect(flags(sectionDigests(previous), ["## Steps", "- One", "## Steps", "- Two more"].join("\n"))).toEqual([
			false,
			true,
		]);
	});

	test("normalizes an emphasized heading", () => {
		expect(flags(sectionDigests(["## **Goal**", "Old"].join("\n")), ["## Goal", "New"].join("\n"))).toEqual([true]);
	});

	test("flags a renamed heading even when its body is unchanged", () => {
		// The baseline is keyed by heading text, which is why write_plan asks a
		// refinement to keep its headings: a rename has no digest to compare against.
		expect(flags(sectionDigests(["## Approach", "Ship it."].join("\n")), ["## Design", "Ship it."].join("\n"))).toEqual(
			[true],
		);
	});

	test("flags nothing on a first review", () => {
		// A plan this branch never showed has no baseline; every section is new, and
		// marking them all would claim the whole plan changed.
		expect(flags(undefined, before)).toEqual([false, false, false]);
	});

	test("a tab and its four spaces are the same content", () => {
		const tabbed = ["## Steps", "- [ ] one", "- [ ] two"].join("\n").replace("- [ ] ", "-\t");
		expect(flags(sectionDigests(tabbed), tabbed.replace(/\t/g, "    "))).toEqual([false]);
	});

	test("a stored review comment is not an edit", () => {
		const plan = ["# Plan", "## Goal", "Ship it."].join("\n");
		const commented = ["# Plan", "## Goal", "Ship it.", "> [!REVIEW] make it concrete"].join("\n");
		expect(flags(sectionDigests(commented), plan)).toEqual([false, false]);
	});
});

describe("plan block model", () => {
	/** `start:end:kind` for each block, so a whole parse is one comparable list. */
	function outline(plan: string): string[] {
		return planBlocks(plan).map((block) => `${block.start}:${block.end}:${block.kind}`);
	}

	test("returns no blocks for an empty string", () => {
		expect(planBlocks("")).toEqual([]);
	});

	test("marks blank lines, headings, and paragraphs", () => {
		expect(outline("a\n\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
		expect(outline("# Title\n\n## Goal\ntext")).toEqual(["0:0:heading", "1:1:blank", "2:2:heading", "3:3:paragraph"]);
		expect(outline("one\ntwo\nthree")).toEqual(["0:2:paragraph"]);
	});

	test("gives each list item its own block and keeps continuations with it", () => {
		expect(outline("- one\n- two\n1. three")).toEqual(["0:0:list", "1:1:list", "2:2:list"]);
		expect(outline("- parent\n  - child\n    continuation")).toEqual(["0:0:list", "1:2:list"]);
		expect(outline("- step\n  a note on the step\nnext paragraph")).toEqual(["0:1:list", "2:2:paragraph"]);
	});

	test("groups consecutive blockquotes and tables", () => {
		expect(outline("> one\n> two\n\n> three")).toEqual(["0:1:quote", "2:2:blank", "3:3:quote"]);
		expect(outline("| risk | fix |\n| --- | --- |\n| slow | cache |\nafter")).toEqual(["0:2:table", "3:3:paragraph"]);
		expect(outline("a | b\n--- | ---\n1 | 2")).toEqual(["0:2:table"]);
	});

	test("does not treat a lone pipe row or a bare rule as a table", () => {
		expect(outline("a | b\ntext")).toEqual(["0:1:paragraph"]);
		expect(outline("---")).toEqual(["0:0:hr"]);
	});

	test("keeps a table together when a body row has spaces around pipes", () => {
		expect(outline("| a |\n| :-: |\n| 1 |\n| 2 |")).toEqual(["0:3:table"]);
	});

	test("treats fenced code as one opaque block and runs an unterminated fence to the end", () => {
		const plan = "```ts\n# not a heading\n- not a step\n```\nafter";
		expect(outline(plan)).toEqual(["0:3:code", "4:4:paragraph"]);
		expect(planBlocks(plan)[0].kind).toBe<PlanBlockKind>("code");
		expect(outline("before\n```\nstill code")).toEqual(["0:0:paragraph", "1:2:code"]);
	});

	test("keeps the fence marker in the block so it can be rewritten verbatim", () => {
		expect(planBlocks("~~~\nbody\n~~~")[0].lines).toEqual(["~~~", "body", "~~~"]);
	});

	test("strips carriage returns and keeps line numbers aligned", () => {
		expect(outline("a\r\n\r\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
		expect(planBlocks("a\r\nb")[0].lines).toEqual(["a", "b"]);
	});

	test("treats a tab-indented fence as prose, the same as the section parser", () => {
		// The fence rule is shared with `steps.ts` and allows up to three spaces; a
		// tab-indented fence must not shift annotation anchors by being code here
		// and prose in the review screen.
		expect(planBlocks("\t```\n- [ ] inside\n\t```\n").some((block) => block.kind === "code")).toBe(false);
	});

	test("blockAt finds the containing block and falls back to the nearest before it", () => {
		const blocks = planBlocks("# Title\ntext\n- one\n- two");
		expect(blockAt(blocks, 0)?.kind).toBe("heading");
		expect(blockAt(blocks, 1)?.kind).toBe("paragraph");
		expect(blockAt(blocks, 2)).toMatchObject({ kind: "list", start: 2 });
		expect(blockAt(blocks, 99)?.start).toBe(3);
	});

	test("contentBlockAt skips a blank line for the block a comment belongs to", () => {
		const blocks = planBlocks("# Title\n- one\n\n- two\n");
		// Line 2 is the blank between the steps: a comment there belongs to `- one`.
		expect(contentBlockAt(blocks, 2)).toMatchObject({ kind: "list", start: 1 });
		// Above the plan's own first block, the answer is that block.
		expect(contentBlockAt(blocks, -1)).toMatchObject({ kind: "heading", start: 0 });
		expect(contentBlockAt(blocks, 99)).toMatchObject({ kind: "list", start: 3 });
		expect(contentBlockAt(blocks, 1)).toMatchObject({ kind: "list", start: 1 });
	});

	test("contentBlockAt has nothing to name in a plan of blank lines", () => {
		expect(contentBlockAt(planBlocks("\n\n"), 1)).toBeUndefined();
		expect(contentBlockAt(planBlocks(""), 0)).toBeUndefined();
	});

	test("codeBody drops the fence lines and keeps a non-code block unchanged", () => {
		expect(codeBody(planBlocks("```ts\nconst x = 1;\n```")[0])).toEqual(["const x = 1;"]);
		expect(codeBody(planBlocks("```\nstill code")[0])).toEqual(["still code"]);
		expect(codeBody(planBlocks("plain text")[0])).toEqual(["plain text"]);
	});

	test("fenceInfo extracts the info string after a fence", () => {
		expect(fenceInfo("```ts")).toBe("ts");
		expect(fenceInfo("~~~ python")).toBe("python");
		expect(fenceInfo("plain text")).toBe("");
	});
});

describe("plan index — age and notice", () => {
	const NOW = fixedPlanDate().getTime();
	const DAY = 86_400_000;

	/** A summary for a plan modified `days` before NOW. */
	function summary(over: Partial<PlanSummary> = {}): PlanSummary {
		return {
			path: "/home/u/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			relativePath: "~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			title: "Add rate limiting",
			modified: NOW - 2 * DAY,
			bytes: 512,
			steps: { done: 3, total: 7 },
			...over,
		};
	}

	test("relativeAge reports today, days, months, and years", () => {
		expect(relativeAge(NOW, NOW)).toBe("today");
		expect(relativeAge(NOW - DAY, NOW)).toBe("1d ago");
		expect(relativeAge(NOW - 3 * DAY, NOW)).toBe("3d ago");
		expect(relativeAge(NOW - 45 * DAY, NOW)).toBe("1mo ago");
		expect(relativeAge(NOW - 400 * DAY, NOW)).toBe("1y ago");
	});

	test("relativeAge never reports a negative age for a future mtime", () => {
		expect(relativeAge(NOW + DAY, NOW)).toBe("today");
	});

	test("names the directory and one line per plan, newest first", () => {
		const text = formatPlanIndex(
			[summary(), summary({ title: "Older plan", modified: NOW - 40 * DAY, steps: { done: 0, total: 2 } })],
			"~/.pi/agent/plans/a1f9c02",
		);
		const lines = text.split("\n");
		expect(lines[0]).toContain("Plans (2)");
		expect(lines[0]).toContain("~/.pi/agent/plans/a1f9c02");
		expect(lines[1]).toContain("Add rate limiting — 3/7 steps");
		expect(lines[1]).toContain("~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md");
		expect(lines[2]).toContain("Older plan — 0/2 steps");
	});

	test("says where plans go when there are none", () => {
		expect(formatPlanIndex([], "~/.pi/agent/plans/a1f9c02")).toBe(
			"No plans in ~/.pi/agent/plans/a1f9c02 yet; write_plan saves one there.",
		);
	});

	test("reports a file it did not read as unknown steps and sanitizes a title", () => {
		const unknown = formatPlanIndex([summary({ steps: undefined, oversize: true })], "~/.pi/agent/plans/a1f9c02");
		expect(unknown).toContain("steps unknown");

		const dirty = formatPlanIndex([summary({ title: "bad\u0001title" })], "~/.pi/agent/plans/a1f9c02");
		expect(dirty).toContain("bad title");
		expect(dirty).not.toContain("\u0001");
	});
});

describe("plan index — screen", () => {
	const NOW = fixedPlanDate().getTime();
	const DAY = 86_400_000;

	/** A summary for a plan modified `days` before NOW. */
	function summary(over: Partial<PlanSummary> = {}): PlanSummary {
		return {
			path: "/home/u/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			relativePath: "~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md",
			title: "Add rate limiting",
			modified: NOW - 2 * DAY,
			bytes: 512,
			steps: { done: 3, total: 7 },
			...over,
		};
	}

	function harness(
		options: { summaries?: readonly PlanSummary[]; reload?: () => Promise<readonly PlanSummary[]> } = {},
	) {
		const selected: PlanSummary[] = [];
		let closed = 0;
		const component = new PlanIndexComponent({
			summaries: options.summaries ?? [summary(), summary({ title: "Older plan", modified: NOW - 40 * DAY })],
			dir: "~/.pi/agent/plans/a1f9c02",
			theme,
			now: () => NOW,
			onSelect: (plan) => selected.push(plan),
			onClose: () => {
				closed += 1;
			},
			reload: options.reload ?? (async () => options.summaries ?? []),
			requestRender: () => {},
			viewportRows: () => 24,
		});
		return {
			component,
			selected,
			closeCount: () => closed,
			text: (width = 80): string => component.render(width).join("\n"),
			input: (data: string): void => component.handleInput(data),
			mouse: (delta: number): unknown => component.handleMouse({ type: "wheel", wheelDelta: delta } as never),
		};
	}

	test("lists plans with step progress and age, newest first", () => {
		const h = harness();
		expect(h.text()).toContain("❯ Add rate limiting");
		expect(h.text()).toContain("3/7 steps · 2d ago");
		expect(h.text()).toContain("Older plan");
		expect(h.text()).toContain("1mo ago");
	});

	test("shows the focused plan's path and modified time", () => {
		const h = harness();
		expect(h.text()).toContain("~/.pi/agent/plans/a1f9c02/2026-10-16-1030-add-rate-limiting.md");
		// The path is long enough to clip the tail at 80 columns; the row still carries
		// the modified time.
		expect(h.text()).toContain("modified 202");
	});

	test("shows an empty state", () => {
		expect(harness({ summaries: [] }).text()).toContain("No plans yet");
	});

	test("stays within the width", () => {
		const h = harness();
		for (const width of [80, 40, 20, 12, 6, 1]) {
			for (const line of h.component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("scrolls its range row when the plans overflow", () => {
		const many = Array.from({ length: 30 }, (_, index) => summary({ title: `Plan ${index}` }));
		expect(harness({ summaries: many }).text()).toMatch(/1–\d+ of 30/);
	});

	test("moves the selection with j/k and the wheel", () => {
		const h = harness();
		h.input("j");
		expect(h.text()).toContain("❯ Older plan");
		h.mouse(1);
		expect(h.text()).toContain("❯ Older plan");
		h.input("k");
		expect(h.text()).toContain("❯ Add rate limiting");
	});

	test("g and G jump to the ends", () => {
		const many = Array.from({ length: 20 }, (_, index) => summary({ title: `Plan ${index}` }));
		const h = harness({ summaries: many });
		h.input("G");
		expect(h.text()).toContain("❯ Plan 19");
		h.input("g");
		expect(h.text()).toContain("❯ Plan 0");
	});

	test("closes on Escape", () => {
		const h = harness();
		h.input("\x1b");
		expect(h.closeCount()).toBe(1);
	});

	test("Enter hands the focused plan to the caller", () => {
		const h = harness();
		h.input("j");
		h.input("\r");
		expect(h.selected.map((plan) => plan.title)).toEqual(["Older plan"]);
	});

	test("Enter with no plans selects nothing", () => {
		const h = harness({ summaries: [] });
		h.input("\r");
		expect(h.selected).toEqual([]);
	});

	test("r reloads the rows and reports an empty directory", async () => {
		const h = harness({ reload: async () => [] });
		h.input("r");
		await settle();
		expect(h.text()).toContain("No plans yet");
	});

	test("a failed reload reports the reason instead of throwing", async () => {
		const h = harness({
			reload: async () => {
				throw new Error("permission denied");
			},
		});
		h.input("r");
		await settle();
		expect(h.text()).toContain("Could not read the plans directory: permission denied");
	});
});

describe("plan policy", () => {
	const piWith = (tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>) =>
		({ getAllTools: () => tools }) as unknown as ExtensionAPI;

	test("allows the structured readers, the trackers, the known web/ask tools, and the git-only shell", () => {
		const policy = createPlanPolicy(piWith([]));
		for (const name of [
			"read",
			"grep",
			"find",
			"ls",
			"todo",
			"goal",
			"bash",
			"ask_user_question",
			"web_search",
			"web_fetch",
		]) {
			expect(policy.classify(name)).toBe("read-only");
		}
	});

	test("keeps subagent active but only as a guarded, read-only delegation", () => {
		const policy = createPlanPolicy(piWith([]));
		expect(PLAN_ALLOWED_TOOLS).toContain("subagent");
		expect(PLAN_SAFE_TOOLS).not.toContain("subagent");
		expect(policy.classify("subagent")).toBe("read-only");
	});

	test("blocks powershell outright", () => {
		const policy = createPlanPolicy(piWith([]));
		expect(PLAN_SAFE_TOOLS).not.toContain("powershell");
		expect(policy.check("powershell")?.block).toBe(true);
	});

	test("blocks write, edit, and enter_plan_mode", () => {
		const policy = createPlanPolicy(piWith([]));
		for (const name of ["write", "edit", "enter_plan_mode"]) {
			expect(policy.check(name)?.block).toBe(true);
		}
	});

	test("blocks unknown tools, the cross-platform hole", () => {
		expect(createPlanPolicy(piWith([])).check("mcp__danger")?.block).toBe(true);
	});

	test("opens a tool that carries the MCP read-only hint", () => {
		const annotated = createPlanPolicy(piWith([{ name: "web_search", annotations: { readOnlyHint: true } }]));
		expect(annotated.check("web_search")).toBeUndefined();
	});

	test("deny wins over a read-only hint on a write tool", () => {
		const annotated = createPlanPolicy(piWith([{ name: "write", annotations: { readOnlyHint: true } }]));
		expect(annotated.check("write")?.block).toBe(true);
	});

	test("names the exit hatch in a refused call", () => {
		expect(createPlanPolicy(piWith([])).check("write")?.reason).toContain("exit_plan_mode");
	});
});
