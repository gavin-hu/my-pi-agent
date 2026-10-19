/**
 * The changed paths a rewind can restore, and how the picker groups them.
 *
 * `git diff --name-status <snapshot> <working tree>` is the one source of truth:
 * the preview, the checklist, and the apply step all read this list, so they
 * cannot disagree about what changed. Pure: parsing, grouping, marks, and the
 * counts `RestoreSummary` reports.
 *
 * A rename arrives as `R100\told\tnew`. It is expanded into two entries — the old
 * path as deleted and the new one as added — because that is exactly what the
 * restore does to each: selecting the old path brings it back, selecting the new
 * one removes it. Both rows appear in the checklist rather than one opaque one.
 */

/** What a restore does to one path. */
export type PathChange = "modified" | "deleted" | "added";

/** One path the snapshot differs on, and how. */
export interface ChangedPath {
	/** Repository-relative path, as git reports it. */
	path: string;
	change: PathChange;
}

/** The trailing mark for each change in the checklist. */
export const SELECTION_MARKS: Readonly<Record<PathChange, string>> = {
	modified: "M",
	deleted: "D",
	added: "A",
};

/** One directory's files, for the checklist's grouping. */
export interface PathGroup {
	/** Directory relative to the root; `""` for files at the root. */
	dir: string;
	/** The group's files, sorted by path. */
	paths: ChangedPath[];
}

/** The status letter → change kind, for the single-path statuses. */
function changeOf(letter: string): PathChange | undefined {
	switch (letter) {
		case "M":
		case "T": // a type change (file ↔ symlink) rewrites the path
			return "modified";
		case "D":
			return "deleted";
		case "A":
			return "added";
		default:
			return undefined;
	}
}

/**
 * Parse `git diff --name-status` output. A rename expands to both of its paths
 * (as described in the module comment) and a copy to its destination only — the
 * source is untouched, so it is not a changed path. An unknown status letter is
 * skipped rather than guessed at.
 */
export function parseNameStatus(stdout: string): ChangedPath[] {
	const changed: ChangedPath[] = [];
	for (const line of stdout.split("\n")) {
		if (line.trim() === "") continue;
		const [status, first, second] = line.split("\t");
		if (!status || !first) continue;
		const letter = status[0] ?? "";
		if (letter === "R" || letter === "C") {
			if (!second) continue;
			if (letter === "R") changed.push({ path: first, change: "deleted" });
			changed.push({ path: second, change: "added" });
			continue;
		}
		const kind = changeOf(letter);
		if (kind) changed.push({ path: first, change: kind });
	}
	return changed;
}

/** The directory part of a path, or `""` for the root. */
function dirOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** The file name within its directory. */
export function baseName(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Group changed paths by directory: the root first, then directories in
 * lexicographic order, files sorted inside each group. A stable order is what
 * makes the checklist's cursor predictable and the golden renders testable.
 */
export function groupPaths(paths: readonly ChangedPath[]): PathGroup[] {
	const groups = new Map<string, ChangedPath[]>();
	for (const entry of paths) {
		const dir = dirOf(entry.path);
		const group = groups.get(dir);
		if (group) group.push(entry);
		else groups.set(dir, [entry]);
	}
	return [...groups.entries()]
		.map(([dir, entries]) => ({ dir, paths: [...entries].sort((a, b) => a.path.localeCompare(b.path)) }))
		.sort((a, b) => (a.dir === "" ? -1 : b.dir === "" ? 1 : a.dir.localeCompare(b.dir)));
}

/** The paths a directory toggle selects. */
export function expandGroup(group: PathGroup): string[] {
	return group.paths.map((entry) => entry.path);
}

/**
 * The counts the plan and the summary report: `changed` is modified plus deleted
 * (files rewritten from the snapshot), and `removed` is the paths created after
 * it, which the restore deletes.
 */
export function summarize(paths: readonly ChangedPath[]): { changed: number; removed: number } {
	let changed = 0;
	let removed = 0;
	for (const entry of paths) {
		if (entry.change === "added") removed++;
		else changed++;
	}
	return { changed, removed };
}
