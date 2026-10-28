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
import { duplicateDeclarations, unfilledPlaceholders, unreadPublications } from "../../../test/helpers/bundle.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CLASS } from "./names.ts";
import { renderBoardPage } from "./page.ts";
import { BOARD_CSS } from "./styles.ts";

/** The page's own rules, without the shared blocks that define the palette. */
function ownRules(): string {
	return BOARD_CSS.slice(BOARD_CSS.indexOf(WEB_COMPONENTS_CSS) + WEB_COMPONENTS_CSS.length);
}

describe("the document", () => {
	test("is a complete page under the shared head", () => {
		const page = renderBoardPage({ view: "board" });
		expect(page.startsWith("<!doctype html>")).toBe(true);
		expect(page).toContain('<html lang="en" data-view="board">');
		expect(page).toContain("/app.js");
		expect(page.trimEnd().endsWith("</html>")).toBe(true);
	});

	test("names the board in the tab, and lets the count refine it", () => {
		const page = renderBoardPage({ view: "board" });
		// The head answers before a frame arrives; the count needs the store, so the client
		// paints the rest — one sentence, in the one place a browser reads it.
		expect(page).toContain("<title>board</title>");
		expect(page).toContain('rel="icon"');
		// The tab's shape is the kit's, spliced in as one body rather than rewritten here,
		// and the subject it is given is the repository's name: a store key is a hash.
		expect(BOARD_CLIENT_JS).toContain("var tabTitle = function tabTitle(");
		expect(BOARD_CLIENT_JS).toContain('tabTitle("board", view.repo');
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
			"card-dialog-id",
			"card-dialog-where",
			"card-dialog-card-head",
			"card-dialog-notes-head",
			"card-dialog-note-count",
			"card-dialog-owner",
			"card-dialog-owner-label",
			"card-dialog-priority",
			"card-dialog-updated",
			"card-dialog-lane",
			"card-dialog-lane-label",
			"card-dialog-by",
			"card-dialog-landed",
			"card-dialog-depends",
			"card-dialog-dependents",
			"card-dialog-plan",
			"card-dialog-paths",
			"card-dialog-path-list",
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
		expect(BOARD_CSS.split(".board-dialog__facts{display:grid")).toHaveLength(2);
	});

	test("gives the record the shape a reader asked for", () => {
		// One scroll: the kit's dialog body. A nested notes box used to hide most of the
		// cargo behind a second scrollbar inside a 70vh panel.
		expect(BOARD_CSS).not.toContain("max-height:16rem");
		// The notes are the record, so they read at body size on a measure rather than at
		// the panel's smallest type across its whole width.
		const note = ownRules().match(/\.board-dialog__note-text\{[^}]*\}/)?.[0] ?? "";
		expect(note).toContain("--fs-base");
		expect(note).toContain("68ch");
		// A path is one line, elided, with the whole of it on the hover title.
		expect(BOARD_CSS).toContain(".board-dialog__value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}");
	});

	test("keeps a card's text inside its border", () => {
		// A chip is one line and nowrap by design, so an owner label or a path longer than the
		// card used to spill past its border and across the lane beside it. The list item is
		// what shrinks, the chip is what clips, and the whole value is on the hover title.
		expect(BOARD_CSS).toContain(".board-card__paths li{min-width:0;max-width:100%}");
		expect(BOARD_CSS).toContain(
			".board-card .bf-chip{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
		);
		expect(BOARD_CLIENT_JS).toContain("hint.title = shown[i]");
		// A title with no spaces in it wraps to the two-line clamp instead of being cut mid-word.
		expect(ownRules()).toMatch(/\.board-card__title\{[^}]*overflow-wrap:anywhere/);
	});

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

	test("says how many files the board could not read, beside its size", () => {
		// A footer counting only what it read would report "2 cards" over a directory
		// holding three files, and a reader cannot tell that from an empty board.
		expect(BOARD_CLIENT_JS).toContain("view.skipped");
		expect(BOARD_CLIENT_JS).toContain('plural(view.skipped, "unreadable")');
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

	test("reads one card whole: its lane, its facts as a ladder, and its notes", () => {
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-state")');
		// Names come from the page's table, so the bundle holds the lookup, not the class.
		expect(BOARD_CLIENT_JS).toContain("N.dialogNoteFoot");
		// The ladder is written once: a row is a name, and the label and the value are
		// found from it, so a row cannot ship with one half hidden.
		expect(BOARD_CLIENT_JS).toContain('"card-dialog-" + name + "-label"');
		for (const row of ["updated", "by", "landed", "depends", "dependents", "plan"]) {
			expect(BOARD_CLIENT_JS, row).toContain(`setRow("${row}"`);
		}
		// The title is the only door: a face that drew a verb would draw a refusal.
		expect(BOARD_CLIENT_JS).toContain("board.openCard");
		expect(BOARD_CLIENT_JS).not.toContain("board-card__actions");
	});

	test("folds finished work once, and gives an empty lane a rail", () => {
		// Nineteen done cards is history the three live lanes should not have to sit
		// beside unfolded; the count in the head is the fact. The default is written only
		// while unset, so a reader's toggle decides from the first click on.
		expect(BOARD_CLIENT_JS).toContain('lane.key === "done"');
		expect(BOARD_CLIENT_JS).toContain("DONE_FOLD_AT");
		expect(BOARD_CLIENT_JS).toContain("board.collapsed[lane.key] === undefined");
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

	test("says what a block waits on, and what closed a finished card", () => {
		// The reason slot carries the recorded reason rather than the last note somebody
		// happened to write, and the commit is the one fact a finished card cannot say itself.
		// One body answers both, spliced in from lib/board/reason.ts.
		expect(BOARD_CLIENT_JS).toContain('"blocked, with nothing recorded"');
		expect(BOARD_CLIENT_JS).toContain('landed " + card.landed.commit');
		// The Team tab's queue asks the same rule rather than re-deriving a sentence.
		expect(BOARD_CLIENT_JS).toContain("board.reasonFor(card, ago)");
	});

	test("says an offer went unanswered, on the card and in the lead's queue", () => {
		// One record, one body: the card face says how long the broadcast has stood, and the
		// Team tab's row reads the same sentence about the same fact, because the rule is
		// spliced into the bundle once.
		expect(BOARD_CLIENT_JS).toContain("offered ");
		expect(BOARD_CLIENT_JS).toContain("nobody took it");
		// The age itself is not a second copy: the bundle is handed `lib/format.ts`'s body.
		expect(BOARD_CLIENT_JS).toContain("var ageText = function formatAge(");
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
		// The page is mounted under the session's one origin, so its own stream is named from
		// the base the document carries rather than from the origin's root.
		expect(BOARD_CLIENT_JS).toContain('new EventSource(pageBase() + "/events?token=');
		expect(BOARD_CLIENT_JS).toContain('new URLSearchParams(window.location.search).get("token")');
	});

	test("prints counts through the module's one plural, spliced in", () => {
		// The bundle has no import graph: the source crosses the boundary, so the page and
		// the tool say `1 card` the same way.
		expect(BOARD_CLIENT_JS).toContain('count + " " + noun + (count === 1 ? "" : "s")');
		expect(BOARD_CLIENT_JS).not.toContain("__PLURAL__");
		expect(BOARD_CLIENT_JS).toContain("board.plural = plural;");
	});

	test("filters through the module's one query rule, spliced in", () => {
		// Same reason as the plural: the filter box and `board list query:` must find the
		// same cards, and a copy in the bundle is how they stopped doing that.
		expect(BOARD_CLIENT_JS).toContain("card.planPath.toLowerCase().includes(needle)");
		expect(BOARD_CLIENT_JS).toContain("card.notes.some");
		expect(BOARD_CLIENT_JS).not.toContain("__MATCHES__");
		expect(BOARD_CLIENT_JS).toContain("board.matches = matches;");
	});

	test("reads what the snapshot decided instead of deciding it again", () => {
		// A dependency graph, a priority default, and a reason sentence each live once.
		expect(BOARD_CLIENT_JS).toContain("card.waits");
		expect(BOARD_CLIENT_JS).toContain('card.priority !== "normal"');
		for (const gone of ["blockersOf", "waitingText", "priorityOf", "dependsOn"]) {
			expect(BOARD_CLIENT_JS, gone).not.toContain(gone);
		}
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

	test("fills every template rule it splices", () => {
		// `renderJs` replaces five `__NAME__` rules with `lib/` sources; a lost `.replace`
		// leaves the literal in the served script, where it is a ReferenceError on the
		// page's first paint and nothing else sees it.
		expect(unfilledPlaceholders(BOARD_CLIENT_JS)).toEqual([]);
	});

	test("is one self-contained script", () => {
		// Balanced braces are a cheap proof the concatenation did not cut a module
		// short, which is the failure mode a template string has.
		const opens = (BOARD_CLIENT_JS.match(/\{/g) ?? []).length;
		const closes = (BOARD_CLIENT_JS.match(/\}/g) ?? []).length;
		expect(opens).toBe(closes);
		expect(BOARD_CLIENT_JS.length).toBeGreaterThan(4_000);
	});

	test("declares a shared word once, so one lane has one name", () => {
		// The fragments have no import graph, so a constant two of them need is either
		// declared once and published, or declared twice and free to drift: `LANE_LABEL`
		// shipped twice, and the lane head and the dialog could have spelled it apart.
		expect(duplicateDeclarations(BOARD_CLIENT_JS)).toEqual([]);
	});

	test("publishes nothing nobody reads", () => {
		// A helper published for a caller that stopped calling it stays forever in a string
		// no compiler reads: `board.laneLabel` outlived the dialog's move buttons.
		expect(unreadPublications(BOARD_CLIENT_JS)).toEqual([]);
	});
});

/**
 * The class contract: the page may only wear classes that exist.
 *
 * A `bf-…` name is the kit's vocabulary — its stylesheet plus what its own atoms
 * emit — and a `board-…` name comes from {@link BOARD_CLASS}, the table the document
 * and the bundle both read. A name either side invents renders as an unstyled element,
 * which is exactly how the tab groups shipped as browser-default buttons: the markup
 * said `role="tab"` and never said `bf-segmented__item`.
 *
 * The page's own half is compared as two sets, not as spellings: the table against the
 * stylesheet's selectors, both directions. A name assembled at runtime used to make that
 * impossible — `"board-card__reason" + kind` reads as a prefix to any scan — so the table
 * is what lets a missing rule fail here instead of in a screenshot.
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
	/** The page's own vocabulary: what its table declares. */
	const PAGE = new Set<string>(Object.values(BOARD_CLASS));
	/** The names the stylesheet draws. */
	const DRAWN = defined(BOARD_CSS, "board-");
	/** Every id, which the client finds an element by and no stylesheet dresses. */
	const IDS = new Set<string>(
		DOCUMENTS.flatMap((document) => [...document.matchAll(/\bid="([a-z0-9_-]+)"/g)].map((match) => match[1] ?? "")),
	);
	/** Attributes whose only reader is the client: an element hook, or a stamp for the age ticker. */
	const HOOKS: Readonly<Record<string, string>> = {
		"data-at": "the age ticker rewrites the text from it",
		"data-card": "the open card is found by its id",
		"data-lane": "a lane section and a card carry the lane they are in",
		"data-picker-lane": "the narrow picker reads which lane a button selects",
		"data-rev": "a lane rebuilds only when a card's revision moves",
		"data-sig": "a lane remembers what it last drew",
		"data-skeleton": "the placeholders are removed once the first frame lands",
		"data-view": "the tab switch writes which panel is current",
		"data-you": "a teammate row marks the reader",
	};

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

	test("wears only what its table declares, ids aside", () => {
		// A class literal that bypassed the table is the failure this exists for: it can be
		// a name with no rule, which renders as an unstyled element and nothing fails.
		const worn = [...new Set(SOURCES.flatMap((source) => [...used(source, "board-")]))];
		const unknown = worn.filter((name) => !PAGE.has(name) && !IDS.has(name)).sort();
		expect(unknown).toEqual([]);
	});

	test("draws every name its table declares, and declares every name it draws", () => {
		// Both directions, so a dead rule and a missing rule are the same failure.
		expect([...PAGE].filter((name) => !DRAWN.has(name)).sort(), "declared, never drawn").toEqual([]);
		expect([...DRAWN].filter((name) => !PAGE.has(name)).sort(), "drawn, never declared").toEqual([]);
	});

	test("styles no attribute the page does not wear, and hooks every one it does", () => {
		// The drift a capture found: an attribute emitted with no rule to act on it.
		const styled = new Set([...ownRules().matchAll(/\[(data-[a-z-]+)/g)].map((match) => match[1] ?? ""));
		// The kit styles some attributes of its own — `data-theme` is the theme layer's — so
		// "is it drawn at all" is asked of the whole stylesheet a page ships.
		const drawn = new Set([...BOARD_CSS.matchAll(/\[(data-[a-z-]+)/g)].map((match) => match[1] ?? ""));
		const worn = new Set(
			SOURCES.flatMap((source) => [...source.matchAll(/\b(data-[a-z-]+)="?/g)].map((m) => m[1] ?? "")),
		);
		expect([...styled].filter((name) => !worn.has(name)).sort(), "styled, never worn").toEqual([]);
		const unsaid = [...worn].filter((name) => !drawn.has(name) && HOOKS[name] === undefined).sort();
		expect(unsaid, "worn, unstyled, and not declared a hook").toEqual([]);
	});
});
