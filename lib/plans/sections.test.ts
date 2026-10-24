/**
 * The plan-document section scan and its in-place rewrite: the same fence-aware
 * view both plan mode and the split rely on.
 */

import { describe, expect, test } from "bun:test";
import { extractSections, replaceSection, teamSectionBody } from "./sections.ts";

const PLAN = `# Title

Intro paragraph.

## Steps

- [ ] one

## Team

Lead: contract

| unit | paths | test |
| --- | --- | --- |
| contract | src/a | bun test src/a |

## Verification

    bun run check
`;

describe("extractSections", () => {
	test("splits at headings, keeping the preamble", () => {
		const sections = extractSections(PLAN);
		expect(sections.map((section) => section.title)).toEqual(["Title", "Steps", "Team", "Verification"]);
		expect(sections[0]?.line).toBe(0);
	});

	test("a heading inside a fence is not a heading", () => {
		const plan = ["# T", "", "```sh", "# not a heading", "```", "", "## After"].join("\n");
		expect(extractSections(plan).map((section) => section.title)).toEqual(["T", "After"]);
	});

	test("keeps each section's raw lines", () => {
		const team = extractSections(PLAN).find((section) => section.title === "Team");
		expect(team?.text).toStartWith("## Team\n\nLead: contract");
	});
});

describe("replaceSection", () => {
	test("replaces a section's body and keeps the rest of the document", () => {
		const next = replaceSection(PLAN, "Team", "Lead: core\n\n| unit | paths |\n| --- | --- |\n| core | src/b |");
		expect(teamSectionBody(next)).toBe("Lead: core\n\n| unit | paths |\n| --- | --- |\n| core | src/b |");
		expect(next).toContain("## Steps");
		expect(next).toContain("bun run check");
	});

	test("appends a section that is not there", () => {
		const plan = "# T\n\n## Steps\n\n- [ ] one";
		const next = replaceSection(plan, "Team", "Lead: a");
		expect(next).toEndWith("## Steps\n\n- [ ] one\n\n## Team\nLead: a\n");
		expect(teamSectionBody(next)).toBe("Lead: a");
	});

	test("removes a section when the body is undefined", () => {
		const next = replaceSection(PLAN, "Team", undefined);
		expect(next).not.toContain("## Team");
		expect(next).toContain("## Steps");
		expect(next).toContain("## Verification");
	});

	test("removing a missing section changes nothing", () => {
		const plan = "# T\n\n## Steps\n\n- [ ] one";
		expect(replaceSection(plan, "Team", undefined)).toBe(plan);
	});

	test("replacing twice is idempotent", () => {
		const once = replaceSection(PLAN, "Team", "Lead: a");
		expect(replaceSection(once, "Team", "Lead: a")).toBe(once);
	});

	test("a heading inside a fence does not end the section", () => {
		const plan = "# T\n\n## Team\n\nLead: a\n\n```\n## inside\n```\n\n## Steps\n\n- [ ] one";
		const next = replaceSection(plan, "Team", "Lead: b");
		// The fenced line belonged to the section, so the rewrite removes it; the
		// heading after the fence stays outside.
		expect(next).not.toContain("## inside");
		expect(next).toContain("## Steps\n\n- [ ] one");
		expect(teamSectionBody(next)).toBe("Lead: b");
	});

	test("keeps one blank line between the section and the next heading", () => {
		const next = replaceSection(PLAN, "Team", "Lead: a");
		expect(next).toContain("Lead: a\n\n## Verification");
	});

	test("matches the section title case-insensitively and after markdown stripping", () => {
		const plan = "# T\n\n## **Team**\n\nLead: a\n";
		expect(replaceSection(plan, "Team", "Lead: b")).toContain("## Team\n\nLead: b");
	});
});

describe("teamSectionBody", () => {
	test("returns the body without the heading", () => {
		expect(teamSectionBody("## Team\n\nLead: a\n\n## Next\n\nx\n")).toBe("Lead: a");
	});

	test("returns undefined without a team section", () => {
		expect(teamSectionBody("# T\n\n## Steps\n\n- [ ] one")).toBeUndefined();
	});
});
