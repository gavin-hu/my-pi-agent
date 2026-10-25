/**
 * The plan-document section scan and its in-place rewrite: the one fence-aware
 * view plan mode reads a document through.
 */

import { describe, expect, test } from "bun:test";
import { extractSections, replaceSection, sectionKeys } from "./sections.ts";

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

describe("replaceSection", () => {
	test("replaces a section's body and keeps the rest of the document", () => {
		const next = replaceSection(PLAN, "Appendix", "A longer note.\n\n- more evidence");
		expect(next).toContain("## Appendix\n\nA longer note.\n\n- more evidence");
		expect(next).toContain("## Steps");
		expect(next).toContain("bun run check");
	});

	test("appends a section that is not there", () => {
		const plan = "# T\n\n## Steps\n\n- [ ] one";
		const next = replaceSection(plan, "Appendix", "A note.");
		expect(next).toEndWith("## Steps\n\n- [ ] one\n\n## Appendix\nA note.\n");
		expect(next).toContain("## Appendix");
	});

	test("removes a section when the body is undefined", () => {
		const next = replaceSection(PLAN, "Appendix", undefined);
		expect(next).not.toContain("## Appendix");
		expect(next).toContain("## Steps");
		expect(next).toContain("## Verification");
	});

	test("removing a missing section changes nothing", () => {
		const plan = "# T\n\n## Steps\n\n- [ ] one";
		expect(replaceSection(plan, "Appendix", undefined)).toBe(plan);
	});

	test("replacing twice is idempotent", () => {
		const once = replaceSection(PLAN, "Appendix", "A note.");
		expect(replaceSection(once, "Appendix", "A note.")).toBe(once);
	});

	test("a heading inside a fence does not end the section", () => {
		const plan = "# T\n\n## Appendix\n\nA note.\n\n```\n## inside\n```\n\n## Steps\n\n- [ ] one";
		const next = replaceSection(plan, "Appendix", "A note.");
		// The fenced line belonged to the section, so the rewrite removes it; the
		// heading after the fence stays outside.
		expect(next).not.toContain("## inside");
		expect(next).toContain("## Steps\n\n- [ ] one");
		expect(next).toContain("## Appendix\n\nA note.");
	});

	test("keeps one blank line between the section and the next heading", () => {
		const next = replaceSection(PLAN, "Appendix", "A note.");
		expect(next).toContain("A note.\n\n## Verification");
	});

	test("matches the section title case-insensitively and after markdown stripping", () => {
		const plan = "# T\n\n## **Appendix**\n\nA note.\n";
		expect(replaceSection(plan, "Appendix", "Another note.")).toContain("Another note.");
	});
});
