/**
 * When a pruning pass runs, over which stores, and the line it answers (one job).
 *
 * One store is `plans/<key>`, and its protection set is the board filed under the same key:
 * `lib/repo-key.ts` gives both the one identity, so nothing here re-derives it.
 *
 * Three doors, and the difference between them is who asked:
 *
 * - after a successful `write`, and at `session_start`, one bounded pass over *this*
 *   repository, silent — a session pays a fixed cost and reports nothing;
 * - `/plan prune [--dry-run]`, every store the machine holds, reported. It walks the whole
 *   plans directory, which is what reclaims the keys no repository on this disk answers to any
 *   more, and it runs even when `plan.enabled` is false: that switch governs the automatic
 *   passes, not the person.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSize } from "../../lib/format.ts";
import { plansDir, plansDirFor } from "../../lib/plans/paths.ts";
import { loadPlanConfig } from "./config.ts";
import { type SweepResult, sweepPlanStore } from "./retention.ts";

/** Removals one automatic pass may make, so a start pays a bound and a person pays the rest. */
const QUIET_BATCH = 200;

/** How many plans a store holds, without stat'ing one: the guard that keeps a write cheap. */
async function planCount(dir: string): Promise<number> {
	const names = await readdir(dir).catch(() => undefined);
	if (names === undefined) return 0;
	return names.filter((name) => name.toLowerCase().endsWith(".md") && !name.startsWith(".")).length;
}

/** The board directory a store's protection set is read from — the same key, one fact. */
async function protectionFor(key: string): Promise<ReadonlySet<string> | undefined> {
	const [{ recordedPlans }, { boardDirFor }] = await Promise.all([
		import("../../lib/workflow/read.ts"),
		import("../../lib/workflow/store.ts"),
	]);
	return recordedPlans(boardDirFor(getAgentDir(), key));
}

/**
 * One bounded pass over this repository's store, for a trigger nobody asked about.
 *
 * Nothing is reported and nothing throws: the caller is a write that already succeeded or a
 * session that is starting, so a sweep is not allowed to become the failure they see.
 */
export async function sweepQuietly(pi: ExtensionAPI, cwd: string, options: { nowMs?: number } = {}): Promise<void> {
	const config = loadPlanConfig(cwd);
	if (!config.enabled) return;
	const [{ repoKeyFor }, { resolveEffectiveCwd }] = await Promise.all([
		import("../../lib/repo-key.ts"),
		import("../../lib/env.ts"),
	]);
	const repo = await repoKeyFor(pi, resolveEffectiveCwd(cwd));
	const dir = plansDirFor(getAgentDir(), repo);
	// The store is read even when the count is small: `maxAgeDays` is a deletion trigger of its
	// own, so skipping a short store would leave a stale one to the command alone.
	const protectedNames = await protectionFor(repo.key);
	if (protectedNames === undefined) return;
	await sweepPlanStore(dir, { config, protectedNames, nowMs: options.nowMs ?? Date.now(), batch: QUIET_BATCH });
}

/** What one `/plan prune` did, or would do. */
export interface PruneReport {
	/** Stores the pass read. */
	stores: number;
	/** Plans removed (or, under `dryRun`, that it would remove). */
	removed: number;
	/** Plans left behind. */
	kept: number;
	/** Plans a card records, and therefore never removed. */
	protected: number;
	/** Bytes freed (or that the removal would free). */
	bytes: number;
}

/**
 * Sweep every plan store on this machine, or say what a sweep would take.
 *
 * `dryRun` is the same decision without the unlink, so a person reads the report and then asks
 * for exactly what it named.
 */
export async function pruneAll(
	pi: ExtensionAPI,
	cwd: string,
	options: { dryRun?: boolean; nowMs?: number } = {},
): Promise<PruneReport> {
	const agentDir = getAgentDir();
	const config = { ...loadPlanConfig(cwd), enabled: true };
	const nowMs = options.nowMs ?? Date.now();
	const root = plansDir(agentDir);
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const report: PruneReport = { stores: 0, removed: 0, kept: 0, protected: 0, bytes: 0 };
	const collect = (result: SweepResult): void => {
		report.stores += 1;
		report.removed += result.removedPlans;
		report.kept += result.kept;
		report.protected += result.protected;
		report.bytes += result.bytes;
	};
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		// A store whose board cannot be read is skipped, not emptied: the report counts what was
		// actually read, and silence about a skipped store is the alternative to deleting a plan.
		const protectedNames = await protectionFor(entry.name);
		if (protectedNames === undefined) continue;
		collect(await sweepPlanStore(join(root, entry.name), { config, protectedNames, nowMs, dryRun: options.dryRun }));
	}
	// Outside a repository the store is the plans directory itself, filed under the session's
	// own key — the one place a key is not a directory name here.
	if ((await planCount(root)) > 0) {
		const [{ repoKeyFor }, { resolveEffectiveCwd }] = await Promise.all([
			import("../../lib/repo-key.ts"),
			import("../../lib/env.ts"),
		]);
		const repo = await repoKeyFor(pi, resolveEffectiveCwd(cwd));
		const protectedNames = await protectionFor(repo.key);
		if (protectedNames !== undefined) {
			collect(await sweepPlanStore(root, { config, protectedNames, nowMs, dryRun: options.dryRun }));
		}
	}
	return report;
}

/** The sentence a `/plan prune` run prints, and the `--dry-run` one that asks first. */
export function pruneText(report: PruneReport, dryRun: boolean): string {
	const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
	const size = formatSize(report.bytes);
	return dryRun
		? `plan: would remove ${plural(report.removed, "plan")} from ${plural(report.stores, "store")} · ${report.kept} kept · ${report.protected} protected by a card · ${size}`
		: `plan: removed ${plural(report.removed, "plan")} from ${plural(report.stores, "store")} · ${report.kept} kept · ${report.protected} protected by a card · ${size} freed`;
}
