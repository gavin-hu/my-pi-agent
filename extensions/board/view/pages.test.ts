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
import {
	brandLockup,
	button,
	chip,
	keysSheet,
	themeToggle,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../../lib/web/index.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { renderBoardPage } from "./page.ts";
import { BOARD_CSS } from "./styles.ts";

describe("the document", () => {
	test("is a complete page under the shared head", () => {
		const page = renderBoardPage({ view: "board" });
		expect(page.startsWith("<!doctype html>")).toBe(true);
		expect(page).toContain('<html lang="en" data-view="board" data-writes="1">');
		expect(page).toContain("/app.js");
		expect(page.trimEnd().endsWith("</html>")).toBe(true);
	});

	test("a viewer's document says so, and the client asks it", () => {
		// The attribute is the whole difference between the lead's page and a teammate's:
		// the server renders it per request, and every affordance reads it.
		expect(renderBoardPage({ view: "board", writes: false })).toContain('data-writes="0"');
		expect(renderBoardPage({ view: "team", writes: true })).toContain('data-writes="1"');
		expect(BOARD_CLIENT_JS).toContain('getAttribute("data-writes") !== "0"');
	});

	test("opens on the tab it was asked for, with the other one hidden", () => {
		const board = renderBoardPage({ view: "board" });
		const team = renderBoardPage({ view: "team" });
		expect(board).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team" hidden');
		expect(team).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team"');
		expect(team).toContain('id="panel-board" role="tabpanel" aria-labelledby="tab-board" hidden');
	});

	test("carries the regions and all three dialogs the client fills", () => {
		const page = renderBoardPage({ view: "board" });
		for (const id of [
			"board-me",
			"board-status",
			"board-progress",
			"board-progress-fill",
			"board-progress-text",
			"board-filter",
			"board-new",
			"board-new-dialog",
			"board-new-title",
			"new-title-count",
			"keys-open",
			"board-banner",
			"board-composer",
			"new-title",
			"new-paths",
			"new-priority",
			"new-submit",
			"board-cancel",
			"board-picker",
			"board-lanes",
			"board-no-cards",
			"board-first-card",
			"board-team",
			"board-where",
			"board-card-dialog",
			"card-dialog-title",
			"card-dialog-close",
			"card-dialog-meta",
			"card-dialog-owner",
			"card-dialog-paths",
			"card-dialog-depends",
			"card-dialog-plan",
			"card-dialog-notes",
			"card-dialog-earlier",
			"card-dialog-note",
			"card-dialog-note-add",
			"card-dialog-actions",
			"board-confirm",
			"confirm-title",
			"confirm-body",
			"confirm-cancel",
			"confirm-ok",
			"keys-dialog",
			"keys-close",
		]) {
			expect(page, id).toContain(`id="${id}"`);
		}
	});

	test("opens with the new-card dialog closed behind its one trigger", () => {
		const page = renderBoardPage({ view: "board" });
		// The board is what the page opens on; the dialog is asked for, not offered twice.
		expect(page).toContain('id="board-new-dialog" hidden');
		expect(page).toContain('id="board-new" title="New card — n" aria-haspopup="dialog"');
		// The drawer's `aria-expanded` described a tray; a dialog announces itself instead.
		expect(page).not.toMatch(/id="board-new"[^>]*aria-expanded/);
	});

	test("carries no card text at all", () => {
		// Card text arrives only as a JSON frame, so nothing model-written can reach
		// the document's markup.
		const page = renderBoardPage({ view: "board" });
		expect(page).not.toContain("Billing webhook");
		expect(page).not.toContain("waiting on the gateway");
	});

	test("names both tabs in a tablist, and the page's own landmarks", () => {
		const page = renderBoardPage({ view: "board" });
		expect(page).toContain('role="tablist"');
		expect(page).toContain('role="tab"');
		expect(page).toContain('aria-controls="panel-board"');
		expect(page).toContain("Skip to the cards");
		expect(page).toContain('<h1 class="sr-only">');
		expect(page).toContain('aria-live="polite"');
	});

	test("ships each shared stylesheet block once, and the page's own rules once", () => {
		for (const block of [WEB_BASE_CSS, WEB_THEME_CSS, WEB_LAYOUT_CSS, WEB_COMPONENTS_CSS]) {
			expect(BOARD_CSS.split(block)).toHaveLength(2);
		}
		expect(BOARD_CSS.split(".board-composer{display:flex")).toHaveLength(2);
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

	test("offers an unowned card the action it is waiting for, and keeps ages honest", () => {
		// A todo card's dialog used to offer only Drop and Close; a quiet board's
		// ages used to freeze at the last frame.
		expect(BOARD_CLIENT_JS).toContain('board.may(card, view, "claim")');
		expect(BOARD_CLIENT_JS).toContain("data-at");
		expect(BOARD_CLIENT_JS).toContain("board.refreshAges()");
	});

	test("filters both tabs, lands on the lane with work, and tooltips what it clamps", () => {
		// The filter is one control for two tabs — a teammate row matches by its label as
		// well as by a card; a narrow reader should not open on an empty lane; and a
		// clipped line should still be readable on hover.
		expect(BOARD_CLIENT_JS).toContain("board.matches(card, query)");
		expect(BOARD_CLIENT_JS).toContain("matchesLabel(m.label)");
		expect(BOARD_CLIENT_JS).toContain("laneWithWork(view)");
		expect(BOARD_CLIENT_JS).toContain("line.title = reason.text");
		expect(BOARD_CLIENT_JS).toContain("why.title = entry.why");
	});

	test("draws the dashboard: a queue, a roster, and a Done strip that opens cards", () => {
		expect(BOARD_CLIENT_JS).toContain("board-team__grid");
		expect(BOARD_CLIENT_JS).toContain("board-team__decision");
		expect(BOARD_CLIENT_JS).toContain("board-team__roster");
		// Every state a teammate can be in, including the two that are not a heartbeat.
		for (const state of ["live", "quiet", "absent", "unknown"]) expect(BOARD_CLIENT_JS).toContain(state);
		// A bus that is not loaded must read as unknown rather than as "nobody".
		expect(BOARD_CLIENT_JS).toContain("view.teammates === undefined ? null : view.teammates");
		expect(BOARD_CLIENT_JS).toContain("board-team__id");
		expect(BOARD_CLIENT_JS).toContain('"Reclaim #" + card.id');
	});

	test("says its lane in the head, separates the notes, and offers only reachable lanes", () => {
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-state")');
		expect(BOARD_CLIENT_JS).toContain("board-dialog__note-head");
		expect(BOARD_CLIENT_JS).toContain('"Move to"');
		// The page records an owner instead of messaging a peer, so its control sits with
		// the actions and is offered only where the rules would accept it.
		expect(BOARD_CLIENT_JS).toContain('board.may(card, view, "assign")');
		expect(BOARD_CLIENT_JS).toContain('"/assign"');
		expect(BOARD_CLIENT_JS).toContain("lane !== card.status");
	});

	test("opens the new card through the kit's dialog, not a home-made one", () => {
		// One `dialogScript` per modal: the Tab trap, `Esc`, the backdrop click, and the
		// focus return are the kit's, so the page only fills and opens it.
		expect(BOARD_CLIENT_JS).toContain('getElementById("board-new-dialog")');
		expect(BOARD_CLIENT_JS).toContain("window.bfNew");
		expect(BOARD_CLIENT_JS).toContain("window.bfNew.open()");
	});

	test("edits a card through the dialog it adds one with", () => {
		// One form, two modes: the same fields, the same kit dialog, and a heading and
		// submit that say which one is showing.
		expect(BOARD_CLIENT_JS).toContain("board.editCard");
		expect(BOARD_CLIENT_JS).toContain('"Edit card #"');
		expect(BOARD_CLIENT_JS).toContain('"Save"');
		expect(renderBoardPage({ view: "board" })).toContain('id="new-priority"');
		// The page never sends a link, because it never shows one.
		expect(BOARD_CLIENT_JS).not.toContain("dependsOn:");
	});

	test("says why in one voice, and lets the reason carry it", () => {
		// Three grammars in one slot read as three different kinds of fact: a status
		// prefix that repeated the lane, an em-dash clause, and a tick.
		expect(BOARD_CLIENT_JS).not.toContain('"blocked: "');
		expect(BOARD_CLIENT_JS).not.toContain("unplanned — no plan recorded");
		expect(BOARD_CLIENT_JS).not.toContain("✓ planned");
		expect(BOARD_CLIENT_JS).toContain('"no plan recorded"');
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

	test("asks one permission table on all three surfaces", () => {
		// A card face, the dialog's footer, and a queue row each draw a different subset of
		// the same verbs, and the answer to "may this reader" is one function — otherwise the
		// same card offers `Claim` in one place and refuses it in another.
		expect(BOARD_CLIENT_JS).toContain("board.may = may");
		for (const verb of ["claim", "move", "release", "edit", "drop", "reclaim"]) {
			expect(BOARD_CLIENT_JS, verb).toContain(`board.may(card, view, "${verb}")`);
		}
	});

	test("asks before a claim, a reclaim, and a deletion, and never uses alert", () => {
		expect(BOARD_CLIENT_JS).toContain("window.bfConfirm.open()");
		expect(BOARD_CLIENT_JS).toContain("window.bfConfirm.close()");
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

/**
 * The class contract: the page may only wear classes that exist.
 *
 * A `bf-…` name is the kit's vocabulary — its stylesheet plus what its own atoms
 * emit — and a `board-…` name is this page's stylesheet or an id its client greps.
 * A name either side invents renders as an unstyled element, which is exactly how
 * the tab groups shipped as browser-default buttons: the markup said `role="tab"`
 * and never said `bf-segmented__item`.
 *
 * The test reads the rendered markup and the client bundle, so the part of this
 * page no type checker sees is still held to the vocabulary.
 */
describe("the class contract", () => {
	/** Every `.name` a stylesheet defines. */
	function defined(css: string, prefix: string): Set<string> {
		return new Set(
			[...css.matchAll(new RegExp(String.raw`\.(${prefix}[a-z0-9_-]+)`, "g"))].map((match) => match[1] ?? ""),
		);
	}

	/** Every `prefix…` token in a piece of markup or script. */
	function used(source: string, prefix: string): Set<string> {
		return new Set(
			[...source.matchAll(new RegExp(String.raw`\b(${prefix}[a-z0-9_-]+)\b`, "g"))].map((match) => match[1] ?? ""),
		);
	}

	/** The kit's vocabulary: its stylesheets, plus the class names its atoms emit. */
	const KIT = defined([WEB_BASE_CSS, WEB_THEME_CSS, WEB_LAYOUT_CSS, WEB_COMPONENTS_CSS].join("\n"), "bf-");
	for (const atom of [
		brandLockup("board"),
		themeToggle(),
		chip({ label: "board-core", tone: "accent" }),
		button({ label: "Add card", variant: "primary" }),
		keysSheet([{ keys: "?", label: "this sheet" }]),
	]) {
		for (const name of used(atom, "bf-")) KIT.add(name);
	}

	const DOCUMENTS = [renderBoardPage({ view: "board" }), renderBoardPage({ view: "team" })];
	const SOURCES = [...DOCUMENTS, BOARD_CLIENT_JS];
	const PAGE = defined(BOARD_CSS, "board-");
	// An id is a name the client finds an element by; a class is a name it dresses one with.
	for (const document of DOCUMENTS) {
		for (const match of document.matchAll(/\bid="([a-z0-9_-]+)"/g)) PAGE.add(match[1] ?? "");
	}

	test("finds the vocabulary it claims to check", () => {
		// A parser that stopped matching would make the checks below vacuous.
		expect(KIT.size).toBeGreaterThan(40);
		expect(PAGE.size).toBeGreaterThan(5);
	});

	test("names no kit class the kit does not define", () => {
		const unknown = [...new Set(SOURCES.flatMap((source) => [...used(source, "bf-")]))]
			.filter((name) => !KIT.has(name))
			.sort();
		expect(unknown).toEqual([]);
	});

	test("names no page class this page does not define", () => {
		const unknown = [...new Set(SOURCES.flatMap((source) => [...used(source, "board-")]))]
			.filter((name) => !PAGE.has(name))
			.sort();
		expect(unknown).toEqual([]);
	});
});
