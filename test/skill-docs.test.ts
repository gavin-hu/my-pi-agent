/**
 * Contract guard for the skill pages.
 *
 * The site's doc tree mirrors `extensions/` one page per entry, but a skill is not an
 * extension: it registers no tool, and what it promises is a frontmatter description
 * and a body the model reads only when a task matches. So the page exists for a
 * reader who arrives from the site, and this file holds the half a test can see — one
 * page per packaged skill, no orphan page, the template the extension pages use,
 * `/skill:<name>` and the invocation rule named on it, the index row, and a page that
 * stays short. Whether the prose is still true is a review judgement.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { headingsOf, pageTextIn, sectionOf, tablesOf } from "./helpers/docs.ts";

const root = join(import.meta.dir, "..");
const skillsDir = join(root, "skills");
const docsDir = join(root, "docs", "skills");

/** Every packaged skill: a directory under `skills/` carrying a `SKILL.md`. */
const names = readdirSync(skillsDir)
	.filter((name) => existsSync(join(skillsDir, name, "SKILL.md")))
	.sort();

/** A skill's own instructions, which are the source of the two facts held here. */
function skillOf(name: string): string {
	return readFileSync(join(skillsDir, name, "SKILL.md"), "utf-8");
}

/**
 * The page: what the reader can do, how to try it, and one reference half under it.
 * The allowlist is the point — a page cannot grow a contributor section or turn into
 * a manual without failing here.
 */
const USER_SECTIONS = ["What you can do", "Try it", "Reference", "Limits", "Learn more"];

/** A page stays short; the skill's own instructions carry the depth. */
const USER_PAGE_LINES = 120;

describe("the skill doc set", () => {
	test("finds the packaged skills", () => {
		expect(names.length, "a scan that stopped matching would make every case below vacuous").toBeGreaterThan(0);
	});

	test("has one page per packaged skill, and no orphan page", () => {
		const pages = readdirSync(docsDir)
			.filter((file) => file.endsWith(".md") && file !== "README.md")
			.map((file) => file.slice(0, -3))
			.sort();
		expect(pages).toEqual(names);
	});

	test("lists every page in the index", () => {
		const index = readFileSync(join(docsDir, "README.md"), "utf-8");
		const missing = names.filter((name) => !index.includes(`](./${name}.md)`));
		expect(missing, "a skill the index does not list").toEqual([]);
	});
});

describe("the end-user template", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const text = pageTextIn(docsDir, name);
			const headings = headingsOf(text);

			expect(text.startsWith(`# ${name} — `), "the title names the skill").toBe(true);
			expect(headings[0], "what the reader can do comes first").toBe("What you can do");
			expect(headings[1], "then how to try it").toBe("Try it");
			expect(headings, "the page sends the reader onward").toContain("Learn more");

			expect(
				headings.filter((heading) => !USER_SECTIONS.includes(heading)),
				"a contributor section crept back in",
			).toEqual([]);
			const order = headings.map((heading) => USER_SECTIONS.indexOf(heading));
			expect(order, "the sections are out of order").toEqual([...order].sort((left, right) => left - right));

			const table = tablesOf(sectionOf(text, "What you can do"))[0] ?? [];
			expect(table[0], "the table says what the reader wants and what to do").toEqual(["What you want", "What to do"]);
			expect(table.length, "the table has at least one row").toBeGreaterThan(1);

			expect(sectionOf(text, "Learn more"), "a link onward").toMatch(/\]\(\.{1,2}\/[^)\s]+\.md\)/);

			expect(
				text.split("\n").length,
				"the page stays short; the skill's own instructions carry the depth",
			).toBeLessThanOrEqual(USER_PAGE_LINES);
		});
	}
});

describe("the page says how the skill starts", () => {
	for (const name of names) {
		test(`${name}.md`, () => {
			const text = pageTextIn(docsDir, name);
			expect(text.includes(`/skill:${name}`), "the page never names the command that starts it").toBe(true);

			// `/skill:<name>` is the only way in to a skill the model cannot choose, so a
			// page that omits that declares a roster entry the reader will never see.
			if (skillOf(name).includes("disable-model-invocation")) {
				expect(text.includes("disable-model-invocation"), "the page never says the model cannot start it").toBe(true);
			}
		});
	}
});
