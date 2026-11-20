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

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { eastAsianWidthType } from "get-east-asian-width";
import { ARROW, GLYPHS, SEPARATORS } from "./glyphs.ts";

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
