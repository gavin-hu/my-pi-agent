import { describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { writeConfig } from "../../test/helpers/fixtures/footer.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { billingCard } from "../../test/helpers/fixtures/board.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { pruneAll, pruneText, sweepQuietly } from "./prune.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-22T12:00:00.000Z");

/**
 * The id one directory's state is filed under, computed from the identity rules rather than asked
 * of the resolver: a sweep that names the wrong store must fail here, not follow the code it tests.
 */
function storeIdOf(cwd: string): string {
	return `local-${repoKeyOf(cwd)}`;
}

/** The plan store the `plan` tool writes: one repository's state, one directory. */
function storeOf(agentDir: string, cwd: string): string {
	return join(agentDir, "repos", storeIdOf(cwd), "plans");
}

/** A plan file `days` old, written by hand so the suite needs no store. */
function writePlan(dir: string, name: string, days: number): void {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, `# ${name}\n`);
	// Seconds, not a `Date`: the age bound reads an mtime, and a test that builds a clock
	// would be the clock it is trying to be independent of.
	utimesSync(path, (NOW - days * DAY) / 1_000, (NOW - days * DAY) / 1_000);
}

/** A file in the store that is not a plan: the screenshots the bound can never reach. */
function writeArtefact(dir: string, name: string, bytes: number): void {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, Buffer.alloc(bytes, 1));
	utimesSync(path, (NOW - 400 * DAY) / 1_000, (NOW - 400 * DAY) / 1_000);
}

/** One card that records `plan` as its plan, in the board beside the store. */
function writeCard(agentDir: string, cwd: string, plan: string): void {
	const pile = join(agentDir, "repos", storeIdOf(cwd), "board", "cards");
	mkdirSync(pile, { recursive: true });
	const card = billingCard({ planPath: plan });
	// The fixture carries the version the reader gates on, so the file is written as it says.
	writeFileSync(join(pile, "0004.json"), JSON.stringify(card));
}

/** A project document that states the bound a case is about. */
function writeBound(cwd: string, plan: Record<string, unknown>): void {
	writeConfig(join(cwd, CONFIG_DIR_NAME), "bytefly.json", { plan });
}

/** The plan names one store holds now, by name. */
async function namesIn(dir: string): Promise<string[]> {
	const { readPlanStore } = await import("./retention.ts");
	// The sort is the assertion's, not the store's: `readPlanStore` hands back `readdir` order,
	// which is the filesystem's. The compat job read this array in a different order on the same
	// code — `gone.md`, `newest.md`, `recorded.md` — so a machine whose `readdir` happens to be
	// sorted (this one, five runs without the sort) cannot show the defect the sort fixes.
	return (await readPlanStore(dir)).map((entry) => entry.name).sort();
}

describe("pruneAll", () => {
	test("removes an unreferenced plan and keeps a card's, in one pass over the store the tool writes", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "newest.md", 1);
			writePlan(store, "gone.md", 400);
			writePlan(store, "recorded.md", 9_000);
			writeCard(agentDir, cwd, "recorded.md");
			const report = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW });
			// Both directions in one pass, because either half alone passes on an inert sweep: a
			// protection set read from a board nothing writes would take `recorded.md` with it, and a
			// sweep of the flat tree the mover emptied would take neither.
			expect(report).toEqual({
				stores: 1,
				skipped: 0,
				removed: 1,
				kept: 2,
				protected: 1,
				bytes: expect.any(Number),
				heldBytes: expect.any(Number),
				planBytes: expect.any(Number),
				artefacts: [],
			});
			expect(report.bytes).toBeGreaterThan(0);
			expect(await namesIn(store)).toEqual(["newest.md", "recorded.md"]);
		});
	});

	test("a dry run reports the same decision and removes nothing", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "newest.md", 1);
			writePlan(store, "gone.md", 400);
			const planned = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW, dryRun: true });
			expect(planned.removed).toBe(1);
			// The same decision, one door: the file a dry run names is still there.
			const acted = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW });
			expect(acted.removed).toBe(1);
			const after = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW });
			expect(after.removed).toBe(0);
		});
	});

	test("runs even when the automatic passes are off, because that switch is not the person's", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { enabled: false, keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "newest.md", 1);
			writePlan(store, "gone.md", 400);
			expect((await pruneAll(createFakePi().pi, cwd, { nowMs: NOW })).removed).toBe(1);
		});
	});
});

