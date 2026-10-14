/**
 * Changelog section extractor for the release flow.
 *
 * `gh release create --notes-file` wants one version's changelog section,
 * heading included. Doing that with a hand-written `awk` in the release docs is
 * easy to get subtly wrong (the next `## [` line, the trailing blank lines), so
 * the logic lives here and the docs call this script instead.
 *
 * Usage: `bun run release:notes X.Y.Z` writes the section to stdout.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHANGELOG = join(import.meta.dir, "..", "CHANGELOG.md");

/** A new `## [anything]` heading, or a `[anything]: url` link reference. */
const STOP = /^(?:## \[[^\]]+\]|\[[^\]]+\]:)/;

/**
 * The changelog section for `version`, heading included, stopping at the next
 * heading or at the link references at the bottom, with trailing blank lines
 * trimmed. The heading is matched exactly, so `0.6.1` does not match
 * `## [0.6.10]`. Returns undefined when no such section exists.
 */
export function changelogSection(markdown: string, version: string): string | undefined {
	const lines = markdown.split("\n");
	const heading = `## [${version}]`;
	const start = lines.findIndex(
		(line) => line.startsWith(heading) && (line.length === heading.length || line[heading.length] === " "),
	);
	if (start === -1) return undefined;

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (STOP.test(lines[i])) {
			end = i;
			break;
		}
	}
	while (end > start && lines[end - 1].trim() === "") end--;

	return `${lines.slice(start, end).join("\n")}\n`;
}

if (import.meta.main) {
	const version = process.argv[2];
	if (version === undefined || version.trim() === "") {
		console.error("usage: bun run release:notes X.Y.Z");
		process.exit(1);
	}
	const section = changelogSection(readFileSync(CHANGELOG, "utf-8"), version.trim());
	if (section === undefined) {
		console.error(`CHANGELOG.md has no "## [${version.trim()}]" section`);
		process.exit(1);
	}
	process.stdout.write(section);
}
