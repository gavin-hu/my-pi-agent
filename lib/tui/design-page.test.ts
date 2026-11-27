/**
 * The design page against the code it describes.
 *
 * `docs/design-system.md` is where a reader learns what a role and a mark mean, so it is also the
 * one place either could outlive the table it came from: both of the page's tables are read back
 * and held to the constants that own them — the glyph table to `GLYPHS`, the colour table to
 * `TUI_TOKENS`, role for role and token for token. Both cases live here rather than in
 * `glyphs.test.ts`, where the page was the one non-glyph case in a suite about glyphs.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { GLYPHS } from "./glyphs.ts";
import { type TuiRole, TUI_TOKENS } from "./tokens.ts";
import { textOf } from "../../test/helpers/scan.ts";

describe("the design system page", () => {
	const page = textOf(join(import.meta.dir, "../../docs/design-system.md"));

	/** A `## ` section's body, up to the heading after it. */
	function section(heading: string): string {
		const at = page.indexOf(`## ${heading}`);
		if (at < 0) return "";
		const end = page.indexOf("\n## ", at + 1);
		return page.slice(at, end < 0 ? undefined : end);
	}

	test("prints only marks the vocabulary owns", () => {
		const marks = [...section("A glyph is one column and one meaning").matchAll(/^\|\s*`(.+?)`\s*\|/gm)].map(
			(match) => match[1] ?? "",
		);
		// A missing table would otherwise hold nothing to anything and pass.
		expect(marks.length, "the glyph table is gone, so no mark is held to GLYPHS").toBeGreaterThan(0);
		const owned = new Set<string>(Object.values(GLYPHS));
		expect(marks.filter((mark) => !owned.has(mark))).toEqual([]);
	});

	test("prints every role, and the colour each one paints", () => {
		// The page's table *is* the mapping: the role column is `TuiRole`, and the middle column is
		// what it paints. Reading both back is what keeps a role that aliases another visible — six
		// of the eighteen share a token — and what fails a hand-typed token rather than describing it.
		const rows = [...section("Color is a role").matchAll(/^\| `(\w+)` \| `(\w+)` \|/gm)];
		const printed = new Map(rows.map(([, role, token]) => [role ?? "", token ?? ""]));
		// A missing table would otherwise hold nothing to anything and pass.
		expect(printed.size, "the roles table is gone, so no role is held to TUI_TOKENS").toBeGreaterThan(0);
		expect([...printed.keys()].sort(), "the roles the page prints").toEqual(Object.keys(TUI_TOKENS).sort());
		for (const [role, token] of printed) {
			expect(token, `the page paints \`${role}\``).toBe(TUI_TOKENS[role as TuiRole]);
		}
	});
});
