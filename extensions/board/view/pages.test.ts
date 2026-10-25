/**
 * The document and the client bundle.
 *
 * The document is checked for the property that matters most on a page whose store
 * is model-writable: **it carries no card text**, so there is no path from a card
 * file into the page's HTML. The client is checked for the matching rule — every
 * value goes through `textContent`, and `innerHTML` appears nowhere — because no
 * type checker sees a template string.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { renderBoardPage } from "./page.ts";
import { BOARD_CSS } from "./styles.ts";

describe("the document", () => {
	test("is a complete page under the shared head", () => {
		const page = renderBoardPage({ view: "board" });
		expect(page.startsWith("<!doctype html>")).toBe(true);
		expect(page).toContain('<html lang="en" data-view="board">');
		expect(page).toContain("/app.js");
		expect(page.trimEnd().endsWith("</html>")).toBe(true);
	});

	test("opens on the tab it was asked for, with the other one hidden", () => {
		const board = renderBoardPage({ view: "board" });
		const team = renderBoardPage({ view: "team" });
		expect(board).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team" hidden');
		expect(team).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team"');
		expect(team).toContain('id="panel-board" role="tabpanel" aria-labelledby="tab-board" hidden');
	});

	test("carries the regions and both dialogs the client fills", () => {
		const page = renderBoardPage({ view: "board" });
		for (const id of [
			"board-me",
			"board-status",
			"board-counts",
			"board-banner",
			"board-composer",
			"board-lanes",
			"board-team",
			"board-where",
			"board-card-dialog",
			"card-dialog-title",
			"card-dialog-notes",
			"card-dialog-note-form",
			"card-dialog-plan-form",
			"card-dialog-actions",
			"board-confirm",
			"confirm-cancel",
			"confirm-ok",
		]) {
			expect(page, id).toContain(`id="${id}"`);
		}
	});

	test("carries no card text at all", () => {
		// Card text arrives only as a JSON frame, so nothing model-written can reach
		// the document's markup.
		const page = renderBoardPage({ view: "board" });
		expect(page).not.toContain("Billing webhook");
		expect(page).not.toContain("unassigned");
	});

	test("names both tabs in a tablist, and the page's own landmarks", () => {
		const page = renderBoardPage({ view: "board" });
		expect(page).toContain('role="tablist"');
		expect(page).toContain('role="tab"');
		expect(page).toContain('aria-controls="panel-board"');
		expect(page).toContain("Skip to the board");
		expect(page).toContain('aria-live="polite"');
	});

	test("ships each shared stylesheet block once, and the page's own rules once", () => {
		for (const block of [WEB_BASE_CSS, WEB_THEME_CSS, WEB_LAYOUT_CSS, WEB_COMPONENTS_CSS]) {
			expect(BOARD_CSS.split(block)).toHaveLength(2);
		}
		expect(BOARD_CSS.split(".board-composer{display:grid")).toHaveLength(2);
	});

	/** The page's own rules, without the shared blocks that define the palette. */
	function ownRules(): string {
		return BOARD_CSS.slice(BOARD_CSS.indexOf(WEB_COMPONENTS_CSS) + WEB_COMPONENTS_CSS.length);
	}

	test("draws every colour through a kit token", () => {
		// A literal colour would survive the theme toggle and the print theme. The
		// shared theme block is where literals belong, so only the page's own rules
		// are checked.
		expect(ownRules()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(ownRules()).not.toMatch(/\brgba?\(/);
		expect(ownRules()).not.toMatch(/\bhsla?\(/);
	});

	test("names no custom property the kit does not define", () => {
		const defined = new Set([...BOARD_CSS.matchAll(/--[a-z0-9-]+(?=\s*:)/g)].map((match) => match[0]));
		const used = [...BOARD_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? "");
		const unknown = used.filter((token) => !defined.has(token));
		expect(unknown).toEqual([]);
	});

	test("states the page's two breakpoints", () => {
		expect(BOARD_CSS).toContain("@media (max-width:1180px)");
		expect(BOARD_CSS).toContain("@media (max-width:860px)");
	});
});

describe("the client bundle", () => {
	test("carries all three modules and the entry point", () => {
		expect(BOARD_CLIENT_JS).toContain("board.render = function");
		expect(BOARD_CLIENT_JS).toContain("board.act = function");
		expect(BOARD_CLIENT_JS).toContain("board.start = function");
		expect(BOARD_CLIENT_JS).toContain("board.start();");
	});

	test("never parses a stored field", () => {
		// `innerHTML` is the whole injection surface of a page like this one.
		expect(BOARD_CLIENT_JS).not.toContain("innerHTML");
		expect(BOARD_CLIENT_JS).not.toContain("outerHTML");
		expect(BOARD_CLIENT_JS).not.toContain("insertAdjacentHTML");
		expect(BOARD_CLIENT_JS).not.toContain("document.write");
	});

	test("sets every field as text", () => {
		expect(BOARD_CLIENT_JS).toContain("textContent");
		expect(BOARD_CLIENT_JS).toContain("createTextNode");
	});

	test("opens one stream, with the token it was served with", () => {
		expect(BOARD_CLIENT_JS).toContain('new EventSource("/events?token=');
		expect(BOARD_CLIENT_JS).toContain('new URLSearchParams(window.location.search).get("token")');
	});

	test("asks before a claim, a reclaim, and a deletion, and never uses alert", () => {
		expect(BOARD_CLIENT_JS).toContain("dialog.showModal()");
		expect(BOARD_CLIENT_JS).toContain('verb === "claim"');
		expect(BOARD_CLIENT_JS).toContain('verb === "reclaim"');
		expect(BOARD_CLIENT_JS).toContain('verb === "drop"');
		expect(BOARD_CLIENT_JS).not.toContain("alert(");
	});

	test("is one self-contained script", () => {
		// Balanced braces are a cheap proof the concatenation did not cut a module
		// short, which is the failure mode a template string has.
		const opens = (BOARD_CLIENT_JS.match(/\{/g) ?? []).length;
		const closes = (BOARD_CLIENT_JS.match(/\}/g) ?? []).length;
		expect(opens).toBe(closes);
		expect(BOARD_CLIENT_JS.length).toBeGreaterThan(4_000);
	});
});
