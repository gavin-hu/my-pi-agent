/**
 * Unified-diff text to lines tagged by role and line number.
 *
 * Pure: no git, no filesystem, no HTML. The provider runs the command and hands this
 * its stdout, `render.ts` turns the result into page markup, so a parser case needs
 * no process and a page case needs no parser stub.
 */

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
