/**
 * The page stylesheet: one owner for the layer order and the join.
 *
 * The order is what lets a page's rule beat a kit class at equal specificity, so it is pinned
 * here rather than trusted to three call sites; the join is pinned for the same reason, because
 * a page whose sheet is glued to the last layer renders but reads as a broken selector.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { WEB_LAYOUT_CSS } from "./layout.ts";
import { pageSheet } from "./sheet.ts";
import { WEB_THEME_CSS } from "./tokens.ts";

/** The page's own rule, which has to land after every kit layer to have the last word. */
const OWN = ".review-sheet__row{border:1px solid var(--border)}";

describe("the page stylesheet", () => {
	test("lays the four layers down in their one order, then the page's own rules", () => {
		const sheet = pageSheet(OWN);
		const at = [WEB_BASE_CSS, WEB_THEME_CSS, WEB_LAYOUT_CSS, WEB_COMPONENTS_CSS, OWN].map((part) =>
			sheet.indexOf(part),
		);
		expect(at.every((index) => index >= 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	test("joins one layer to the next with a single newline", () => {
		const sheet = pageSheet(OWN);
		expect(sheet.startsWith(`${WEB_BASE_CSS}\n${WEB_THEME_CSS}`)).toBe(true);
		// The page's sheet follows the components layer directly; a page that wants a blank line
		// there starts its own sheet with one, which is how the board keeps its separator.
		expect(sheet.endsWith(`${WEB_COMPONENTS_CSS}\n${OWN}`)).toBe(true);
	});

	test("writes each layer once", () => {
		// A repeated block still renders, so only a count catches it.
		const sheet = pageSheet(OWN);
		for (const layer of [WEB_BASE_CSS, WEB_THEME_CSS, WEB_LAYOUT_CSS, WEB_COMPONENTS_CSS]) {
			expect(sheet.split(layer)).toHaveLength(2);
		}
	});
});
