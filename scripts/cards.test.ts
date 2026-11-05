/**
 * The posting cards: the pages in `assets/cards/`, and the one stylesheet beside them.
 *
 * The two are only right together, so both directions are asserted here. A class a page wears
 * with no rule renders in whatever its element inherits, and a selector declared twice leaves one
 * copy dead — often the copy whose comment claims a position in the file it no longer has. Neither
 * fails a capture, and both shipped past `bun run check` while the suite walked one way only.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, fitsExpression, VIEWPORT_WIDTH } from "./shots/cards.ts";
import { repo } from "./theme.ts";

/** The cards' directory, where both the pages and their one stylesheet live. */
const cardsDir = join(repo, "assets", "cards");

/** The stylesheet, comments stripped: a file name in the prose must not pass for a class. */
function stylesheet(): string {
	return readFileSync(join(cardsDir, "cards.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** One page's text, by the file name `CARDS` records. */
function pageText(page: string): string {
	return readFileSync(join(cardsDir, page), "utf-8");
}

/** Every page's text, in the order `CARDS` records them. */
function pageTexts(): string[] {
	return Object.values(CARDS).map((card) => pageText(card.page));
}

/** Every selector the stylesheet declares, one entry per part of a `a, b { … }` prelude. */
function selectors(css: string): string[] {
	return [...css.matchAll(/([^{}]+)\{/g)]
		.flatMap((match) => (match[1] ?? "").split(","))
		.map((selector) => selector.trim().replace(/\s+/g, " "))
		.filter(Boolean);
}

/** The classes a selector list styles. */
function styledClasses(list: readonly string[]): Set<string> {
	return new Set(
		list.flatMap((selector) => [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1] ?? "")),
	);
}

/** The classes the pages wear, as the tokens of every `class` attribute they carry. */
function wornClasses(pages: readonly string[]): Set<string> {
	return new Set(
		pages
			.flatMap((html) => [...html.matchAll(/class="([^"]*)"/g)])
			.flatMap((match) => (match[1] ?? "").split(/\s+/))
			.filter(Boolean),
	);
}

/** Every selector the stylesheet declares more than once, sorted. */
function declaredTwice(list: readonly string[]): string[] {
	const counts = new Map<string, number>();
	for (const selector of list) counts.set(selector, (counts.get(selector) ?? 0) + 1);
	return [...counts]
		.filter(([, count]) => count > 1)
		.map(([selector]) => selector)
		.sort();
}

describe("posting card pages", () => {
	test("every card is a page that links the one stylesheet", () => {
		// A page that lost its `<link>` still captures — as an unstyled, overflowing poster —
		// so the pairing the set rests on is asserted here instead of being left to a capture
		// that CI never runs.
		for (const [name, card] of Object.entries(CARDS)) {
			expect(existsSync(join(cardsDir, card.page)), name).toBe(true);
			const html = pageText(card.page);
			expect(html, `${name} must link ./cards.css`).toContain('<link rel="stylesheet" href="./cards.css" />');
			expect(html, `${name} must open with the card element`).toContain('class="card');
		}
	});

	test("every class a page wears has a rule", () => {
		// Written page-first, because that is the direction a reader works in: a class added to a
		// page and not to the stylesheet wears whatever it inherits, which is how a lane label
		// spent a review and a capture in the wrong accent.
		const styled = styledClasses(selectors(stylesheet()));
		expect([...wornClasses(pageTexts())].filter((name) => !styled.has(name)).sort()).toEqual([]);
	});

	test("the stylesheet has no rule no page uses", () => {
		// The other direction: the classes are what this set's renames touch, and a leftover
		// selector is invisible until someone reads all 700 lines.
		const worn = wornClasses(pageTexts());
		expect([...styledClasses(selectors(stylesheet()))].filter((name) => !worn.has(name)).sort()).toEqual([]);
	});

	test("no selector is declared twice", () => {
		// One class does not outrank another, so a class the page already wears is either stated
		// once, after the rule it overrides, or stated twice with the earlier copy dead.
		expect(declaredTwice(selectors(stylesheet()))).toEqual([]);
	});

	test("the reading sees a class with no rule, and a selector declared twice", () => {
		// Both checks above pass on a parse that matched nothing, so the parse is held to a
		// stylesheet whose two defects are known.
		const css = ".a { color: red; }\n.a, .b { color: blue; }\n";
		expect(styledClasses(selectors(css))).toEqual(new Set(["a", "b"]));
		expect(declaredTwice(selectors(css))).toEqual([".a"]);
		expect(wornClasses(['<i class="a c"></i><i class="b  "></i>'])).toEqual(new Set(["a", "c", "b"]));
	});

	test("the stylesheet owns the poster box, and the window opens at least that wide", () => {
		// The capture used to police a size of its own, which is how a box can be stated in
		// two places and drift in one. `cards.css` states it; this holds the number and the
		// window hint to it.
		const block = /\.card \{([^}]*)\}/.exec(stylesheet())?.[1] ?? "";
		expect({ width: /\bwidth: (\d+)px/.exec(block)?.[1], height: /\bheight: (\d+)px/.exec(block)?.[1] }).toEqual({
			width: "1200",
			height: "675",
		});
		expect(VIEWPORT_WIDTH).toBeGreaterThanOrEqual(Number(/\bwidth: (\d+)px/.exec(block)?.[1]));
	});

	test("the overflow gate measures the page, not a number of its own", () => {
		expect(fitsExpression()).toContain("getBoundingClientRect");
		expect(fitsExpression()).not.toMatch(/1200|675/);
	});
});
