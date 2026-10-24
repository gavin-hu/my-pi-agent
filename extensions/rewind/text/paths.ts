/**
 * The changed paths a rewind can restore, and how the picker groups them.
 *
 * `git diff --name-status <snapshot> <working tree>` is the one source of truth:
 * the preview, the checklist, and the apply step all read this list, so they
 * cannot disagree about what changed. Pure: parsing, grouping, marks, and the
 * counts `RestoreSummary` reports.
 *
 * A rename arrives as `R100\told\tnew` and stays one entry: `path` is the
 * destination, `from` the path it had in the snapshot, and the mark is `R`.
 * Keeping both sides on one entry is what makes a single selection atomic — the
 * restore recreates `from` and deletes `path`, so neither side can be left
 * behind. `entryPaths` is the one place that names both.
 */

/** The single-path statuses, which never carry a source path. */
type SimpleChange = "modified" | "deleted" | "added";

/** What a restore does to one path. */
export type PathChange = SimpleChange | "renamed";

/** Fields every changed path carries. */
interface ChangedPathBase {
	/** Repository-relative path, as git reports it; a rename's destination. */
	path: string;
}

/** One path the snapshot differs on, and how. A rename always names its source. */
export type ChangedPath =
	| (ChangedPathBase & { change: SimpleChange })
	| (ChangedPathBase & { change: "renamed"; from: string });

/** The trailing mark for each change in the checklist. */
export const SELECTION_MARKS: Readonly<Record<PathChange, string>> = {
	modified: "M",
	deleted: "D",
	added: "A",
	renamed: "R",
};

/** One directory's files, for the checklist's grouping. */
export interface PathGroup {
	/** Directory relative to the root; `""` for files at the root. */
	dir: string;
	/** The group's files, sorted by path. */
	paths: ChangedPath[];
}

/** The status letter → change kind, for the single-path statuses. */
function changeOf(letter: string): SimpleChange | undefined {
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
 * Parse `git diff --name-status` output. A rename keeps both of its paths on
 * one entry and a copy becomes its destination only — the source is untouched,
 * so it is not a changed path. An unknown status letter is skipped rather than
 * guessed at.
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
			if (letter === "R") changed.push({ path: second, change: "renamed", from: first });
			else changed.push({ path: second, change: "added" });
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
 * Every path an entry spans: both sides of a rename, otherwise just its path.
 * A restore and a diff request both use this, so one selection covers the move.
 */
export function entryPaths(entry: ChangedPath): string[] {
	return entry.change === "renamed" ? [entry.from, entry.path] : [entry.path];
}

/**
 * The counts the plan and the summary report: `changed` is every path rewritten
 * from the snapshot (modified, deleted, or a rename's source), and `removed` is
 * the paths created after it, which the restore deletes. A rename counts once:
 * it is one file changed, and its destination is removed as part of the move
 * rather than counted a second time.
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

/** Line counts for one path, or nulls when git reports a binary change. */
export interface PathStat {
	/** Added lines, or null when git reports `-` (binary). */
	added: number | null;
	/** Removed lines, or null when git reports `-` (binary). */
	removed: number | null;
}

/** A changed path with the line counts the review list shows. */
export type ReviewEntry = ChangedPath & {
	added: number | null;
	removed: number | null;
};

/**
 * Parse `git diff --numstat` output into a path -> line-count map.
 *
 * Counts are `-` for a binary file, which becomes null so the screen can say
 * `bin` instead of inventing a zero. A malformed line is skipped rather than
 * guessed at, and the path is the rest of the line so a path containing a tab
 * survives the split.
 */
export function parseNumStat(stdout: string): Map<string, PathStat> {
	const stats = new Map<string, PathStat>();
	for (const line of stdout.split("\n")) {
		if (line.trim() === "") continue;
		const [addedRaw, removedRaw, ...rest] = line.split("\t");
		const path = rest.join("\t");
		if (addedRaw === undefined || removedRaw === undefined || path === "") continue;
		const added = addedRaw === "-" ? null : Number.parseInt(addedRaw, 10);
		const removed = removedRaw === "-" ? null : Number.parseInt(removedRaw, 10);
		if (added !== null && !Number.isFinite(added)) continue;
		if (removed !== null && !Number.isFinite(removed)) continue;
		stats.set(path, { added, removed });
	}
	return stats;
}

/**
 * Attach line counts to changed paths and sort them for a stable screen order.
 * Line counts are read with `--no-renames`, so a rename's `+n` lives on its
 * destination and its `−n` on its source.
 */
export function toReviewEntries(paths: readonly ChangedPath[], stats: ReadonlyMap<string, PathStat>): ReviewEntry[] {
	const countsOf = (entry: ChangedPath): PathStat => {
		const destination = stats.get(entry.path);
		const source = entry.change === "renamed" ? stats.get(entry.from) : undefined;
		return {
			added: destination?.added ?? null,
			removed: (source ?? destination)?.removed ?? null,
		};
	};
	return [...paths].sort((a, b) => a.path.localeCompare(b.path)).map((entry) => ({ ...entry, ...countsOf(entry) }));
}
