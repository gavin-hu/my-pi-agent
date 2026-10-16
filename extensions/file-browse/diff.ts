/**
 * Pure parsing for the git diff view.
 *
 * Turns unified-diff text and `git status --porcelain=v1 -z` output into plain
 * view models. No git, no filesystem, no HTML: `git.ts` runs the commands and
 * `html.ts` renders the result, so the parser can be tested in isolation.
 */

/** The three comparison scopes the diff view offers. */
export type DiffMode = "head" | "staged" | "worktree";

/** Every valid mode, in segmented-control order. */
export const DIFF_MODES: readonly DiffMode[] = ["head", "staged", "worktree"];

/** Whether an untrusted query value names a mode. */
export function isDiffMode(value: string | null | undefined): value is DiffMode {
	return value === "head" || value === "staged" || value === "worktree";
}

/**
 * Revision arguments for `git diff` for a mode, placed before `--`.
 * `head` compares the working tree and index against the commit; `staged`
 * compares the index against the commit; `worktree` compares the working tree
 * against the index.
 */
export function diffArgs(mode: DiffMode): string[] {
	if (mode === "staged") return ["--cached"];
	if (mode === "worktree") return [];
	return ["HEAD"];
}

/** A line's role in a unified diff. */
export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx" | "note";

export interface DiffLine {
	kind: DiffLineKind;
	/** Content without the leading marker for add/del/ctx; raw text otherwise. */
	text: string;
	/** Old-file line number, when the line exists on that side. */
	oldNo?: number;
	/** New-file line number, when the line exists on that side. */
	newNo?: number;
}

export interface ParsedDiff {
	lines: DiffLine[];
	/** True when `maxLines` cut the diff short. */
	truncated: boolean;
	/** True for a binary diff (`Binary files … differ` / `GIT binary patch`). */
	binary: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A line git emits for a binary change; there is no text diff to show. */
const BINARY_LINE = /^(?:Binary files .* differ|GIT binary patch)$/;

/**
 * Parse unified-diff text into lines tagged by role and line number.
 *
 * `---` / `+++` are treated as file metadata only before the first hunk, so a
 * removed line whose content itself begins with `--` still reads as a deletion.
 * A trailing newline is not a line; `maxLines` bounds the result and sets
 * `truncated`.
 */
export function parseUnifiedDiff(text: string, maxLines: number): ParsedDiff {
	const raw = text.split("\n");
	if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
	const truncated = raw.length > maxLines;
	const lines: DiffLine[] = [];
	let binary = false;
	let inHunk = false;
	let oldNo = 0;
	let newNo = 0;

	for (let line of truncated ? raw.slice(0, maxLines) : raw) {
		if (line.endsWith("\r")) line = line.slice(0, -1);

		const hunk = HUNK_HEADER.exec(line);
		if (hunk) {
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			inHunk = true;
			lines.push({ kind: "hunk", text: line });
			continue;
		}

		if (inHunk) {
			if (line.startsWith("\\ ")) {
				lines.push({ kind: "note", text: line });
			} else if (line.startsWith("+")) {
				lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
			} else if (line.startsWith("-")) {
				lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
			} else if (line.startsWith(" ") || line === "") {
				lines.push({
					kind: "ctx",
					text: line.startsWith(" ") ? line.slice(1) : "",
					oldNo: oldNo++,
					newNo: newNo++,
				});
			} else {
				// A new file block (`diff --git …`) closes the hunk.
				inHunk = false;
				if (BINARY_LINE.test(line)) binary = true;
				lines.push({ kind: line.startsWith("\\ ") ? "note" : "meta", text: line });
			}
			continue;
		}

		if (BINARY_LINE.test(line)) binary = true;
		lines.push({ kind: line.startsWith("\\ ") ? "note" : "meta", text: line });
	}

	return { lines, truncated, binary };
}

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
