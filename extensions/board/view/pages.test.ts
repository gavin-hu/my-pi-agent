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
		expect(page).toContain('<html lang="en" data-view="board">');
		expect(page).toContain("/app.js");
		expect(page.trimEnd().endsWith("</html>")).toBe(true);
	});

	test("carries no write surface at all", () => {
		// The page reads. A form, a composer, a banner, or a footer of verbs would each be
		// a promise the server refuses, so none of them is in the document to begin with.
		const page = renderBoardPage({ view: "board" });
		for (const gone of [
			"data-writes",
			'id="board-new"',
			'id="board-composer"',
			'id="board-new-dialog"',
			'id="board-confirm"',
			'id="board-banner"',
			'id="board-first-card"',
			'id="card-dialog-note"',
			'id="card-dialog-actions"',
		]) {
			expect(page, gone).not.toContain(gone);
		}
		expect(page).not.toContain("<form");
		// And the client asks nothing the document no longer answers.
		for (const gone of ["data-writes", "board.may =", "canWrite", "board.act(", "board.add(", "board.editCard"]) {
			expect(BOARD_CLIENT_JS, gone).not.toContain(gone);
		}
	});

	test("opens on the tab it was asked for, with the other one hidden", () => {
		const board = renderBoardPage({ view: "board" });
		const team = renderBoardPage({ view: "team" });
		expect(board).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team" hidden');
		expect(team).toContain('id="panel-team" role="tabpanel" aria-labelledby="tab-team"');
		expect(team).toContain('id="panel-board" role="tabpanel" aria-labelledby="tab-board" hidden');
	});

	test("carries the regions and the one dialog the client fills", () => {
		const page = renderBoardPage({ view: "board" });
		for (const id of [
			"board-me",
			"board-status",
			"board-progress",
			"board-progress-fill",
			"board-progress-text",
			"board-filter",
			"keys-open",
			"board-picker",
			"board-lanes",
			"board-no-cards",
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
			"keys-dialog",
			"keys-close",
		]) {
			expect(page, id).toContain(`id="${id}"`);
		}
	});

	test("an empty board says how a card is made, in the terminal's words", () => {
		const page = renderBoardPage({ view: "board" });
		// The page cannot add one, so the empty state names the command that can instead of
		// offering a button that would take a reader nowhere.
		expect(page).toContain("<code>board add</code>");
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
		expect(BOARD_CSS.split(".board-dialog__notes{display:flex")).toHaveLength(2);
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
	test("carries the paint, the round, the card dialog, the keys, and the entry point", () => {
		expect(BOARD_CLIENT_JS).toContain("board.render = function");
		expect(BOARD_CLIENT_JS).toContain("board.openCard = function");
		expect(BOARD_CLIENT_JS).toContain("board.start = function");
		expect(BOARD_CLIENT_JS).toContain("board.start();");
	});

	test("keeps ages honest, which is the one thing a quiet board must still do", () => {
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
		// Every state a teammate can be in, including the three that are not a heartbeat.
		for (const state of ["live", "quiet", "gone", "absent", "unknown"]) expect(BOARD_CLIENT_JS).toContain(state);
		// A bus that is not loaded must read as unknown rather than as "nobody".
		expect(BOARD_CLIENT_JS).toContain("view.teammates === undefined ? null : view.teammates");
		expect(BOARD_CLIENT_JS).toContain("board-team__id");
		// The rows are reasons to pick a card up in the terminal, not verbs: a page that
		// offered Reclaim would be offering the server's refusal.
		expect(BOARD_CLIENT_JS).not.toContain('"Reclaim #" + card.id');
		// A live peer that is not listening is marked, because a message to it waits for its
		// next turn; a quiet one is not, because its heartbeat is the bigger news.
		expect(BOARD_CLIENT_JS).toContain('mate.state === "live" && mate.listening === false');
		expect(BOARD_CLIENT_JS).toContain("not listening");
		// A process that is gone outranks a stale heartbeat, and the card it held is
		// queued with that reason instead of waiting for half an hour of silence.
		expect(BOARD_CLIENT_JS).toContain('if (mate.state === "gone") return 1;');
		expect(BOARD_CLIENT_JS).toContain("is not running");
		expect(BOARD_CLIENT_JS).toContain("gone: 1");
	});

	test("reads one card whole: its lane, its notes, and what it waits for", () => {
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-state")');
		expect(BOARD_CLIENT_JS).toContain("board-dialog__note-head");
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-depends")');
		// The title is the only door: a face that drew a verb would draw a refusal.
		expect(BOARD_CLIENT_JS).toContain("board.openCard");
		expect(BOARD_CLIENT_JS).not.toContain("board-card__actions");
	});

	test("folds finished work once, and gives an empty lane a rail", () => {
		// Nineteen done cards is history the three live lanes should not have to sit
		// beside unfolded; the count in the head is the fact. The default is written only
		// while unset, so a reader's toggle decides from the first click on.
		expect(BOARD_CLIENT_JS).toContain('lane.status === "done"');
		expect(BOARD_CLIENT_JS).toContain("DONE_FOLD_AT");
		expect(BOARD_CLIENT_JS).toContain("board.collapsed[lane.status] === undefined");
		// The rail is about what the lane is showing, never about the filter: filtering is a
		// view of the cards, not a statement that the lane holds none. A folded lane shows
		// nothing either, so it takes the same width and hands the rest to the lanes a
		// reader is reading.
		expect(BOARD_CLIENT_JS).toContain('setAttribute("data-empty", lane.cards.length === 0');
		expect(BOARD_CLIENT_JS).toContain('section.setAttribute("data-folded"');
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

	test("keeps no permission table, no request, and no dialog but the card's", () => {
		// One rule lives in `lib/board/rules.ts`, and the page asks it nothing because the
		// page asks for nothing: a second table here is how the two drifted apart.
		for (const gone of ["board.may =", "canWrite", "function request(", "bfConfirm", "bfNew", "board.banner"]) {
			expect(BOARD_CLIENT_JS, gone).not.toContain(gone);
		}
		expect(BOARD_CLIENT_JS).not.toContain("alert(");
		expect(BOARD_CLIENT_JS).toContain("window.bfCard.open()");
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
