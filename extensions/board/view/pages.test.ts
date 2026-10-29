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
import { BOARD_TONES, DECISION_KINDS, DECISION_TONE } from "../../../lib/board/tone.ts";

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
			"board-no-cards-title",
			"board-no-cards-sub",
			"board-no-cards-hint",
			"board-no-match-clear",
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
		// The page cannot add a card, so the empty state names the command that can instead of
		// offering a button that would take a reader nowhere. The other state — a filter that
		// matches nothing — reuses the block with its own sentence and one way back.
		expect(page).toContain("<code>board add</code>");
		expect(page).toContain('id="board-no-match-clear" hidden>Clear filter</button>');
		// The sheet says what a dialog keeps, so a key that does nothing is not read as broken.
		expect(page).toContain("A card dialog keeps /, t, and ? for itself; Esc closes it.");
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
		// The narrow lane switch is a group of pressed buttons, not a second tablist: it has no
		// tabpanel behind it, and a tab without one is what this used to be.
		expect(page).toContain('id="board-picker" role="group" aria-label="Lane"');
		// A tab says which one is showing through `aria-selected`, and the strip has one tab in
		// the Tab order: the two attributes below are the whole of a roving tablist. The
		// stylesheet still names `aria-current` for the segmented rows other pages use.
		expect(page).toContain(
			'id="tab-board" data-view="board" aria-controls="panel-board" aria-selected="true" tabindex="0"',
		);
		expect(page).toContain(
			'id="tab-team" data-view="team" aria-controls="panel-team" aria-selected="false" tabindex="-1"',
		);
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

	test("keeps its own text above AA and its targets at 24px", () => {
		// `--dim` is held at 3:1 by the kit's contract, which is a gutter's threshold, not a
		// sentence's: the empty word and a note's age are body text, so they read `--muted`.
		expect(BOARD_CSS).toContain(".board-lane__empty{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}");
		expect(BOARD_CSS).toContain(".board-dialog__note-at{font:var(--fs-xs) var(--font-mono);color:var(--muted)}");
		// The fold control and a finished card's id are the two targets a row makes small.
		expect(BOARD_CSS).toContain("min-height:24px");
		expect(BOARD_CSS).toContain(
			".board-team__id{appearance:none;border:0;background:none;padding:5px 8px;margin:-5px -8px;min-height:24px",
		);
	});

	test("wraps the lane switch on a phone instead of hiding a lane", () => {
		// Five labels do not fit 320px; a horizontal strip would clip the lane a reader is on, so
		// the narrowest layout wraps the same buttons as pills.
		expect(BOARD_CSS).toContain("@media (max-width:420px){");
		expect(BOARD_CSS).toContain(".board-picker{flex-wrap:wrap;border:0;background:none;gap:var(--space-1)}");
	});

	test("wears its priority as a filed chip and its paths as code", () => {
		// A priority is a field a card carries, so it wears the kit's quiet pill rather than the
		// same muted text as its age; a path hint is something a reader types, so it is mono.
		expect(BOARD_CLIENT_JS).toContain('chip(card.priority, "outline")');
		expect(BOARD_CSS).toContain(".board-card__paths .bf-chip{font-family:var(--font-mono)}");
		// Two mono paths four pixels apart read as one path that wrapped, so the list keeps the
		// dialog's taller column gap: the separation is the only thing saying where one ends.
		expect(BOARD_CSS).toContain(
			".board-card__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:0;padding:0;list-style:none}",
		);
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

	test("says how many files the board could not read, and names them on the hover", () => {
		// A footer counting only what it read would report "2 cards" over a directory
		// holding three files, and a reader cannot tell that from an empty board. The line
		// carries the count; the hover carries the tool's own sentence, spliced in, so the
		// page and `board list` name the same files for the same reason.
		expect(BOARD_CLIENT_JS).toContain("view.skipped.length");
		expect(BOARD_CLIENT_JS).toContain('" could not be read"');
		expect(BOARD_CLIENT_JS).toContain("skippedText(view.skipped)");
		expect(BOARD_CLIENT_JS).toContain("function skippedText(skipped)");
		expect(BOARD_CLIENT_JS).not.toContain("__SKIPPED__");
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
		expect(BOARD_CLIENT_JS).toContain("matchesLabel(mate.label)");
		expect(BOARD_CLIENT_JS).toContain("laneWithWork(view)");
		expect(BOARD_CLIENT_JS).toContain("line.title = reason.text");
		expect(BOARD_CLIENT_JS).toContain("why.title = entry.why");
	});

	test("draws a card's face from the snapshot, and never from its own reading", () => {
		// The waits and the dependents arrive already named: the snapshot owns which cards
		// block and what each is called, so the face draws them rather than looking them up.
		expect(BOARD_CLIENT_JS).toContain("card.dependents");
		expect(BOARD_CLIENT_JS).toContain('"holds up " + card.dependents');
		// The hints past the third are on the chip's hover and in the list, never dropped.
		expect(BOARD_CLIENT_JS).toContain("more.title = beyond.join");
		expect(BOARD_CLIENT_JS).toContain('el("li", "sr-only", beyond[j])');
		// The note count and its age, through the same plural the rest of the page counts with;
		// the age only when it is not the card's own stamp printed twice.
		expect(BOARD_CLIENT_JS).toContain('plural(card.notes.length, "note")');
		expect(BOARD_CLIENT_JS).toContain("ago(last.at) !== ago(card.updatedAt)");
		expect(BOARD_CLIENT_JS).toContain('"last note {age} by " + last.by');
		// What the eye gets on a hover, the keyboard gets described: j/k only ever focuses.
		expect(BOARD_CLIENT_JS).toContain('title.setAttribute("aria-describedby"');
		// Where the reader is and has been: two marks the client owns alone.
		expect(BOARD_CLIENT_JS).toContain("board.markCards = function");
		expect(BOARD_CLIENT_JS).toContain('"data-current"');
	});

	test("keeps a stamp's own wording, so two ages on one card read as two facts", () => {
		// A card now shows when it was written to and when its last note landed; a ticker
		// that assumed "updated" would relabel the second one within a minute.
		expect(BOARD_CLIENT_JS).toContain('stamp(card.updatedAt, "updated {age}")');
		expect(BOARD_CLIENT_JS).toContain('node.setAttribute("data-at-title", wording)');
		expect(BOARD_CLIENT_JS).toContain("board.sentence(wording, next)");
	});

	test("marks the read card and the current one through tokens, not literals", () => {
		// Both marks are edges on the card a reader has read and the one they are on.
		expect(BOARD_CSS).toContain('.board-card[data-visited="true"]{box-shadow:inset 3px 0 0 var(--border-strong)}');
		expect(BOARD_CSS).toContain(
			'.board-card[data-current="true"]{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}',
		);
		// The line under the reason clamps like the reason, which is why it is described too,
		// and it keeps the card's own voice: warn means a reader has to decide something.
		expect(ownRules()).toMatch(/\.board-card__holds\{[^}]*-webkit-line-clamp:2/);
		expect(ownRules()).toMatch(/\.board-card__holds\{[^}]*color:var\(--muted\)/);
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
		// The queue's rank is the board's one list, spliced in: a killed owner sits second,
		// above a card merely sitting still, and the row wears the tone the same table gives
		// that kind — which is how it stopped being ranked second and drawn quietest.
		expect(BOARD_CLIENT_JS).toContain(
			'var DECISION_RANK = ["blocked","gone","approval","waiting","idle","unplanned","unassigned"]',
		);
		expect(BOARD_CLIENT_JS).toContain("board.rankOf");
		expect(BOARD_CLIENT_JS).toContain('node.setAttribute("data-tone", decisionTone(entry.kind))');
	});

	test("folds the owners a bus has no record of, and the ids past the strip's sixth", () => {
		// The roster is the other list that only grows: every label that ever claimed a card stays
		// an owner, so a board with a long history drew eighteen rows of "no record · no cards ·
		// 1 done". The rule is stated once — absent, and holding nothing — and the row it makes
		// says what the rows would have said one at a time. Both are `lib/board/round-text.ts`'s
		// bodies, because the terminal's round folds the same owners.
		expect(BOARD_CLIENT_JS).toContain("board-team__tail");
		expect(BOARD_CLIENT_JS).toContain(
			"isHistoryOwner(rows[r].label, rows[r].cards.live.length, roster === null ? undefined : roster)",
		);
		// The rule and the sentence are the terminal round's own bodies, spliced in like `plural`,
		// so the tab cannot grow a second answer to who is history.
		expect(BOARD_CLIENT_JS).toContain("function isHistoryOwner(label, held, roster)");
		expect(BOARD_CLIENT_JS).toContain("function historyLine(owners, done)");
		expect(BOARD_CLIENT_JS).toContain('plural(owners, "owner")');
		expect(BOARD_CLIENT_JS).toContain("with no record");
		expect(BOARD_CLIENT_JS).toContain("historyLine(tail.length, finished)");
		expect(unfilledPlaceholders(BOARD_CLIENT_JS)).toEqual([]);
		// A filter is a view of the rows, so it unfolds the history rather than hiding a match.
		expect(BOARD_CLIENT_JS).toContain("var folded = filtering ? false : historyFolded(everyone.tail)");
		// Both lists fold through one table and one map, and the keys say which kind they are
		// because `done` is already a lane.
		expect(BOARD_CLIENT_JS).toContain("board.foldAt.roster");
		expect(BOARD_CLIENT_JS).toContain("board.foldAt.done");
		expect(BOARD_CLIENT_JS).toContain('board.toggleFold("team-roster")');
		expect(BOARD_CLIENT_JS).toContain('board.toggleFold("team-done")');
		expect(BOARD_CLIENT_JS).toContain("board-team__ids");
		expect(BOARD_CLIENT_JS).toContain('rest.id = "team-done-ids"');
		// A fold repaints the panel it lives in, so focus is put back on the control by key.
		expect(BOARD_CLIENT_JS).toContain("data-fold");
		expect(BOARD_CLIENT_JS).toContain("document.querySelector('[data-fold=\"' + key + '\"]')");
		// And a frame that changes nothing in a panel neither rebuilds it nor moves the reader.
		expect(BOARD_CLIENT_JS).toContain('if (slot.getAttribute("data-sig") === sig) return;');
		expect(BOARD_CLIENT_JS).toContain("board.teamPanels");
		// A heartbeat is not news either: `seen` is not in the signature at all, because a live row
		// prints no age and a quiet session that pings is live again on the next snapshot — so the
		// frame after every heartbeat no longer refills the list and takes the reader's place.
		expect(BOARD_CLIENT_JS).toContain('mate.label + "," + mate.state + "," + mate.mail + "," + mate.listening');
		expect(BOARD_CLIENT_JS).not.toContain("Math.floor(mate.seen / 60000)");
		// The stamp is still what draws a quiet row's age; it is the *signature* that leaves it out.
		expect(BOARD_CLIENT_JS).toContain("stamped(ago(mate.seen), mate.seen)");
	});

	test("caps both Team lists with one rule, and draws a teammate row on one line", () => {
		expect(BOARD_CSS).toContain(".board-team__queue,.board-team__roster{max-height:max(18rem,calc(100dvh - 16rem))");
		// One line: the metrics take the rest of the row instead of always starting a second.
		expect(BOARD_CSS).toContain(".board-team__mets{flex:1 1 auto;min-width:0;margin:0;text-align:right;");
		expect(BOARD_CSS).toContain(
			".board-team__name{font:var(--fw-medium) var(--fs-md) var(--font-ui);color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
		);
		// The fold controls are pointer targets, like the ids beside them.
		expect(BOARD_CSS).toContain(".board-team__tail{display:flex;flex:1 1 100%;");
		expect(BOARD_CSS).toMatch(/\.board-team__tail\{[^}]*min-height:24px/);
		expect(BOARD_CSS).toMatch(/\.board-team__fold\{[^}]*min-height:24px/);
		// The strip's hidden ids take the strip's own gap and wrapping rather than jamming.
		expect(BOARD_CSS).toContain(".board-team__ids{display:contents}");
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
		expect(BOARD_CLIENT_JS).toContain("board.foldAt");
		expect(BOARD_CLIENT_JS).toContain("board.collapsed[lane.key] === undefined");
		// The rail is about what the lane is showing, never about the filter: filtering is a
		// view of the cards, not a statement that the lane holds none. A folded lane shows
		// nothing either, so it takes the same width and hands the rest to the lanes a
		// reader is reading.
		expect(BOARD_CLIENT_JS).toContain('setAttribute("data-empty", lane.cards.length === 0');
		expect(BOARD_CLIENT_JS).toContain('section.setAttribute("data-folded"');
	});

	test("sizes a lane by the work it holds, except finished work", () => {
		// Two cards earn more width than one, and history is the exception: five done cards used
		// to take half the row while the one card still being worked sat on its floor and
		// elided its own title. A fold decides how much finished work is drawn; this decides
		// how much row it may take while it is drawn.
		expect(BOARD_CSS).toContain("flex-grow:calc(1 + var(--lane-count))");
		expect(BOARD_CSS).toContain('.board-lane[data-lane="done"]{flex-grow:calc(1 + min(3, var(--lane-count)))}');
	});

	test("pins a lane head to the pane's own edge", () => {
		// A sticky head pins to the scroll box's padding edge, so a gutter left on the pane is a
		// 20px strip along the top where the card above scrolls through unheaded. The gutter is
		// the panel's, which scrolls with the lanes.
		expect(BOARD_CSS).toContain(".board-main{flex:1 1 auto;padding-top:0}");
		expect(BOARD_CSS).toContain(
			".board-panel{display:flex;flex-direction:column;min-width:0;padding-top:var(--space-5)}",
		);
		expect(BOARD_CSS).toContain(".board-lane__head{position:sticky;top:0");
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
		// The block is one record now, and the line says what kind of block it is when nobody
		// wrote a sentence — the one thing a reader needs to know what the card is waiting on.
		expect(BOARD_CLIENT_JS).toContain('"blocked on a "');
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

	test("reads a note with the kit's one inline Markdown renderer, not a parser of its own", () => {
		// A note is the one stored field that may become more than text, so the exception is
		// named where the refusals are: the renderer is the shared one, and it appends nodes.
		expect(BOARD_CLIENT_JS).toContain("function renderInline(container, text)");
		expect(BOARD_CLIENT_JS).toContain("function safeHref(url, base)");
		expect(BOARD_CLIENT_JS).toContain("renderInline(text, note.text)");
		// One body: the page carries the kit's renderer rather than a copy of the grammar.
		expect(BOARD_CLIENT_JS.split("function renderInline(container, text)")).toHaveLength(2);
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

	test("declares no lane table of its own", () => {
		// The words are the snapshot's now: a label, an empty word, a colour, and a limit arrive
		// per lane, so the client cannot spell one lane two ways — the table it used to ship
		// (`LANE_LABEL`) is gone, and this is the case that keeps it gone.
		expect(BOARD_CLIENT_JS).not.toContain("LANE_LABEL");
		expect(BOARD_CLIENT_JS).not.toContain("LANE_EMPTY");
		expect(BOARD_CLIENT_JS).toContain("lane.label");
		expect(BOARD_CLIENT_JS).toContain("lane.empty");
		// The fragments still have no import graph, so a constant two of them need is either
		// declared once and published, or declared twice and free to drift.
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
		"data-at-title": "a stamp's own wording, which the ticker fills from the same stamp",
		"data-card": "the open card is found by its id",
		"data-fold": "a fold control names its key, so focus finds it again after the repaint it caused",
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

	test("draws a decision row in the tone the table gives its kind, gone included", () => {
		expect(DECISION_TONE.gone).toBe("danger");
		for (const kind of DECISION_KINDS) {
			const tone = DECISION_TONE[kind];
			expect(BOARD_CSS, kind).toContain(`.board-team__decision[data-tone="${tone}"]{border-left-color:var(--${tone})}`);
		}
		// A refusal or a loss colours its sentence too; a warn row only its edge.
		expect(BOARD_CSS).toContain('.board-team__decision[data-tone="danger"] .board-team__why{color:var(--danger)}');
		// And the sentence every other row prints stays quiet. Without this the base rule can
		// lose its colour and the queue's reasons read as loudly as its titles: `--text` is
		// what an uncoloured paragraph inherits on the raised plane.
		expect(BOARD_CSS).toContain(".board-team__why{grid-area:why;margin:0;color:var(--muted);");
	});

	test("tones a reason line by its tone, never by a class named after a kind", () => {
		// The three gates a card can owe — a contract, an approval, a spot-check — are three
		// kinds and one tone, and none of them is called "unplanned" any more.
		expect(BOARD_CSS).toContain(".board-card__reason--warn{color:var(--warn)}");
		expect(BOARD_CSS).not.toContain("board-card__reason--unplanned");
		expect(BOARD_CSS).not.toContain("board-card__reason--blocked");
		expect(BOARD_CSS).not.toContain("board-team__why--blocked");
		// And it comes after the base rule, which is what makes it win: a tone class and the
		// base class are one class each, so source order decides between them. Generated
		// before the base, every tone was inert and a blocked card's reason drew muted.
		for (const tone of BOARD_TONES) {
			expect(BOARD_CSS.indexOf(`.board-card__reason--${tone}{`), tone).toBeGreaterThan(
				BOARD_CSS.indexOf(".board-card__reason{margin:0"),
			);
		}
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
