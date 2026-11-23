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

/** The plan names one store holds now, oldest first. */
async function namesIn(dir: string): Promise<string[]> {
	const { readPlanStore } = await import("./retention.ts");
	return (await readPlanStore(dir)).map((entry) => entry.name);
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
			expect(report).toEqual({ stores: 1, removed: 1, kept: 2, protected: 1, bytes: expect.any(Number) });
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

describe("pruneText", () => {
	test("names what a run did, and what a dry run would do", () => {
		const report = { stores: 146, removed: 36_912, kept: 2_206, protected: 3, bytes: 385 * 1024 * 1024 };
		expect(pruneText(report, true)).toContain("would remove 36912 plans from 146 stores");
		expect(pruneText(report, true)).toContain("3 protected by a card");
		expect(pruneText(report, false)).toContain("removed 36912 plans from 146 stores");
		expect(pruneText(report, false)).toContain("385 MB freed");
		expect(pruneText({ stores: 1, removed: 1, kept: 0, protected: 0, bytes: 12 }, false)).toContain(
			"removed 1 plan from 1 store",
		);
	});
});
