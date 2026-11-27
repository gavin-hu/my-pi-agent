/**
 * The app head: the one atom a served page's header comes from.
 *
 * The shell's shape has a reason (web/README.md): the identity row carries the lockup, the
 * subject, the facts and the app's chrome, and the page's own controls sit under one plain rule.
 * A page with no controls has one row, so the atom writes no rule for it — that case used to be a
 * CSS patch over markup a page had assembled by hand, and the patch went with the assembly.
 */

import { describe, expect, test } from "bun:test";
import { type AppHeadOptions, appHead } from "./markup.ts";

/** A one-row head: the board's zones and no controls, which is all a case needs. */
const ROW: AppHeadOptions = {
	product: "board",
	subject: { id: "board-repo", label: "my-pi-agent", title: "/tmp/my-pi-agent" },
	facts: '<span class="bf-live" id="board-status">connecting</span>',
};

describe("the app head", () => {
	test("writes the identity row's zones in order, with the chrome last", () => {
		const html = appHead(ROW);
		const order = [
			'<span class="bf-brand">',
			"bf-context--subject",
			'<div class="bf-app__facts">',
			'<div class="bf-app__chrome">',
		];
		const at = order.map((part) => html.indexOf(part));
		expect(at.every((index) => index > 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		// The row is closed after the chrome, so nothing a page passes can land outside it.
		expect(html.endsWith("</div></header>")).toBe(true);
	});

	test("stops at one row when the page has no controls", () => {
		// A rule with nothing under it draws the head's own border a second time: the shell's
		// one-row shape is the atom's, and no page passes a rule to it.
		const html = appHead(ROW);
		expect(html).not.toContain("bf-app__rule");
		expect(html).not.toContain("bf-app__ctl");
	});

	test("puts one rule between the rows, and the page's own class on each", () => {
		const html = appHead({
			...ROW,
			controls: '<div class="bf-app__group">controls</div>',
			controlsClass: "review-actions",
			identityClass: "review-bar",
		});
		expect(html).toContain('<div class="bf-app__id review-bar">');
		expect(html).toContain('<div class="bf-app__rule"></div><div class="bf-app__ctl review-actions">');
		expect(html.endsWith("</header>")).toBe(true);
	});

	test("renders the page's subject as the identity row's one truncating label", () => {
		const subject = appHead({ ...ROW, subject: { id: "board-repo", label: "my-pi-agent", title: '/tmp/"x"' } });
		expect(subject).toContain('class="bf-context bf-context--subject"');
		expect(subject).toContain('id="board-repo"');
		// The whole path is the hover: the line keeps the tail, and the head is where two clones of one repository differ.
		expect(subject).toContain('title="/tmp/&quot;x&quot;"');
		// The label is isolated from the row's rtl, so the escape happens inside the isolate: a
		// label of nothing but markup still paints as text.
		expect(appHead({ ...ROW, subject: { label: "a&b", title: "a&b" } })).toContain("<bdi>a&amp;b</bdi>");
		// A subject with nothing to name writes no id, rather than an empty one.
		expect(appHead({ ...ROW, subject: { label: "a", title: "a" } })).not.toContain(' id="board-repo"');
	});

	test("builds the lockup from the two-tone mark, and escapes the product name", () => {
		const brand = appHead({ ...ROW, product: "<plan>" });
		expect(brand).toContain('class="bf-mark"');
		expect(brand).toContain("bf-mark__top");
		expect(brand).toContain("bf-wordmark");
		expect(brand).toContain("bytefly");
		expect(brand).toContain("&lt;plan&gt;");
	});

	test("leaves the key sheet's trigger out for a page that serves no sheet", () => {
		// The file view and the problem page ship no client and no sheet: a trigger for a dialog
		// neither includes is a control that does nothing.
		const bare = appHead({ ...ROW, keys: false });
		expect(bare).not.toContain('id="keys-open"');
		expect(bare).toContain('id="theme-toggle"');
		// Absent is the ordinary page: every other served page keeps its trigger.
		expect(appHead(ROW)).toContain('id="keys-open"');
	});
});
