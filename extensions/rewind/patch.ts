/**
 * A single-file unified diff split into its header and hunks.
 *
 * `/review` shows one file's patch and can revert a chosen subset of its hunks.
 * The raw patch is what `git apply` consumes, so the parser separates the header
 * and each hunk without rewriting them: line bodies keep their exact bytes,
 * including a trailing `\r` or a `\ No newline at end of file` marker.
 *
 * Only a textual, single-file patch is accepted. A binary patch, a mode-only
 * change, and a multi-file patch all return `undefined`, so a caller cannot
 * reverse-apply something the builder cannot reproduce faithfully.
 *
 * Pure: no git, no terminal, no filesystem.
 */

/** One unified-diff hunk, header included. */
export interface Hunk {
	/** The `@@ -a,b +c,d @@` line. */
	header: string;
	/** Body lines, each starting with ` `, `+`, `-`, or `\`. */
	lines: string[];
	/** Lines the hunk adds. */
	added: number;
	/** Lines the hunk removes. */
	removed: number;
}

/** A single-file patch: the file header and its hunks. */
export interface FilePatch {
	/** Lines before the first hunk: `diff --git`, `index`, `---`, `+++`. */
	header: string[];
	hunks: Hunk[];
}

/** Prefix that starts a hunk. */
const HUNK_PREFIX = "@@ ";

/**
 * Parse a one-file unified diff, or `undefined` when it has no textual hunks or
 * spans more than one file.
 */
export function parseFilePatch(text: string): FilePatch | undefined {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();

	const header: string[] = [];
	const hunks: Hunk[] = [];
	let current: Hunk | undefined;

	for (const line of lines) {
		if (line.startsWith(HUNK_PREFIX)) {
			if (current) hunks.push(current);
			current = { header: line, lines: [], added: 0, removed: 0 };
			continue;
		}
		if (!current) {
			// A second file starts with `diff --git` after the first header.
			if (line.startsWith("diff --git ") && header.length > 0) return undefined;
			header.push(line);
			continue;
		}
		if (line.startsWith("diff --git ")) return undefined;
		current.lines.push(line);
		if (line.startsWith("+")) current.added++;
		else if (line.startsWith("-")) current.removed++;
	}

	if (current) hunks.push(current);
	if (hunks.length === 0) return undefined;
	if (!header.some((line) => line.startsWith("diff --git "))) return undefined;
	if (!header.some((line) => line.startsWith("+++ "))) return undefined;
	return { header, hunks };
}

/**
 * Rebuild the patch from the chosen hunks, in source order. Out-of-range and
 * duplicate indices are dropped, so a stale selection cannot duplicate context.
 */
export function buildHunkPatch(patch: FilePatch, indices: readonly number[]): string {
	const chosen = [...new Set(indices)]
		.filter((index) => index >= 0 && index < patch.hunks.length)
		.sort((a, b) => a - b);
	const selected = chosen.flatMap((index) => {
		const hunk = patch.hunks[index];
		return hunk === undefined ? [] : [hunk.header, ...hunk.lines];
	});
	return [...patch.header, ...selected, ""].join("\n");
}
