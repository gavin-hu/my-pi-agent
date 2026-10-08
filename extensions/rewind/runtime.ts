/**
 * Runtime services shared by the command and event wiring.
 *
 * Owns the effective root, the config cache, the temporary index file, a
 * serialized git runner (so `GIT_INDEX_FILE` mutation cannot interleave), and
 * the status chip. Snapshot and restore are serialized; read-only listings are
 * not, because they never set the temporary index.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../_shared/worktree-env.ts";
import { loadConfig, type RewindConfig } from "./config.ts";
import { gitDir, repoRoot, type RunGit, type RunGitOptions } from "./git.ts";
import { applyRestore, planRestore, type PlanResult, type RestoreInput } from "./restore.ts";
import { createSnapshot } from "./snapshot.ts";
import { listSnapshots, pruneSnapshots } from "./store.ts";
import { buildRewindPoints, lastUserEntryId } from "./timeline.ts";
import type { Snapshot, SnapshotReason, RestoreSummary } from "./types.ts";

// The status chip is defined locally so this extension stays self-contained.
const STATUS_KEY = "rewind";
const STATUS_GLYPH = "↺";
const SNAPSHOT_TIMEOUT_MS = 30_000;

export interface SnapshotOptions {
	reason: SnapshotReason;
	label?: string;
	prompt?: string;
}

export interface RewindRuntime {
	/** Working directory the effective root resolves from. */
	effectiveCwd(ctx: ExtensionContext): string;
	/** Repository (or worktree) root, or undefined outside a repository. */
	rootFor(ctx: ExtensionContext): Promise<string | undefined>;
	configFor(root: string): RewindConfig;
	/** Create and store a snapshot of the current working tree. */
	snapshot(ctx: ExtensionContext, options: SnapshotOptions): Promise<Snapshot>;
	list(root: string, all: boolean): Promise<Snapshot[]>;
	plan(root: string, target: Snapshot): Promise<PlanResult>;
	restore(ctx: ExtensionContext, root: string, target: Snapshot, config: RewindConfig): Promise<RestoreSummary>;
	/** Repaint the `↺ N` chip from the rewindable-prompt count on the active branch. */
	setStatus(ctx: ExtensionContext): Promise<void>;
	clearStatus(ctx: ExtensionContext): void;
	/** Drop cached roots, config, and index paths (on session start). */
	invalidate(): void;
}

/** Production runner: `pi.exec` has no `env`, so set the temp index on process.env. */
function createRunGit(pi: ExtensionAPI): RunGit {
	return async (args: string[], options: RunGitOptions) => {
		const saved: Array<[string, string | undefined]> = [];
		if (options.env) {
			for (const [key, value] of Object.entries(options.env)) {
				saved.push([key, process.env[key]]);
				process.env[key] = value;
			}
		}
		try {
			const result = await pi.exec("git", args, {
				cwd: options.cwd,
				timeout: options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS,
			});
			return { stdout: result.stdout, stderr: result.stderr, code: result.code, killed: result.killed };
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	};
}

export function createRuntime(pi: ExtensionAPI): RewindRuntime {
	const runGit = createRunGit(pi);
	const configCache = new Map<string, RewindConfig>();
	const rootCache = new Map<string, string | undefined>();
	const indexCache = new Map<string, string>();

	// One queue for operations that stage through a temporary index, since
	// `GIT_INDEX_FILE` lives on process.env for the duration of a call.
	let tail: Promise<unknown> = Promise.resolve();
	function enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const next = tail.then(fn, fn);
		tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

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

	const indexFileFor = async (root: string): Promise<string> => {
		const cached = indexCache.get(root);
		if (cached) return cached;
		const dir = await gitDir(runGit, root);
		const selfDir = join(dir ?? join(root, ".git"), "pi");
		mkdirSync(selfDir, { recursive: true });
		const file = join(selfDir, `rewind-index-${process.pid}`);
		indexCache.set(root, file);
		return file;
	};

	const snapshot = (ctx: ExtensionContext, options: SnapshotOptions): Promise<Snapshot> =>
		enqueue(async () => {
			const root = await rootFor(ctx);
			if (!root) throw new Error("not inside a git repository.");
			const config = configFor(root);
			const snapshot = await createSnapshot(
				{ runGit },
				{
					root,
					indexFile: await indexFileFor(root),
					namespace: config.refNamespace,
					reason: options.reason,
					label: options.label,
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

	const list = (root: string, all: boolean): Promise<Snapshot[]> =>
		listSnapshots(runGit, root, configFor(root).refNamespace, all ? {} : { root });

	const plan = (root: string, target: Snapshot): Promise<PlanResult> =>
		enqueue(async () => planRestore({ runGit }, { root, indexFile: await indexFileFor(root), target }));

	const restore = (
		ctx: ExtensionContext,
		root: string,
		target: Snapshot,
		config: RewindConfig,
	): Promise<RestoreSummary> =>
		enqueue(async () => {
			const indexFile = await indexFileFor(root);
			const input: RestoreInput = { root, indexFile, target };
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

	// The chip shows how many prompts on the active branch are code-rewindable,
	// not how many snapshot refs exist for the root. Counting via
	// `buildRewindPoints` matches `/rewind` exactly: read-only prompts (no
	// snapshot), `pre-restore`/`manual` snapshots, and foreign-session snapshots
	// are all excluded.
	const setStatus = async (ctx: ExtensionContext): Promise<void> => {
		try {
			const root = await rootFor(ctx);
			if (!root) return;
			const config = configFor(root);
			if (!config.showStatus) return;
			const snapshots = await listSnapshots(runGit, root, config.refNamespace, { root });
			const session = ctx.sessionManager;
			const points = buildRewindPoints(session.getBranch(), snapshots, session.getSessionId());
			const count = points.filter((point) => point.snapshot).length;
			if (count === 0) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			// The status bar compacts a two-token icon+count badge (`↺ 2`) to
			// `↺2`, so the count survives a narrow line; `↺` also avoids colliding
			// with the worktree icon `⧉`.
			const label = `${STATUS_GLYPH} ${count}`;
			let themed = label;
			try {
				themed = ctx.ui.theme.fg("accent", label);
			} catch {
				// No initialized theme in a headless run.
			}
			ctx.ui.setStatus(STATUS_KEY, themed);
		} catch {
			// Status is best-effort.
		}
	};

	const clearStatus = (ctx: ExtensionContext): void => {
		try {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		} catch {
			// UI may be unavailable.
		}
	};

	return {
		effectiveCwd,
		rootFor,
		configFor,
		snapshot,
		list,
		plan,
		restore,
		setStatus,
		clearStatus,
		invalidate: () => {
			configCache.clear();
			rootCache.clear();
			indexCache.clear();
		},
	};
}
