/**
 * Temporary git index lifecycle for the rewind extension.
 *
 * Every staging operation uses `GIT_INDEX_FILE` pointing at a per-process index
 * under the repository's `.git/pi/` directory, so the user's real index and HEAD
 * are never touched. This module owns those paths: it creates one per root on
 * demand, deletes this process's files on shutdown, and sweeps files abandoned
 * by a process that crashed before it could clean up.
 *
 * The sweep is age-gated so a concurrent session in another process (whose
 * index has a recent mtime) is never removed out from under it.
 */

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { gitDir, type RunGit } from "./git.ts";

const INDEX_PREFIX = "rewind-index-";
const LEGACY_INDEX_PREFIX = "checkpoint-index-";
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TempIndexStore {
	/** This process's index for `root`, created on first use and stable after. */
	pathFor(root: string): Promise<string>;
	/** Delete every index this process created. */
	release(): void;
	/** Best-effort removal of stale indexes under `root` from earlier processes. */
	sweep(root: string): Promise<void>;
}

export function createTempIndexStore(runGit: RunGit): TempIndexStore {
	const indexCache = new Map<string, string>();
	// Every path this process has created, so `release` can delete all of them
	// even though the per-root cache only tracks the current mapping.
	const indexFiles = new Set<string>();

	const piDirFor = async (root: string): Promise<string> => {
		const dir = await gitDir(runGit, root);
		return join(dir ?? join(root, ".git"), "pi");
	};

	const pathFor = async (root: string): Promise<string> => {
		const cached = indexCache.get(root);
		if (cached) return cached;
		const dir = await piDirFor(root);
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${INDEX_PREFIX}${process.pid}`);
		indexCache.set(root, file);
		indexFiles.add(file);
		return file;
	};

	const release = (): void => {
		for (const file of indexFiles) {
			try {
				rmSync(file, { force: true });
			} catch {
				// A file already gone, or a read-only repo, is nothing to fix.
			}
		}
		indexFiles.clear();
		indexCache.clear();
	};

	const sweep = async (root: string): Promise<void> => {
		try {
			const dir = await piDirFor(root);
			const own = `${INDEX_PREFIX}${process.pid}`;
			const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
			for (const name of readdirSync(dir)) {
				if (name === own) continue;
				if (!name.startsWith(INDEX_PREFIX) && !name.startsWith(LEGACY_INDEX_PREFIX)) continue;
				const file = join(dir, name);
				try {
					const info = statSync(file);
					if (info.isFile() && info.mtimeMs < cutoff) rmSync(file, { force: true });
				} catch {
					// Raced with another process; leave it for the next sweep.
				}
			}
		} catch {
			// No repository, no pi dir, or no permission: nothing to sweep.
		}
	};

	return { pathFor, release, sweep };
}
