/**
 * The `[Unreleased]` list: which heading a card earns, how a title opens, and where its bullet goes.
 *
 * Every case here is a shape the real file holds: a section with entries, a section that is only a
 * heading, a window with no sections yet, and a window that is not `[Unreleased]`. The insertion is
 * text-to-text, so the strongest assertion — the whole file, before and after — is also the cheapest.
 */

import { describe, expect, test } from "bun:test";
import { CHANGELOG_SECTIONS, headingFor, insertBullet, lowerFirst } from "./changelog.ts";

/** A miniature changelog: `[Unreleased]` over the sections given, then a released window beneath it. */
function changelog(...sections: string[]): string {
	return [
		"# Clog",
		"",
		"## [Unreleased]",
		"",
		...sections,
		"",
		"## [0.31.0] - 2026-01-01",
		"",
		"### Added",
		"",
		"- shipped",
		"",
	].join("\n");
}

describe("the heading a card earns", () => {
	test("a feature is Added and a bug is Fixed", () => {
		expect(headingFor("feature")).toBe("Added");
		expect(headingFor("bug")).toBe("Fixed");
	});

	test("the four types that add no surface land under Changed", () => {
		for (const type of ["refactor", "docs", "test", "chore"] as const) expect(headingFor(type)).toBe("Changed");
	});

	test("a card with no type lands under Changed rather than being guessed at", () => {
		// The absence is an authoring gap: `board add` takes a `type`, so a bug filed here is a card
		// written without one. Nothing reads a title for a type, because a guess would be unchecked.
		expect(headingFor(undefined)).toBe("Changed");
	});

	test("every answer is a section the file knows", () => {
		expect(CHANGELOG_SECTIONS).toContain(headingFor("chore"));
		expect(CHANGELOG_SECTIONS).toContain(headingFor(undefined));
	});
});

describe("the first word of a bullet", () => {
	test("a plain word loses its capital, because every bullet beside it opens lowercase", () => {
		expect(lowerFirst("The landing writes the bullet")).toBe("the landing writes the bullet");
	});

	test("an article loses its capital, because neither `A` nor `An` is ever a name", () => {
		// The opener a word-length rule gets wrong: one and two letters, and a card title this board
		// really holds — "A card's `paths` are claims". A bullet is permanent once it lands.
		expect(lowerFirst("A card's paths are claims")).toBe("a card's paths are claims");
		expect(lowerFirst("An extension factory only registers")).toBe("an extension factory only registers");
	});

	test("a two-letter name keeps it, which is what protects `Pi`", () => {
		expect(lowerFirst("Pi loads each extension once")).toBe("Pi loads each extension once");
		// The residual, pinned so the header's claim stays the code's: a two-letter word that is not an
		// article is left alone, and so is the three-letter name the header names.
		expect(lowerFirst("In a landing the order is the promise")).toBe("In a landing the order is the promise");
		expect(lowerFirst("Bun installs once per worktree")).toBe("bun installs once per worktree");
	});

	test("an acronym keeps it, and so does a code span that opens the title", () => {
		expect(lowerFirst("JSON is parsed once")).toBe("JSON is parsed once");
		expect(lowerFirst("`board` is the tool")).toBe("`board` is the tool");
	});

	test("prose already in lowercase is handed back unchanged", () => {
		expect(lowerFirst("a round read puts the ids above the board")).toBe("a round read puts the ids above the board");
	});
});

describe("one bullet at the head of its list", () => {
	test("the entry goes above the one already there, and nothing else moves", () => {
		const before = changelog("### Added", "", "- older");
		expect(insertBullet(before, "Added", "- newer")).toBe(changelog("### Added", "", "- newer", "", "- older"));
	});

	test("a wrapped bullet keeps its own second line", () => {
		// The file wraps its prose on a two-space indent, and `test/release.test.ts` reads that line as
		// the bullet above it. An insertion that landed between the two would rewrite a neighbour.
		const before = changelog("### Added", "", "- older", "  and its second line");
		const after = insertBullet(before, "Added", "- newer");
		expect(after).toBe(changelog("### Added", "", "- newer", "", "- older", "  and its second line"));
	});

	test("a section that is only a heading is given its first entry under it", () => {
		const before = changelog("### Added");
		expect(insertBullet(before, "Added", "- first")).toBe(changelog("### Added", "", "- first"));
	});

	test("a section the window lacks is created where Keep a Changelog orders it", () => {
		const before = changelog("### Added", "", "- a", "", "### Removed", "", "- gone");
		expect(insertBullet(before, "Deprecated", "- old")).toBe(
			changelog("### Added", "", "- a", "", "### Deprecated", "", "- old", "", "### Removed", "", "- gone"),
		);
	});

	test("a section that belongs last becomes the window's last, keeping the gap before the next window", () => {
		const before = changelog("### Added", "", "- a");
		expect(insertBullet(before, "Fixed", "- crash")).toBe(
			changelog("### Added", "", "- a", "", "### Fixed", "", "- crash"),
		);
	});

	test("a window with no sections yet is given the one the card earns", () => {
		const before = ["# Clog", "", "## [Unreleased]", "", "## [0.31.0] - 2026-01-01", ""].join("\n");
		expect(insertBullet(before, "Added", "- first")).toBe(
			["# Clog", "", "## [Unreleased]", "", "### Added", "", "- first", "", "## [0.31.0] - 2026-01-01", ""].join("\n"),
		);
	});

	test("a file with no Unreleased window refuses rather than writing into a release", () => {
		// A released window is frozen history; a bullet written there would rewrite a version's record.
		expect(insertBullet("# Clog\n\n## [0.31.0] - 2026-01-01\n", "Added", "- late")).toBeUndefined();
	});
});