describe("sweepQuietly", () => {
	test("leaves a store alone when every plan is young and inside the count", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-quiet-cwd-");
			writeBound(cwd, { keep: 100, maxAgeDays: 180 });
			// The store the tool resolved for this directory; both plans are young and inside
			// `keep: 100`, so neither trigger fires.
			const store = storeOf(agentDir, cwd);
			writePlan(store, "one.md", 1);
			writePlan(store, "two.md", 2);
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			expect(await namesIn(store)).toEqual(["one.md", "two.md"]);
		});
	});

	test("removes a stale plan from a store the count bound would have spared", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-quiet-cwd-");
			writeBound(cwd, { keep: 100, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "fresh.md", 1);
			writePlan(store, "stale.md", 400);
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			// The automatic pass reads a short store too, because the age trigger is its own reason.
			expect(await namesIn(store)).toEqual(["fresh.md"]);
		});
	});

	test("keeps what the board beside the store records, and does nothing when retention is off", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-quiet-cwd-");
			const store = storeOf(agentDir, cwd);
			writePlan(store, "newest.md", 1);
			writePlan(store, "gone.md", 400);
			writePlan(store, "recorded.md", 400);
			writeCard(agentDir, cwd, "recorded.md");
			writeBound(cwd, { enabled: false, keep: 1, maxAgeDays: 180 });
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			expect(await namesIn(store)).toEqual(["gone.md", "newest.md", "recorded.md"]);
			// The same files and the same bounds, with the switch the other way: the plan that trips a
			// bound goes, the one a card records stays, and the first half is the switch's doing.
			writeBound(cwd, { enabled: true, keep: 1, maxAgeDays: 180 });
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			expect(await namesIn(store)).toEqual(["newest.md", "recorded.md"]);
		});
	});
});

describe("the protection set a sweep reads", () => {
	test("an absent board protects nothing, so a plans-only repository is still swept", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-quiet-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "stale.md", 400);
			// No board was ever opened: there is no card, so nothing records a plan and the store is
			// sweepable. Absent is not the same answer as unreadable.
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			expect(await namesIn(store)).toEqual([]);
		});
	});

	test("a board that is there and cannot be read declines, rather than deleting what it could not see", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-quiet-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "stale.md", 400);
			const pile = join(agentDir, "repos", storeIdOf(cwd), "board", "cards");
			mkdirSync(pile, { recursive: true });
			// A card the reader refuses may still record the plan in front of it, so the pass counts
			// what it could read and leaves the rest alone.
			writeFileSync(join(pile, "0004.json"), "{ not a card");
			await sweepQuietly(createFakePi().pi, cwd, { nowMs: NOW });
			expect(await namesIn(store)).toEqual(["stale.md"]);
			expect(await pruneAll(createFakePi().pi, cwd, { nowMs: NOW })).toMatchObject({ stores: 0, removed: 0 });
		});
	});
});

