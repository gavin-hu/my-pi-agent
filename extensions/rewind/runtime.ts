/**
 * Runtime services shared by the command and event wiring.
 *
 * Owns the effective root and config caches and the snapshot/list/plan/restore
 * operations. Snapshot and restore are staged through the serialized queue in
 * `queue.ts`, because `GIT_INDEX_FILE` lives on `process.env` for the duration
 * of a git call; read-only listings are not queued because they never set it.
 * The temp-index lifecycle and the status chip live in their own modules.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { loadConfig, type RewindConfig } from "./config.ts";
import { createRewindRunner, repoRoot, type RunGit } from "./git.ts";
import { createOperationQueue } from "./queue.ts";
import { applyRestore, planRestore, type PlanResult, type RestoreInput } from "./restore.ts";
import { createSnapshot } from "./snapshot.ts";
import { createStatusChip } from "./status.ts";
import { belongsToRoot, listSnapshots, pruneSnapshots } from "./store.ts";
import { createTempIndexStore } from "./temp-index.ts";
import { lastUserEntryId } from "./timeline.ts";
import type { Snapshot, SnapshotReason, RestoreSummary } from "./types.ts";

export interface SnapshotOptions {
	reason: SnapshotReason;
	prompt?: string;
}

export interface RewindRuntime {
	/** Repository (or worktree) root, or undefined outside a repository. */
	rootFor(ctx: ExtensionContext): Promise<string | undefined>;
	configFor(root: string): RewindConfig;
	/** Create and store a snapshot of the current working tree. */
	snapshot(ctx: ExtensionContext, options: SnapshotOptions): Promise<Snapshot>;
	list(root: string): Promise<Snapshot[]>;
	/** Preview a restore; `paths` narrows it to a subset of the changed paths. */
	plan(root: string, target: Snapshot, paths?: readonly string[]): Promise<PlanResult>;
	restore(
		ctx: ExtensionContext,
		root: string,
		target: Snapshot,
		config: RewindConfig,
		paths?: readonly string[],
	): Promise<RestoreSummary>;
	/** Repaint the `↺ N` chip from the prompt count on the active branch (`/rewind` list size). */
	setStatus(ctx: ExtensionContext): Promise<void>;
	clearStatus(ctx: ExtensionContext): void;
	/** Drop cached roots and config (on session start). */
	invalidate(): void;
	/** Delete this process's temporary index files (on shutdown). */
	releaseIndexes(): void;
	/** Best-effort removal of stale temporary indexes from earlier processes. */
	sweepStaleIndexes(ctx: ExtensionContext): Promise<void>;
}

/** Why a snapshot from another worktree cannot be used here. */
function foreignRootReason(target: Snapshot, root: string): string {
	return `snapshot #${target.id} was taken from ${target.root}, not ${root}.`;
}

export function createRuntime(pi: ExtensionAPI): RewindRuntime {
	const runGit: RunGit = createRewindRunner(pi);
	const configCache = new Map<string, RewindConfig>();
	const rootCache = new Map<string, string | undefined>();
	const indexStore = createTempIndexStore(runGit);

	// Staging operations share one queue: `GIT_INDEX_FILE` is set process-wide
	// for the duration of a git call, so two of them must not interleave.
	const queue = createOperationQueue();

	const effectiveCwd = (ctx: ExtensionContext): string => resolveEffectiveCwd(ctx.cwd);

	const rootFor = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const cwd = effectiveCwd(ctx);
		if (rootCache.has(cwd)) return rootCache.get(cwd);
		// Not serialized: this never sets the temporary index.
		const root = await repoRoot(runGit, cwd);
		rootCache.set(cwd, root);
		return root;
	};

	const configFor = (root: string): RewindConfig => {
		let config = configCache.get(root);
		if (!config) {
			config = loadConfig(root);
			configCache.set(root, config);
		}
		return config;
	};

	const status = createStatusChip({ rootFor, configFor });

	const snapshot = (ctx: ExtensionContext, options: SnapshotOptions): Promise<Snapshot> =>
		queue.enqueue(async () => {
			const root = await rootFor(ctx);
			if (!root) throw new Error("not inside a git repository.");
			const config = configFor(root);
			const snapshot = await createSnapshot(
				{ runGit },
				{
					root,
					indexFile: await indexStore.pathFor(root),
					namespace: config.refNamespace,
					reason: options.reason,
					prompt: options.prompt,
					includeUntracked: config.includeUntracked,
					sessionId: ctx.sessionManager.getSessionId(),
					entryId: lastUserEntryId(ctx.sessionManager.getBranch()),
				},
			);
			if (config.autoPrune) {
				await pruneSnapshots(runGit, root, config.refNamespace, config.max, root);
			}
			return snapshot;
		});

	const list = (root: string): Promise<Snapshot[]> =>
		listSnapshots(runGit, root, configFor(root).refNamespace, { root });

	const plan = (root: string, target: Snapshot, paths?: readonly string[]): Promise<PlanResult> =>
		queue.enqueue(async () => {
			if (!belongsToRoot(target, root)) return { ok: false, reason: foreignRootReason(target, root) };
			return planRestore({ runGit }, { root, indexFile: await indexStore.pathFor(root), target, paths });
		});

	const restore = (
		ctx: ExtensionContext,
		root: string,
		target: Snapshot,
		config: RewindConfig,
		paths?: readonly string[],
	): Promise<RestoreSummary> =>
		queue.enqueue(async () => {
			if (!belongsToRoot(target, root)) throw new Error(foreignRootReason(target, root));
			const indexFile = await indexStore.pathFor(root);
			const input: RestoreInput = { root, indexFile, target, paths };
			let safety: string | undefined;
			if (config.safetySnapshot) {
				const before = await createSnapshot(
					{ runGit },
					{
						root,
						indexFile,
						namespace: config.refNamespace,
						reason: "pre-restore",
						includeUntracked: config.includeUntracked,
						sessionId: ctx.sessionManager.getSessionId(),
						entryId: lastUserEntryId(ctx.sessionManager.getBranch()),
					},
				);
				safety = before.id;
			}
			const summary = await applyRestore({ runGit }, input);
			return { ...summary, safety };
		});

	const sweepStaleIndexes = async (ctx: ExtensionContext): Promise<void> => {
		try {
			const root = await rootFor(ctx);
			if (root) await indexStore.sweep(root);
		} catch {
			// Best-effort cleanup; never fail a session start.
		}
	};

	return {
		rootFor,
		configFor,
		snapshot,
		list,
		plan,
		restore,
		setStatus: status.set,
		clearStatus: status.clear,
		releaseIndexes: indexStore.release,
		sweepStaleIndexes,
		invalidate: () => {
			configCache.clear();
			rootCache.clear();
		},
	};
}
