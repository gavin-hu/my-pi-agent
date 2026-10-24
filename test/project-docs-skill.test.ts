/**
 * The `project-docs` skill's changelog state script.
 *
 * The script exists because the counting half of an audit should not be the model's
 * memory of `git log` flags. Its parse is pure, so every finding the report prints is
 * asserted here against a fixture rather than against this repository's changelog,
 * which changes with every release.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { findChangelog, formatState, gitFacts, MAX_SCOPES, readState } from "../skills/project-docs/scripts/state.ts";
import { tempDir } from "./helpers/env.ts";

const FIXTURE = `# Changelog

All notable changes are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- \`core\`: a bullet with a scope.
- \`cli\`: a bullet that wraps onto a second
  line, which is still one bullet.

### Changed

- a bullet with no scope at all

### Fixed

### Fixed

## [0.2.0] - 2025-01-01

### Added

- \`core\`: something that has shipped.

\`\`\`text
## not a section, and ### not a category
- \`nope\`: a bullet in a code fence
\`\`\`

[Unreleased]: https://example.test/compare/v0.2.0...HEAD
`;

/** The 1-based lines a fixture line sits on, so an assertion names the file's shape. */
function linesOf(text: string, needle: string): number[] {
	return text.split("\n").flatMap((line, index) => (line === needle ? [index + 1] : []));
}

/** The 1-based line of the first occurrence, for a heading a fixture uses once. */
function lineOf(text: string, needle: string): number {
	return linesOf(text, needle)[0];
}

describe("findChangelog", () => {
	test("returns nothing for a directory with no changelog", () => {
		expect(findChangelog(tempDir("changelog-none-"))).toBeUndefined();
	});

	test("prefers the name this format is written under", () => {
		const dir = tempDir("changelog-both-");
		for (const name of ["HISTORY.md", "CHANGELOG.md", "NEWS.md"]) writeFileSync(join(dir, name), "# Changelog\n");
		expect(findChangelog(dir)).toBe(join(dir, "CHANGELOG.md"));
	});

	test("finds a changelog kept in docs/", () => {
		const dir = tempDir("changelog-docs-");
		mkdirSync(join(dir, "docs"));
		writeFileSync(join(dir, "docs", "CHANGELOG.md"), "# Changelog\n");
		expect(findChangelog(dir)).toBe(join(dir, "docs", "CHANGELOG.md"));
	});
});

describe("readState", () => {
	const state = readState(FIXTURE);

	test("reads the preamble's two conventions together", () => {
		expect(state.keepAChangelog).toBe(true);
		expect(readState("# Changelog\n\n## [Unreleased]\n").keepAChangelog).toBe(false);
	});

	test("locates the unreleased section and counts its bullets", () => {
		expect(state.unreleased?.line).toBe(lineOf(FIXTURE, "## [Unreleased]"));
		expect(state.unreleased?.bullets).toBe(3);
	});

	test("keeps the categories in file order, spelling included", () => {
		const fixed = linesOf(FIXTURE, "### Fixed");
		expect(state.unreleased?.categories).toEqual([
			{ name: "Added", line: lineOf(FIXTURE, "### Added"), bullets: 2 },
			{ name: "Changed", line: lineOf(FIXTURE, "### Changed"), bullets: 1 },
			{ name: "Fixed", line: fixed[0], bullets: 0 },
			{ name: "Fixed", line: fixed[1], bullets: 0 },
		]);
	});

	test("reads a dated heading as a version, and a fence as no heading", () => {
		expect(state.dated).toEqual([{ version: "0.2.0", line: lineOf(FIXTURE, "## [0.2.0] - 2025-01-01") }]);
	});

	test("finds a category repeated within one section, not across releases", () => {
		expect(state.duplicates).toEqual([{ name: "Fixed", lines: linesOf(FIXTURE, "### Fixed") }]);
		expect(readState("# C\n\n## [Unreleased]\n\n### Fixed\n\n## [0.1.0]\n\n### Fixed\n").duplicates).toEqual([]);
	});

	test("counts scope prefixes by frequency", () => {
		expect(state.scopes).toEqual([
			{ name: "core", count: 2 },
			{ name: "cli", count: 1 },
		]);
	});

	test("reports the link references, and the versions that lack one", () => {
		expect(state.refs).toEqual({ unreleased: true, dated: 1, missing: ["0.2.0"] });
		expect(readState("# C\n\n## [Unreleased]\n\n[Unreleased]: https://x/compare/v0.1.0...HEAD\n").refs).toEqual({
			unreleased: true,
			dated: 0,
			missing: [],
		});
	});

	test("says so when there is no unreleased section", () => {
		expect(readState("# C\n\n## [0.1.0]\n").unreleased).toBeUndefined();
	});
});

describe("formatState", () => {
	const state = readState(FIXTURE);

	test("prints the file, the window, and the section in the order an audit uses them", () => {
		const report = formatState("CHANGELOG.md", state, { tag: "v0.1.0", commits: ["abc1234 one change"] }).split("\n");
		expect(report[0]).toBe("changelog   CHANGELOG.md · Keep a Changelog preamble");
		expect(report[1]).toBe("last tag    v0.1.0 · 1 commit since, merges skipped");
		expect(report[2]).toBe(`unreleased  line ${lineOf(FIXTURE, "## [Unreleased]")} · 3 bullets`);
		expect(report[3]).toBe("categories  Added 2 · Changed 1 · Fixed 0 · Fixed 0   (file order)");
		expect(report[4]).toBe("empty       Fixed · Fixed");
		expect(report[5]).toBe(`duplicate   Fixed at lines ${linesOf(FIXTURE, "### Fixed").join(", ")}`);
		expect(report[7]).toBe("refs        [Unreleased] yes · dated refs 0/1, missing 0.2.0");
		expect(report[8]).toBe("commits since v0.1.0");
		expect(report[9]).toBe("  abc1234 one change");
	});

	test("names a missing section instead of printing an empty one", () => {
		const report = formatState("CHANGELOG.md", readState("# C\n"), { commits: [] });
		expect(report).toContain("unreleased  missing");
	});

	test("reports a repository it could not read, and a tag it does not have", () => {
		expect(formatState("CHANGELOG.md", state, { commits: [], note: "not a git repository" })).toContain(
			"last tag    not a git repository",
		);
		expect(formatState("CHANGELOG.md", state, { commits: [], note: "no tags" })).toContain("last tag    no tags");
	});

	test("caps the commit list and the scope line", () => {
		const commits = Array.from({ length: 45 }, (_, index) => `abc${index} change ${index}`);
		const report = formatState("CHANGELOG.md", state, { tag: "v1.0.0", commits });
		expect(report).toContain("… 5 more");
		expect(report.split("\n").filter((line) => line.startsWith("  abc"))).toHaveLength(40);

		const many = readState(
			`## [Unreleased]\n\n${Array.from({ length: 9 }, (_, index) => `- \`s${index}\`: a bullet`).join("\n")}\n`,
		);
		expect(formatState("CHANGELOG.md", many, { commits: [] })).toContain(`· … ${9 - MAX_SCOPES} more`);
	});
});

describe("gitFacts", () => {
	test("reports a directory outside a repository rather than failing", () => {
		expect(gitFacts(tempDir("changelog-git-"))).toEqual({ commits: [], note: "not a git repository" });
	});
});