describe("what a sweep cannot touch", () => {
	test("names the artefacts by kind with count and bytes, and never removes one", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "stale.md", 400);
			writeArtefact(store, "team-page.png", 3_000);
			writeArtefact(store, "width-1280.png", 1_000);
			writeArtefact(store, "notes.txt", 10);
			// A revision is a dotfile: a plan's own history, not something the bound cannot see.
			writeArtefact(store, ".stale.md.rev1", 5);

			const report = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW });
			expect(report.artefacts).toEqual([
				{ kind: "png", count: 2, bytes: 4_000 },
				{ kind: "txt", count: 1, bytes: 10 },
			]);
			// The arithmetic, not only the output: `kept` and `removed` count plans, so a `.png`
			// cannot enter either however the store is swept.
			expect([report.removed, report.kept]).toEqual([1, 0]);
			expect(report.planBytes).toBeGreaterThan(0);
			expect(report.heldBytes).toBeGreaterThan(report.planBytes);
			// A dry run and a real sweep leave the screenshots exactly where they are.
			expect((await namesIn(store)).sort()).toEqual([".stale.md.rev1", "notes.txt", "team-page.png", "width-1280.png"]);
		});
	});

	test("takes the summary from the listing the decision used, so the two cannot disagree", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const store = storeOf(agentDir, cwd);
			writePlan(store, "newest.md", 1);
			writePlan(store, "stale.md", 400);
			writeArtefact(store, "shot.png", 200);
			writeCard(agentDir, cwd, "newest.md");
			const { sweepPlanStore, readPlanStore, storeSummary } = await import("./retention.ts");
			const { loadPlanConfig } = await import("./config.ts");
			const entries = await readPlanStore(store);
			const swept = await sweepPlanStore(store, {
				config: { ...loadPlanConfig(cwd), enabled: true },
				protectedNames: new Set(["newest.md"]),
				nowMs: NOW,
				dryRun: true,
			});
			// One listing: the summary a sweep reports is the summary of the entries it decided from.
			expect(swept.summary).toEqual(storeSummary(entries));
			expect(swept.summary.plans).toBe(2);
			expect(swept.summary.artefacts).toEqual([{ kind: "png", count: 1, bytes: 200 }]);
		});
	});

	test("counts a store it could not read and names it, so the total reads as what it is", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = tempDir("plan-prune-cwd-");
			writeBound(cwd, { keep: 1, maxAgeDays: 180 });
			const readable = storeOf(agentDir, cwd);
			writePlan(readable, "newest.md", 1);
			writeArtefact(readable, "shot.png", 200);
			// A second repository's store whose board cannot be read: the pass declines it, which is
			// right, and the report must say so rather than quietly counting one store's bytes.
			const unreadable = join(agentDir, "repos", "other", "plans");
			writePlan(unreadable, "stranger.md", 400);
			const pile = join(agentDir, "repos", "other", "board", "cards");
			mkdirSync(pile, { recursive: true });
			writeFileSync(join(pile, "0004.json"), "{ not a card");

			const report = await pruneAll(createFakePi().pi, cwd, { nowMs: NOW });
			expect([report.stores, report.skipped]).toEqual([1, 1]);
			expect(report.artefacts).toEqual([{ kind: "png", count: 1, bytes: 200 }]);
			// Its files are untouched: the decline rule is not a licence.
			expect(await namesIn(unreadable)).toEqual(["stranger.md"]);
			expect(pruneText(report, true)).toContain("held in the 1 store it could read");
			expect(pruneText(report, true)).toContain("1 store skipped, its board could not be read");
		});
	});
});

describe("pruneText", () => {
	/** A report as a run builds it: the numbers a reader already knows, and the held clause. */
	function report(overrides: Partial<Parameters<typeof pruneText>[0]> = {}): Parameters<typeof pruneText>[0] {
		return {
			stores: 146,
			skipped: 0,
			removed: 36_912,
			kept: 2_206,
			protected: 3,
			bytes: 385 * 1024 * 1024,
			heldBytes: 512 * 1024 * 1024,
			planBytes: 22 * 1024 * 1024,
			artefacts: [
				{ kind: "png", count: 1_790, bytes: 480 * 1024 * 1024 },
				{ kind: "pdf", count: 14, bytes: 2 * 1024 * 1024 },
			],
			...overrides,
		};
	}

	test("names what a run did, and what a dry run would do", () => {
		expect(pruneText(report(), true)).toContain("would remove 36912 plans from 146 stores");
		expect(pruneText(report(), true)).toContain("3 protected by a card");
		expect(pruneText(report(), false)).toContain("removed 36912 plans from 146 stores");
		expect(pruneText(report(), false)).toContain("385 MB freed");
		expect(pruneText(report({ stores: 1, removed: 1, kept: 0, protected: 0, bytes: 12 }), false)).toContain(
			"removed 1 plan from 1 store",
		);
	});

	test("adds the held bytes and the kinds it cannot sweep, after the numbers it already printed", () => {
		const line = pruneText(report(), true);
		expect(line).toContain("512 MB held");
		expect(line).toContain("482 MB of it in 1804 files a sweep cannot remove (png 1790, pdf 14)");
		// The numbers a reader already knows keep their places: the clause is the end of the line.
		expect(line.indexOf("385 MB")).toBeLessThan(line.indexOf("512 MB held"));
	});

	test("says all of it plans when nothing is there but plans, and names the stores it skipped", () => {
		expect(pruneText(report({ artefacts: [] }), true)).toContain("all of it plans");
		const skipped = pruneText(report({ stores: 2, skipped: 1 }), true);
		expect(skipped).toContain("held in the 2 stores it could read");
		expect(skipped).toContain("1 store skipped, its board could not be read");
	});
});
