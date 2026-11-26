/**
 * The shared UI vocabulary: `GLYPHS`, `ARROW` and `SEPARATORS`.
 *
 * Split from `components.test.ts` at its size bar, and it is the file `glyphs.ts`'s docstring has
 * cited all along for the width ban — the reference was stale until this suite existed. The rule
 * the module states: a glyph is one terminal column, wide/fullwidth/emoji are banned, and an
 * East-Asian *ambiguous* glyph is allowed because a CJK-width profile draws it two columns and the
 * vocabulary is not limited to narrow ones. So the cases hold the widths *and* state the class,
 * which is what fails on a hand-copied wide arrow rather than only on a missing constant.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { eastAsianWidthType } from "get-east-asian-width";
import { ARROW, GLYPH_SPECS, GLYPH_SEQUENCES, GLYPHS, MODE_GLYPHS, SEPARATORS } from "./glyphs.ts";
import { textOf } from "../../test/helpers/scan.ts";

describe("GLYPHS", () => {
	test("every glyph is exactly one visible column", () => {
		for (const [name, glyph] of Object.entries(GLYPHS)) {
			expect(visibleWidth(glyph), name).toBe(1);
		}
	});

	test("no glyph is wide or fullwidth, so none is a fixed two columns", () => {
		const wide = new Set(["wide", "fullwidth"]);
		for (const [name, glyph] of Object.entries(GLYPHS)) {
			expect(wide.has(eastAsianWidthType(glyph.codePointAt(0) ?? 0)), `${name}=${glyph}`).toBe(false);
		}
	});

	test("glyphs are distinct, so chips stay distinguishable", () => {
		const values = Object.values(GLYPHS);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("GLYPH_SPECS", () => {
	/** The names the two tables share, and each record's literal. */
	const specs = Object.entries(GLYPH_SPECS) as [keyof typeof GLYPHS, (typeof GLYPH_SPECS)[keyof typeof GLYPHS]][];

	test("records every glyph and nothing else", () => {
		expect(specs.map(([name]) => name as string).sort()).toEqual(Object.keys(GLYPHS).sort());
	});

	test("a record's width class is the class the character measures as", () => {
		// The module's rule as data: a glyph added with a copied `neutral` fails here rather
		// than in a CJK-width profile nobody ran. A wide or fullwidth class is refused by the
		// glyph test above, so this one holds the two tables together.
		for (const [name, facts] of specs) {
			const measured = eastAsianWidthType(GLYPHS[name].codePointAt(0) ?? 0);
			expect(facts.width as string, `${name}=${GLYPHS[name]}`).toBe(measured);
		}
	});

	test("each glyph says one thing, and no two say the same", () => {
		// A test on the literals cannot see a duplicate meaning: `⏵` and `▶` were distinct
		// characters that both said "go". The record makes that collision a red case.
		const said = specs.map(([, facts]) => facts.says);
		expect(new Set(said).size).toBe(said.length);
	});

	test("every ink is one of the three classes", () => {
		const inks = new Set(specs.map(([, facts]) => facts.ink));
		expect([...inks].every((ink) => ink === "solid" || ink === "outline" || ink === "line")).toBe(true);
	});

	test("a sequence's frames are one column each, so a row does not jump", () => {
		for (const [name, sequence] of Object.entries(GLYPH_SEQUENCES)) {
			expect(sequence.frames.length, name).toBeGreaterThan(1);
			for (const frame of sequence.frames) expect(visibleWidth(frame), `${name}=${frame}`).toBe(1);
		}
	});
});

describe("MODE_GLYPHS", () => {
	test("draws one mode per glyph, and no mode re-types a literal", () => {
		expect(Object.values(MODE_GLYPHS)).toEqual([GLYPHS.autoMode, GLYPHS.plan, GLYPHS.lead]);
		expect(new Set(Object.values(MODE_GLYPHS)).size).toBe(3);
	});

	test("keeps the seat a solid mark, so it reads at a glance like the resting default", () => {
		expect(GLYPH_SPECS.lead.ink).toBe("solid");
		expect(GLYPH_SPECS.autoMode.ink).toBe("solid");
	});
});

describe("SEPARATORS", () => {
	test("the item separator is three columns wide", () => {
		expect(visibleWidth(SEPARATORS.item)).toBe(3);
	});

	test("the arrow separator is three columns wide, and the arrow itself one", () => {
		// `→` is one literal in two jobs (#739): a join between two states, and a lead with no
		// left-hand state (`→ clear list`), where the call site keeps its own spacing. Both widths
		// are held here, so a hand-copied `⇒` or `»` fails on the glyph rather than on a missing
		// constant — and a literal re-typed somewhere is the drift this replaced.
		expect(visibleWidth(SEPARATORS.arrow)).toBe(3);
		expect(visibleWidth(ARROW)).toBe(1);
	});

	test("the arrow is ambiguous-width, which this vocabulary allows", () => {
		// The module's rule, stated rather than inferred: a wide or fullwidth glyph is banned, and
		// an East-Asian *ambiguous* one is allowed — `▸`, `⊚` and `›` are that class already. U+2192
		// is 1 column by default and 2 under a CJK-width profile, the same trade every glyph here
		// makes, so the case asserts the class rather than only the number above.
		expect(eastAsianWidthType(ARROW.codePointAt(0) ?? 0)).toBe("ambiguous");
	});

	test("the arrow's join is the separator a call subject already drew", () => {
		// The refactor is text-preserving: a subject built from the constant is byte-identical to
		// the literal ten sites used to hand-type, so a later grep can trust the constant instead
		// of re-reading each call site.
		expect(`billing-core${SEPARATORS.arrow}#12`).toBe("billing-core → #12");
		expect(`start${SEPARATORS.arrow}${"npm test"}`).toBe("start → npm test");
		expect(`${ARROW} clear list`).toBe("→ clear list");
	});
});

/**
 * The one page that reprints the vocabulary.
 *
 * `docs/design-system.md` is where a reader learns what a mark means, so it is also
 * the one place a mark could outlive the constant it came from: the table is read back
 * and held to `GLYPHS`, which owns every literal a surface draws.
 */
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
});
