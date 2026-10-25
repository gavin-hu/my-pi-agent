/**
 * The plan-document section scan: the one fence-aware view plan mode reads a
 * document through.
 */

import { describe, expect, test } from "bun:test";
import { extractSections, sectionKeys } from "./sections.ts";

const PLAN = `# Title

Intro paragraph.

## Steps

- [ ] one

## Appendix

A note.

- evidence

## Verification

    bun run check
`;

describe("extractSections", () => {
	test("splits at headings, keeping the preamble", () => {
		const sections = extractSections(PLAN);
		expect(sections.map((section) => section.title)).toEqual(["Title", "Steps", "Appendix", "Verification"]);
		expect(sections[0]?.line).toBe(0);
	});

	test("a heading inside a fence is not a heading", () => {
		const plan = ["# T", "", "```sh", "# not a heading", "```", "", "## After"].join("\n");
		expect(extractSections(plan).map((section) => section.title)).toEqual(["T", "After"]);
	});

	test("keeps each section's raw lines", () => {
		const appendix = extractSections(PLAN).find((section) => section.title === "Appendix");
		expect(appendix?.text).toStartWith("## Appendix\n\nA note.");
	});

	test("keeps content before the first heading as an untitled section", () => {
		const sections = extractSections(["intro line", "", "## Goal", "x"].join("\n"));
		expect(sections[0]?.title).toBe("");
		expect(sections[0]?.text).toContain("intro line");
	});

	test("drops a blank preamble and strips inline formatting from titles", () => {
		expect(extractSections("\n\n## **Goal** `x`")[0]?.title).toBe("Goal x");
	});

	test("reads a tab-indented fence as prose, the same as the block parser", () => {
		// The fence rule is shared with `blocks.ts`, whose rule is spaces-only: a
		// tab-indented fence must not be code for one parser and prose for the other.
		const plan = ["\t```", "## Inside", "\t```", "## After"].join("\n");
		expect(extractSections(plan).map((section) => section.title)).toEqual(["", "Inside", "After"]);
	});

	test("returns nothing for an empty plan", () => {
		expect(extractSections("")).toEqual([]);
		expect(extractSections("\n\n")).toEqual([]);
	});

	test("reports each heading's source line and level", () => {
		const plan = ["# Title", "", "## **Goal**", "", "### `Code` step"].join("\n");
		expect(
			extractSections(plan).map((section) => ({ line: section.line, level: section.level, title: section.title })),
		).toEqual([
			{ line: 0, level: 1, title: "Title" },
			{ line: 2, level: 2, title: "Goal" },
			{ line: 4, level: 3, title: "Code step" },
		]);
	});

	test("keeps a heading's own trailing hash, not a closing run", () => {
		expect(extractSections("## C#\nx")[0]?.title).toBe("C#");
		expect(extractSections("## Notes ##\nx")[0]?.title).toBe("Notes");
	});
});

describe("sectionKeys", () => {
	test("keys a repeated heading by which occurrence it is", () => {
		const sections = extractSections("## Notes\na\n\n## Steps\nb\n\n## Notes\nc");
		expect(sectionKeys(sections)).toEqual(["0\u0000Notes", "0\u0000Steps", "1\u0000Notes"]);
	});

	test("counts the preamble's empty title like any other", () => {
		const sections = extractSections("intro\n\n## Notes\na");
		expect(sectionKeys(sections)).toEqual(["0\u0000", "0\u0000Notes"]);
	});

	test("gives every section its own key, in document order", () => {
		const sections = extractSections(PLAN);
		expect(sectionKeys(sections)).toHaveLength(sections.length);
		expect(new Set(sectionKeys(sections)).size).toBe(sections.length);
	});
});
