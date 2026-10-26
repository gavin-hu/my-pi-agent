/**
 * The quick-open index: every file path under the root, to `limit`, for the palette.
 *
 * A separate walk from the tree on purpose: the palette wants paths and nothing else, and
 * it reads the whole tree once instead of per folder.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Directory names the quick-open index never walks. */
export const INDEX_IGNORED_DIRS = new Set([".git", "node_modules"]);

export interface FileIndex {
	files: string[];
	truncated: boolean;
}

/**
 * Walk `root` and collect file paths for the quick-open palette. Symlinks and
 * the ignored directories are skipped, and the walk stops at `limit` files so a
 * large tree cannot exhaust memory or time. Unreadable directories are skipped.
 */
export async function buildFileIndex(root: string, limit: number): Promise<FileIndex> {
	const files: string[] = [];
	let truncated = false;

	async function walk(absDir: string, relDir: string): Promise<void> {
		let dirents: Dirent[];
		try {
			dirents = await readdir(absDir, { withFileTypes: true });
		} catch {
			return;
		}
		dirents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		for (const dirent of dirents) {
			if (truncated) return;
			if (dirent.isSymbolicLink()) continue;
			const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				if (INDEX_IGNORED_DIRS.has(dirent.name)) continue;
				await walk(join(absDir, dirent.name), rel);
			} else if (dirent.isFile()) {
				if (files.length >= limit) {
					truncated = true;
					return;
				}
				files.push(rel);
			}
		}
	}

	await walk(root, "");
	files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
	return { files, truncated };
}

export type FileIndexProvider = () => Promise<FileIndex>;

export interface FileIndexOptions {
	/** How long a built index is reused, in ms (default 10000). */
	ttlMs?: number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
}

/** A cached `buildFileIndex` for `root`; concurrent calls share one walk. */
export function createFileIndex(root: string, limit: number, options: FileIndexOptions = {}): FileIndexProvider {
	const ttlMs = options.ttlMs ?? 10_000;
	const now = options.now ?? (() => Date.now());
	let cached: FileIndex | undefined;
	let checkedAt = 0;
	let pending: Promise<FileIndex> | undefined;
	return async () => {
		const time = now();
		if (cached && time - checkedAt < ttlMs) return cached;
		if (pending) return pending;
		pending = buildFileIndex(root, limit)
			.then((index) => {
				cached = index;
				checkedAt = now();
				return index;
			})
			.finally(() => {
				pending = undefined;
			});
		return pending;
	};
}
