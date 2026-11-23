/**
 * When a pruning pass runs, over which stores, and the line it answers (one job).
 *
 * One store is `<agent-dir>/repos/<id>/plans`, and its protection set is the board beside it,
 * `repos/<id>/board/` — one repository's state is one directory (#771), so the store and the cards
 * that record plans are siblings and nothing here re-derives an identity to join them. The flat
 * `plans/<key>` tree is the mover's to empty (`lib/store-paths.ts`): a pass here would have to
 * guess which id's board protects it, and skipping it deletes nothing.
 *
 * Three doors, and the difference between them is who asked:
 *
 * - after a successful `write`, and at `session_start`, one bounded pass over *this*
 *   repository, silent — a session pays a fixed cost and reports nothing;
 * - `/plan prune [--dry-run]`, every store the machine holds, reported. It walks every repository
 *   directory, which is what reclaims the ids no repository on this disk answers to any more, and
 *   it runs even when `plan.enabled` is false: that switch governs the automatic passes, not the
 *   person.
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSize } from "../../lib/format.ts";
import { PLANS_DIR_NAME, plansDirFor } from "../../lib/plans/paths.ts";
import { loadPlanConfig } from "./config.ts";
import { type SweepResult, sweepPlanStore } from "./retention.ts";

/** Removals one automatic pass may make, so a start pays a bound and a person pays the rest. */
const QUIET_BATCH = 200;

/** The board beside one plan store: the protection set every sweep reads. */
async function protectionFor(planDir: string): Promise<ReadonlySet<string> | undefined> {
	const [{ recordedPlans }, { BOARD_DIR_NAME }] = await Promise.all([
		import("../../lib/workflow/read.ts"),
		import("../../lib/workflow/store.ts"),
	]);
	const boardDir = join(dirname(planDir), BOARD_DIR_NAME);
	// A board that was never opened holds no card, so it protects nothing — the store beside it is
	// sweepable. A board that is there and cannot be read is the opposite answer: a card in it may
	// name a plan, so the pass declines rather than deleting what it could not see.
	const opened = await stat(boardDir).then(
		(info) => info.isDirectory(),
		() => false,
	);
	return opened ? recordedPlans(boardDir) : new Set<string>();
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
	const [{ repoStoreDirFor }, { resolveEffectiveCwd }] = await Promise.all([
		import("../../lib/store-paths.ts"),
		import("../../lib/env.ts"),
	]);
	const agentDir = getAgentDir();
	// The store the tool writes, resolved by the one body every owner shares — a second resolver of
	// the same directory is what left this pass sweeping a tree nothing wrote (#789).
	const { dir } = await repoStoreDirFor(pi, resolveEffectiveCwd(cwd), agentDir, PLANS_DIR_NAME, (found) =>
		plansDirFor(agentDir, found),
	);
	// The store is read even when the count is small: `maxAgeDays` is a deletion trigger of its
	// own, so skipping a short store would leave a stale one to the command alone.
	const protectedNames = await protectionFor(dir);
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
	_pi: ExtensionAPI,
	cwd: string,
	options: { dryRun?: boolean; nowMs?: number } = {},
): Promise<PruneReport> {
	const config = { ...loadPlanConfig(cwd), enabled: true };
	const nowMs = options.nowMs ?? Date.now();
	const { reposRoot } = await import("../../lib/repo-key.ts");
	const root = reposRoot(getAgentDir());
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
		// One repository's state is one directory, so its store is the `plans/` inside it. A
		// directory that holds none — a board-only id, a `worktrees/` key — is not a store.
		const store = join(root, entry.name, PLANS_DIR_NAME);
		// A store whose board cannot be read is skipped, not emptied: the report counts what was
		// actually read, and silence about a skipped store is the alternative to deleting a plan.
		const protectedNames = await protectionFor(store);
		if (protectedNames === undefined) continue;
		collect(await sweepPlanStore(store, { config, protectedNames, nowMs, dryRun: options.dryRun }));
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
