/**
 * The shell: two header rows over a body, one gutter, and the two media answers it ships.
 *
 * Held apart from `web-chrome.test.ts`, which had reached its 400-line bar: the shell is the half
 * the next work extends — the collapse and the narrow header are one body each, and the
 * container-query successor touches this file rather than the atoms. What is left there is the
 * markup the shell holds, the live line's painter, and the grammar of the kit's own parts.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { SIDEBAR_COLLAPSE_MAX, collapsedShell, narrowShell, WEB_LAYOUT_CSS } from "./layout.ts";
import { rule } from "../../test/helpers/web-classes.ts";

describe("the shell's two rows", () => {
	test("draws identity over controls, with a plain rule between and under them", () => {
		for (const selector of [".bf-app__id{", ".bf-app__rule{", ".bf-app__ctl{", ".bf-app__foot{"]) {
			expect(WEB_LAYOUT_CSS, selector).toContain(selector);
		}
		// A separator is a hairline in the border role, never a coloured segment: the signature
		// rule has two homes — the mark and a record — and a header separator is neither.
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__rule{")).toBe(".bf-app__rule{height:1px;background:var(--border)");
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__head{")).toContain("border-bottom:1px solid var(--border)");
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__id{")).toContain("min-height:52px");
		expect(WEB_LAYOUT_CSS).not.toContain("linear-gradient");
		// The old bar retired: a page's own controls are the header's second row, not a third
		// strip between the header and the content.
		expect(WEB_LAYOUT_CSS).not.toContain(".bf-app__bar");
		expect(WEB_BASE_CSS).toContain(
			".bf-app__head,.bf-app__sidebar,.bf-app__foot,.bf-gauge,.skip,.bf-dialog{display:none!important}",
		);
	});

	test("draws the header's zones and the live line's parts", () => {
		for (const selector of [".bf-app__facts{", ".bf-app__chrome{", ".bf-app__chrome .bf-btn:hover{"]) {
			expect(WEB_LAYOUT_CSS, selector).toContain(selector);
		}
		for (const selector of [
			".bf-live{",
			".bf-live__glyph{",
			".bf-live__text{",
			".bf-reload{",
			".bf-reload:hover{",
			".bf-footer__facts{",
		]) {
			expect(WEB_COMPONENTS_CSS, selector).toContain(selector);
		}
	});

	test("takes the control row's height from its padding and its rhythm from three groups", () => {
		// 12 inside a role, 24 between roles: the switch, the meter and the prompt line are
		// three groups, so the gap carries the first step and the group's margin the second.
		expect(WEB_LAYOUT_CSS).toContain(
			".bf-app__ctl{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;padding:5px var(--space-6)}",
		);
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__group{display:flex;align-items:baseline;gap:var(--space-3)");
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__group+.bf-app__group{margin-left:var(--space-3)}");
	});

	test("runs every row of the shell on one gutter, at the viewport's width", () => {
		// The mark, the lane heads, the prompt's right edge and the footer are meant to land on
		// the same two verticals, so one rule pads all four and nothing centres a column.
		expect(WEB_LAYOUT_CSS).toContain("@media (min-width:1440px){");
		expect(WEB_LAYOUT_CSS).toContain(
			".bf-app__id,.bf-app__ctl,.bf-app__main,.bf-app__foot{padding-left:var(--space-7);padding-right:var(--space-7)}",
		);
		for (const selector of [".bf-app__id{", ".bf-app__ctl{", ".bf-app__main{", ".bf-app__foot{"]) {
			expect(rule(WEB_LAYOUT_CSS, selector), selector).toContain("var(--space-6)");
			expect(rule(WEB_LAYOUT_CSS, selector), selector).not.toContain("max-width");
		}
		expect(WEB_LAYOUT_CSS).not.toContain("margin:0 auto");
	});

	test("sends a long subject to a row of its own when the identity row runs out", () => {
		// A served root can be deeper than the identity row is wide: the subject takes the row
		// rather than squeezing the facts beside it into unreadable slivers.
		expect(WEB_LAYOUT_CSS).toContain(`@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){`);
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__id .bf-context--subject{flex:1 1 100%}");
		// The subject is also the splitter, and the one label whose head is cut: cutting the
		// end kept only `Users/gavin/Repositories/Github/` and lost the folder being read.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-context--subject{flex:1 1 auto;direction:rtl;text-align:left");
		expect(WEB_COMPONENTS_CSS).not.toContain("direction:ltr");
	});

	test("collapses the sidebar at the width the page asks for, its rules inside the query", () => {
		const shell = collapsedShell(900, ".page-rule{color:var(--accent)}");
		expect(shell.startsWith("@media (max-width:900px){")).toBe(true);
		expect(shell).toContain(".bf-app__body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}");
		expect(shell).toContain("max-height:50vh");
		// A page's rule lands after the shell's in the same query, so it wins at equal specificity.
		expect(shell.indexOf(".page-rule{")).toBeGreaterThan(shell.indexOf("max-height:50vh"));
		// The collapse is the body's answer alone: a page that takes it early keeps its header.
		expect(shell).not.toContain("bf-context--subject");
		expect(shell.endsWith("}")).toBe(true);
	});

	test("answers a narrow identity row in its own query, at its own width", () => {
		const narrow = narrowShell(900);
		expect(narrow.startsWith("@media (max-width:900px){")).toBe(true);
		expect(narrow).toContain(".bf-app__id .bf-context--subject{flex:1 1 100%}");
		expect(narrow).toContain(".bf-app__ctl .bf-field--filter{width:100%;margin-left:0}");
		// The two answers are separate bodies: the header's is not part of the sidebar's.
		expect(narrow).not.toContain("bf-app__body");
	});
});
