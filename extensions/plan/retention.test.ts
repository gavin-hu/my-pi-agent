import { describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { DEFAULT_PLAN_CONFIG, type PlanConfig } from "./config.ts";
import { type PlanFile, planRemovals, readPlanStore, sweepPlanStore } from "./retention.ts";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** A plan store entry `days` old. */
function aged(name: string, days: number): PlanFile {
	return { name, mtimeMs: NOW - days * DAY };
}

/** A config with both bounds stated, so a case names only what it is about. */
function config(overrides: Partial<PlanConfig> = {}): PlanConfig {
	return { ...DEFAULT_PLAN_CONFIG, ...overrides };
}

describe("planRemovals", () => {
	test("removes a plan only when it is old enough and past the count, never one of the two alone", () => {
		const entries = [aged("newest.md", 1), aged("middle.md", 400), aged("oldest.md", 500)];
		const twoKept = planRemovals({
			entries,
			protectedNames: new Set(),
			config: config({ keep: 2, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		// The newest two are kept whatever their age, so only the plan that trips both bounds goes.
		expect(twoKept.remove).toEqual(["oldest.md"]);
		expect(twoKept.removedPlans).toBe(1);
		expect(twoKept.kept).toBe(2);
		const oneKept = planRemovals({
			entries,
			protectedNames: new Set(),
			config: config({ keep: 1, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		// Oldest first, so a batched pass would make progress from the far end.
		expect(oneKept.remove).toEqual(["oldest.md", "middle.md"]);
		// And a young plan past the count is kept: the age bound is not a ceiling of its own.
		const young = planRemovals({
			entries: [aged("today.md", 1), aged("yesterday.md", 2)],
			protectedNames: new Set(),
			config: config({ keep: 1, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		expect(young.remove).toEqual([]);
	});

	test("keeps a plan a card records, however old and however many", () => {
		// The protected plan is the newest, so it takes the one slot `keep` allows and the two
		// loose plans behind it both trip both bounds.
		const answer = planRemovals({
			entries: [aged("recorded.md", 9_000), aged("loose-newer.md", 9_001), aged("loose-older.md", 9_002)],
			protectedNames: new Set(["recorded.md"]),
			config: config({ keep: 1, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		expect(answer.remove).toEqual(["loose-older.md", "loose-newer.md"]);
		expect(answer.protected).toBe(1);
		expect(answer.removedPlans).toBe(2);
	});

	test("declines when retention is off, and when the board could not be read", () => {
		const entries = [aged("loose.md", 9_000)];
		const off = planRemovals({ entries, protectedNames: new Set(), config: config({ enabled: false }), nowMs: NOW });
		expect(off.declined).toBe("disabled");
		expect(off.remove).toEqual([]);
		const unreadable = planRemovals({ entries, protectedNames: undefined, config: config(), nowMs: NOW });
		expect(unreadable.declined).toBe("unreadable-board");
		expect(unreadable.remove).toEqual([]);
	});

	test("takes a revision only with its plan, and never a plan's chain while the plan stays", () => {
		const entries = [
			aged(".kept-r001.md", 9_000),
			aged("kept.md", 1_000),
			aged(".gone-r001.md", 9_000),
			aged(".gone-r002.md", 9_000),
			aged("gone.md", 2_000),
		];
		const answer = planRemovals({
			entries,
			protectedNames: new Set(["kept.md"]),
			config: config({ keep: 1, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		expect(answer.remove).toEqual(["gone.md", ".gone-r001.md", ".gone-r002.md"]);
		// A protected plan takes no slot and loses nothing beside it.
		expect(answer.protected).toBe(1);
	});

	test("never treats a dotfile, the legacy ignore file, or a non-markdown file as a plan", () => {
		const entries = [aged(".gitignore", 9_000), aged("notes.txt", 9_000), aged(".tmp-hidden.md", 9_000)];
		const answer = planRemovals({ entries, protectedNames: new Set(), config: config({ keep: 1 }), nowMs: NOW });
		expect(answer.remove).toEqual([]);
		expect(answer.kept).toBe(0);
	});

	test("sweeps from the oldest end and stops at the batch, and the next pass carries on", () => {
		const entries = [1, 2, 3, 4].map((rank) => aged(`plan-${rank}.md`, 400 + rank));
		const options = { entries, protectedNames: new Set<string>(), config: config({ keep: 1, maxAgeDays: 180 }), nowMs: NOW };
		const first = planRemovals({ ...options, batch: 2 });
		expect(first.remove).toEqual(["plan-4.md", "plan-3.md"]);
		const rest = entries.filter((entry) => !first.remove.includes(entry.name));
		const second = planRemovals({ ...options, entries: rest, batch: 2 });
		expect(second.remove).toEqual(["plan-2.md"]);
		const third = planRemovals({ ...options, entries: rest.filter((entry) => !second.remove.includes(entry.name)) });
		// `keep` 1 means one plan always survives, which is what makes the sweep terminate.
		expect(third.remove).toEqual([]);
		expect(third.kept).toBe(1);
	});

	test("with maxAgeDays 0 the count alone decides, and a plan younger than the bound is kept", () => {
		const countOnly = planRemovals({
			entries: [aged("a.md", 1), aged("b.md", 2)],
			protectedNames: new Set(),
			config: config({ keep: 1, maxAgeDays: 0 }),
			nowMs: NOW,
		});
		expect(countOnly.remove).toEqual(["b.md"]);
		const justWritten = planRemovals({
			entries: [{ name: "today.md", mtimeMs: NOW }],
			protectedNames: new Set(),
			config: config({ keep: 1, maxAgeDays: 180 }),
			nowMs: NOW,
		});
		expect(justWritten.remove).toEqual([]);
	});
});

describe("sweepPlanStore", () => {
	/** A store on disk with the given names, each `days` old. */
	function store(prefix: string, names: Array<[string, number]>): string {
		const dir = tempDir(prefix);
		mkdirSync(dir, { recursive: true });
		for (const [name, days] of names) {
			const path = join(dir, name);
			writeFileSync(path, `# ${name}`);
			const at = new Date(NOW - days * DAY);
			utimesSync(path, at, at);
		}
		return dir;
	}

	test("a dry run reports what it would remove and removes nothing", async () => {
		const dir = store("plan-dry-", [
			["keep.md", 1],
			["gone.md", 400],
		]);
		const report = await sweepPlanStore(dir, {
			config: config({ keep: 1, maxAgeDays: 180 }),
			protectedNames: new Set(),
			nowMs: NOW,
			dryRun: true,
		});
		expect(report.remove).toEqual(["gone.md"]);
		expect(report.bytes).toBeGreaterThan(0);
		expect(await readPlanStore(dir)).toHaveLength(2);
	});

	test("removes what it named, reports the bytes, and answers nothing on a second pass", async () => {
		const dir = store("plan-sweep-", [
			["keep.md", 1],
			["gone.md", 400],
			[".gone-r001.md", 400],
			["recorded.md", 9_000],
		]);
		const options = { config: config({ keep: 1, maxAgeDays: 180 }), protectedNames: new Set(["recorded.md"]), nowMs: NOW };
		const first = await sweepPlanStore(dir, options);
		expect(first.remove).toEqual(["gone.md", ".gone-r001.md"]);
		expect(first.bytes).toBeGreaterThan(0);
		expect((await readPlanStore(dir)).map((entry) => entry.name).sort()).toEqual(["keep.md", "recorded.md"]);
		const second = await sweepPlanStore(dir, options);
		expect(second.remove).toEqual([]);
		expect(second.protected).toBe(1);
	});

	test("leaves a missing store alone", async () => {
		const report = await sweepPlanStore(join(tempDir("plan-absent-"), "nope"), {
			config: config(),
			protectedNames: new Set(),
			nowMs: NOW,
		});
		expect(report).toMatchObject({ remove: [], removedPlans: 0, kept: 0, bytes: 0 });
	});
});
