/**
 * `git status --porcelain=v1 -z` to changed paths, and the rollups a page marks with.
 *
 * Pure: the provider runs the command and hands this its stdout. `statusLetter` reads
 * the one character a change list draws, `inMode` asks whether a path belongs in a
 * scope's list, and `changeDirs` answers which directories hold a change, so a listing
 * or a tree marks a folder without walking its subtree.
 */

import type { DiffMode } from "./modes.ts";

/** One changed path from `git status --porcelain=v1 -z`. */
export interface ChangedFile {
	/** Root-relative, posix-style path. */
	rel: string;
	/** Original path for a rename or copy. */
	origRel?: string;
	/** Index (staged) status character; `" "` when unchanged there. */
	index: string;
	/** Worktree (unstaged) status character; `" "` when unchanged there. */
	worktree: string;
	/** Both status characters are `?`, so the path is untracked. */
	untracked: boolean;
}

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * NUL-delimited records survive spaces and newlines in a path. A rename or copy
 * (`R`/`C` in either column) carries the new path first and the original path as
 * the next field; the destination is the entry's `rel`.
 */
export function parseStatusZ(stdout: string): ChangedFile[] {
	const tokens = stdout.split("\0");
	const files: ChangedFile[] = [];
	for (let index = 0; index < tokens.length; index++) {
		const entry = tokens[index];
		if (entry.length < 3 || entry[2] !== " ") continue;
		const x = entry[0];
		const y = entry[1];
		const untracked = x === "?" && y === "?";
		const file: ChangedFile = { rel: entry.slice(3), index: x, worktree: y, untracked };
		if (x === "R" || x === "C" || y === "R" || y === "C") {
			const original = tokens[++index] ?? "";
			if (original) file.origRel = original;
		}
		files.push(file);
	}
	return files;
}

/** The single status letter shown in the change list. */
export function statusLetter(file: ChangedFile): string {
	if (file.untracked) return "?";
	return file.index !== " " ? file.index : file.worktree;
}

/** Whether a changed path belongs in a mode's list. */
export function inMode(file: ChangedFile, mode: DiffMode): boolean {
	if (mode === "staged") return !file.untracked && file.index !== " " && file.index !== "?";
	if (mode === "worktree") return file.untracked || (file.worktree !== " " && file.worktree !== "?");
	return true;
}

/**
 * The ancestor directories of every changed path, root-relative. A directory in
 * this set contains a change, which lets a listing or tree mark it without
 * walking its subtree.
 */
export function changeDirs(files: readonly ChangedFile[]): Set<string> {
	const dirs = new Set<string>();
	for (const file of files) {
		const parts = file.rel.split("/");
		let prefix = "";
		for (let index = 0; index < parts.length - 1; index++) {
			prefix = prefix ? `${prefix}/${parts[index]}` : parts[index];
			dirs.add(prefix);
		}
	}
	return dirs;
}
