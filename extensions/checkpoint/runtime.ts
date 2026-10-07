/**
 * Runtime services shared by the checkpoint tool, command, and event wiring.
 *
 * Owns the effective root, the config cache, the temporary index file, a
 * serialized git runner (so `GIT_INDEX_FILE` mutation cannot interleave), and
 * the status chip. Snapshot and restore are serialized; read-only listings are
 * not, because they never set the temporary index.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type CheckpointConfig } from "./config.ts";
import { gitDir, repoRoot, type RunGit, type RunGitOptions } from "./git.ts";
import { applyRestore, planRestore, type PlanResult, type RestoreInput } from "./restore.ts";
import { createCheckpoint } from "./snapshot.ts";
import { deleteCheckpoints, getCheckpoint, listCheckpoints, pruneCheckpoints } from "./store.ts";
import type { Checkpoint, CheckpointReason, RestoreSummary } from "./types.ts";

const STATUS_KEY = "checkpoint";
const SNAPSHOT_TIMEOUT_MS = 30_000;

export interface SnapshotOptions {
	reason: CheckpointReason;
	label?: string;
	tool?: string;
	turn?: number;
}

export interface CheckpointRuntime {
	/** Working directory the effective root resolves from. */
	effectiveCwd(ctx: ExtensionContext): string;
	/** Repository (or worktree) root, or undefined outside a repository. */
	rootFor(ctx: ExtensionContext): Promise<string | undefined>;
	configFor(root: string): CheckpointConfig;
	/** Create and store a checkpoint of the current working tree. */
	snapshot(ctx: ExtensionContext, options: SnapshotOptions): Promise<Checkpoint>;
	list(root: string, all: boolean): Promise<Checkpoint[]>;
	get(root: string, id: string, all: boolean): Promise<Checkpoint | undefined>;
	plan(root: string, target: Checkpoint): Promise<PlanResult>;
	restore(root: string, target: Checkpoint, config: CheckpointConfig): Promise<RestoreSummary>;
	clear(root: string, all: boolean): Promise<number>;
	/** Repaint the `⧉ N` chip from the current checkpoint count. */
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

export function createRuntime(pi: ExtensionAPI): CheckpointRuntime {
	const runGit = createRunGit(pi);
	const configCache = new Map<string, CheckpointConfig>();
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

	const effectiveCwd = (ctx: ExtensionContext): string => {
		const worktree = process.env.PI_WORKTREE_ROOT;
		return worktree && existsSync(worktree) ? worktree : ctx.cwd;
	};

	const rootFor = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const cwd = effectiveCwd(ctx);
		if (rootCache.has(cwd)) return rootCache.get(cwd);
		// Not serialized: this never sets the temporary index.
		const root = await repoRoot(runGit, cwd);
		rootCache.set(cwd, root);
		return root;
	};

	const configFor = (root: string): CheckpointConfig => {
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
		const file = join(selfDir, `checkpoint-index-${process.pid}`);
		indexCache.set(root, file);
		return file;
	};

	const snapshot = (ctx: ExtensionContext, options: SnapshotOptions): Promise<Checkpoint> =>
		enqueue(async () => {
			const root = await rootFor(ctx);
			if (!root) throw new Error("not inside a git repository.");
			const config = configFor(root);
			const checkpoint = await createCheckpoint(
				{ runGit },
				{
					root,
					indexFile: await indexFileFor(root),
					namespace: config.refNamespace,
					reason: options.reason,
					label: options.label,
					tool: options.tool,
					turn: options.turn,
					includeUntracked: config.includeUntracked,
				},
			);
			if (config.autoPrune) {
				await pruneCheckpoints(runGit, root, config.refNamespace, config.max, root);
			}
			return checkpoint;
		});

	const list = (root: string, all: boolean): Promise<Checkpoint[]> =>
		listCheckpoints(runGit, root, configFor(root).refNamespace, all ? {} : { root });

	const get = (root: string, id: string, all: boolean): Promise<Checkpoint | undefined> =>
		getCheckpoint(runGit, root, configFor(root).refNamespace, id, all ? {} : { root });

	const plan = (root: string, target: Checkpoint): Promise<PlanResult> =>
		enqueue(async () => planRestore({ runGit }, { root, indexFile: await indexFileFor(root), target }));

	const restore = (root: string, target: Checkpoint, config: CheckpointConfig): Promise<RestoreSummary> =>
		enqueue(async () => {
			const indexFile = await indexFileFor(root);
			const input: RestoreInput = { root, indexFile, target };
			let safety: string | undefined;
			if (config.safetyCheckpoint) {
				const before = await createCheckpoint(
					{ runGit },
					{
						root,
						indexFile,
						namespace: config.refNamespace,
						reason: "pre-restore",
						tool: "checkpoint",
						includeUntracked: config.includeUntracked,
					},
				);
				safety = before.id;
			}
			const summary = await applyRestore({ runGit }, input);
			return { ...summary, safety };
		});

	const clear = async (root: string, all: boolean): Promise<number> => {
		const config = configFor(root);
		const checkpoints = await listCheckpoints(runGit, root, config.refNamespace, all ? {} : { root });
		return deleteCheckpoints(runGit, root, checkpoints);
	};

	const setStatus = async (ctx: ExtensionContext): Promise<void> => {
		try {
			const root = await rootFor(ctx);
			if (!root) return;
			const config = configFor(root);
			if (!config.showStatus) return;
			const count = (await listCheckpoints(runGit, root, config.refNamespace, { root })).length;
			if (count === 0) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			// No space between glyph and count: the status bar compacts each status
			// to its first whitespace-delimited token, and `⟲ 2` would collapse to a
			// bare `⟲`. `⟲` also avoids colliding with the worktree icon `⧉`.
			const label = `⟲${count}`;
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
		get,
		plan,
		restore,
		clear,
		setStatus,
		clearStatus,
		invalidate: () => {
			configCache.clear();
			rootCache.clear();
			indexCache.clear();
		},
	};
}
