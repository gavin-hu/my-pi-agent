import { describe, expect, test } from "bun:test";
import { changelogSection } from "./release-notes.ts";

/**
 * A miniature changelog with the same shape as the real one: an `Unreleased`
 * heading, two dated releases, and the link references at the bottom.
 */
const MARKDOWN = [
	"# Changelog",
	"",
	"## [Unreleased]",
	"",
	"### Added",
	"",
	"- work in progress",
	"",
	"## [1.2.0] - 2026-01-02",
	"",
	"### Added",
	"",
	"- the newer feature",
	"",
	"## [1.1.0] - 2026-01-01",
	"",
	"### Fixed",
	"",
	"- the older fix",
	"",
	"## [1.0.0] - 2025-12-31",
	"",
	"- the first release",
	"",
	"[Unreleased]: https://example.com/compare/v1.2.0...HEAD",
	"[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0",
	"",
].join("\n");

describe("changelogSection", () => {
	test("returns the section with its heading", () => {
		const section = changelogSection(MARKDOWN, "1.2.0");
		expect(section).toBe("## [1.2.0] - 2026-01-02\n\n### Added\n\n- the newer feature\n");
	});

	test("stops before the next heading", () => {
		const section = changelogSection(MARKDOWN, "1.2.0");
		expect(section).not.toContain("1.1.0");
		expect(section).not.toContain("1.0.0");
	});

	test("extracts the last section up to the link references", () => {
		const section = changelogSection(MARKDOWN, "1.0.0");
		expect(section).toBe("## [1.0.0] - 2025-12-31\n\n- the first release\n");
	});

	test("reads the Unreleased section", () => {
		expect(changelogSection(MARKDOWN, "Unreleased")).toBe("## [Unreleased]\n\n### Added\n\n- work in progress\n");
	});

	test("matches the heading exactly, not a longer version", () => {
		const markdown = "## [1.2.0] - 2026-01-02\n\nbody\n";
		expect(changelogSection(markdown, "1.2")).toBeUndefined();
		expect(changelogSection(markdown, "1.2.0.1")).toBeUndefined();
		expect(changelogSection(markdown, "1.2.0")).not.toBeUndefined();
	});

	test("returns undefined for a version that is absent", () => {
		expect(changelogSection(MARKDOWN, "9.9.9")).toBeUndefined();
	});

	test("ends the output with exactly one newline", () => {
		expect(changelogSection(MARKDOWN, "1.2.0")?.endsWith("\n\n")).toBe(false);
		expect(changelogSection(MARKDOWN, "1.2.0")?.endsWith("\n")).toBe(true);
	});
});
