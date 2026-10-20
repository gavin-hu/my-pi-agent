/**
 * The `allow:<name>` opt-out the package-level scans share.
 *
 * A guard reads best when a genuine exception is stated where the reason
 * belongs: on the line, or in the comment block that already explains it. The
 * two scans that own a data allowlist (`structure`, `drift`) read the same
 * marker so a maintainer has one rule to remember.
 */

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Whether `marker` appears on that line or in the comment block directly above
 * it, walking up until the block ends.
 */
export function allowsAt(lines: string[], index: number, marker: string): boolean {
	if (lines[index]?.includes(marker) === true) return true;
	for (let above = index - 1; above >= 0; above--) {
		const line = lines[above] ?? "";
		if (!COMMENT_LINE.test(line)) return false;
		if (line.includes(marker)) return true;
	}
	return false;
}
