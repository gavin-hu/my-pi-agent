/**
 * The Team tab as a mission control: what the snapshot gives it, and what it must never say.
 *
 * Two halves, because the tab is built in two places. The snapshot's four new facts — a
 * waiting queue with each recipient's state, a derived activity rail, a turn, and the
 * configured lead — are decided server-side in `lib/board/view.ts`, and `buildView` is what
 * these cases call. The tab itself is a string of client source no compiler sees, so its
 * contracts are held against `BOARD_CLIENT_JS` and `BOARD_CSS` the way `pages.test.ts` holds
 * the document: a fact the design promises has a line that draws it, and a fact it refuses
 * has none.
 *
 * The browser suite proves what a reader can *do*; this proves what the page is allowed to
 * say, which is where a dashboard usually goes wrong — a percentage nobody measured, a state
 * carried by a colour alone, a row a pointer is needed to understand.
 */

import { describe, expect, test } from "bun:test";
import { boardDocument as pageOf, ownRules } from "../../../test/helpers/board-document.ts";
import { boardCard as cardFixture } from "../../../test/helpers/fixtures/board.ts";
import { buildView } from "../../../lib/board/view.ts";
import { WAITING_LIMIT } from "../../../lib/session-mail.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CLASS } from "./names.ts";
import { BOARD_CSS } from "./styles.ts";

const NOW = 5_000;
const ME = { id: "board:team-lead", label: "team-lead" };
const WHERE = "~/.pi/agent/board/8872d3adda0e";
const REPO = "my-pi-agent";
const ROOT = "/Users/someone/my-pi-agent";

/** The snapshot as the page gets it, with only the facts a case is about changed. */
function view(over: Partial<Parameters<typeof buildView>[0]> = {}) {
	return buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE, repo: REPO, root: ROOT, ...over });
}

describe("the snapshot the mission control reads", () => {
	test("marks the lead from the config, not from the seat that serves the page", () => {
		const marked = view({
			lead: "Team-Lead",
			roster: [
				{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 },
				{ id: "s-lead", label: "team-lead", mode: "tui", lastSeen: NOW, mail: 0 },
			],
		});
		expect(marked.teammates?.map((mate) => [mate.label, mate.lead === true, mate.you])).toEqual([
			["billing-core", false, false],
			["team-lead", true, true],
		]);
		// A board that names no lead marks nobody: guessing the serving seat would point the tab
		// at a row the gates would refuse after a rename.
		expect(view({ roster: [] }).teammates).toEqual([]);
	});

	test("says a session is working only while its turn's stamp has a fresh heartbeat", () => {
		const working = view({
			roster: [
				{ id: "s-a", label: "a-live-turn", mode: "tui", lastSeen: NOW, mail: 0, turnAt: NOW },
				{ id: "s-b", label: "b-live-idle", mode: "tui", lastSeen: NOW, mail: 0 },
				// A crash mid-run leaves the stamp behind; the heartbeat is what decides.
				{
					id: "s-c",
					label: "c-quiet-turn",
					mode: "tui",
					lastSeen: NOW - 20 * 60_000,
					mail: 0,
					turnAt: NOW - 20 * 60_000,
				},
			],
		});
		expect(working.teammates?.map((mate) => [mate.label, mate.state, mate.working === true])).toEqual([
			["a-live-turn", "live", true],
			["b-live-idle", "live", false],
			["c-quiet-turn", "quiet", false],
		]);
	});

	test("carries the waiting mail, each recipient resolved against the same roster", () => {
		const waiting = [
			{
				id: "m-1",
				from: "s-lead",
				fromLabel: "team-lead",
				kind: "handoff" as const,
				to: ["billing-core"],
				text: "take it",
				at: NOW - 60_000,
			},
			{
				id: "m-2",
				from: "s-lead",
				fromLabel: "team-lead",
				kind: "event" as const,
				to: ["billing-core", "ops-helper"],
				text: "all",
				at: NOW - 30_000,
			},
		];
		const roster = [
			{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 2 },
			{ id: "s-old", label: "ops-helper", mode: "tui", lastSeen: NOW - 20 * 60_000, mail: 1 },
		];
		const queue = view({ waiting: { messages: waiting, dropped: 0 }, roster });
		expect(queue.waiting.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
		expect(queue.waiting.messages[0]?.to).toEqual([{ label: "billing-core", state: "live" }]);
		// The recipient nothing answers for is the one a lead has to act on, and it says so.
		expect(queue.waiting.messages[1]?.to).toEqual([
			{ label: "billing-core", state: "live" },
			{ label: "ops-helper", state: "quiet" },
		]);
		// No bus here is not "gone": the state is left out and the row still draws.
		expect(view({ waiting: { messages: waiting, dropped: 0 } }).waiting.messages[0]?.to).toEqual([
			{ label: "billing-core" },
		]);
		// What the cap left out travels with the rows, so the rail can say how deep the queue is.
		expect(view({ waiting: { messages: waiting, dropped: 14 } }).waiting.dropped).toBe(14);
	});

	test("a message landing or being read moves the frame, because no card did", () => {
		const mail = {
			messages: [{ id: "m-1", from: "s", fromLabel: "s", kind: "message" as const, to: ["me"], text: "hi", at: NOW }],
			dropped: 0,
		};
		const none = view();
		expect(none.waiting).toEqual({ messages: [], dropped: 0 });
		expect(view({ waiting: mail }).sig).not.toBe(none.sig);
		// Reading one of a queue of fifteen moves the frame too: the count is part of the signature.
		expect(view({ waiting: { ...mail, dropped: 1 } }).sig).not.toBe(view({ waiting: mail }).sig);
	});

	test("reads the recent rail off the cards it already drew, capped and counted", () => {
		const notes = Array.from({ length: 12 }, (_, index) => ({ by: "team-lead", at: NOW - index, text: `n${index}` }));
		const rail = view({ cards: [cardFixture("7", { title: "seven", createdAt: NOW, updatedAt: NOW, notes })] });
		expect(rail.activity.events).toHaveLength(10);
		expect(rail.activity.dropped).toBe(2);
		expect(rail.activity.events[0]?.card).toBe("7");
	});
});

describe("the mission control's contracts", () => {
	test("pins the lead first, in the column's own order", () => {
		// The lead outranks the sort whatever its state: a `gone` lead is the row the gates still
		// answer, and a column that let a working peer outrank it points away from that row.
		expect(BOARD_CLIENT_JS).toContain("if (agent.lead) return -1;");
		for (const state of ["live", "gone", "quiet"]) {
			expect(BOARD_CLIENT_JS).toContain(`if (agent.state === "${state}") return`);
		}
		// A lead's card counts the queue, so the eye that starts top-left lands on the reason to
		// look right.
		expect(BOARD_CLIENT_JS).toContain("agent.lead && needs > 0");
		expect(BOARD_CLIENT_JS).toContain('needs + " needs you"');
	});

	test("counts each column itself, a zero included, and never a share of a filtered total", () => {
		expect(BOARD_CLIENT_JS).toContain('board.captionOf("AGENTS"');
		expect(BOARD_CLIENT_JS).toContain('board.captionOf("ACTIVE WORK"');
		expect(BOARD_CLIENT_JS).toContain('board.captionOf("ACTIVITY"');
		// A caption is a count, not a share: the pill a column head draws has no total to show,
		// and the ratio the panes' heads keep is their own (NEEDS YOU against the whole queue).
		expect(BOARD_CLIENT_JS).toContain("board.captionOf = function (text, count, noun)");
		expect(BOARD_CLIENT_JS).toContain('head.appendChild(el("span", N.teamCount, String(count)));');
		// A zero is drawn: an empty lane, an empty pane, and an empty column all say 0.
		expect(BOARD_CLIENT_JS).toContain('slot.appendChild(el("p", N.teamEmpty');
	});

	test("gives every state a word beside its dot, never a colour alone", () => {
		expect(BOARD_CLIENT_JS).toContain('live: "free"');
		expect(BOARD_CLIENT_JS).toContain('absent: "no record"');
		expect(BOARD_CLIENT_JS).toContain("if (agent.working)");
		// A quiet session's pill carries the age a lead needs to decide whether to reclaim.
		expect(BOARD_CLIENT_JS).toContain('pill.setAttribute("aria-label", "quiet for " + ago(agent.seen))');
		// The dot is coloured by the state, and a state with no record is a hollow ring.
		for (const state of ["live", "quiet", "gone"]) {
			expect(BOARD_CSS).toContain(`.board-dot[data-state="${state}"]{background:var(`);
		}
		expect(BOARD_CSS).toContain('.board-dot[data-state="absent"],.board-dot[data-state="unknown"]');
	});

	test("draws a mission card's id as a button, and the whole queue is reachable behind its fold", () => {
		// A mission card opens its card, the same way a board face does.
		expect(BOARD_CLIENT_JS).toContain('button.setAttribute("aria-haspopup", "dialog")');
		expect(BOARD_CLIENT_JS).toContain('el("span", N.missionRef, "#" + card.id)');
		// Three rows, then the same fold control a swimlane uses: one affordance for "there is
		// more" in this column, and it opens the board instead of saying where the board is.
		expect(BOARD_CLIENT_JS).toContain("var STRIP = 3");
		expect(BOARD_CLIENT_JS).toContain('el("button", N.teamLaneFold, "+" + count + " more")');
		// The caption is a count alone: the tab strip is the way to the whole board, so the
		// column carries no second door for a heading to be a control.
		expect(BOARD_CLIENT_JS).not.toContain("board-team__door");
	});

	test("says an empty lane, an empty pane, and an empty board in words", () => {
		expect(BOARD_CLIENT_JS).toContain('section.appendChild(el("p", N.teamLaneEmpty, lane.empty))');
		expect(BOARD_CLIENT_JS).toContain('"no mail is waiting"');
		expect(BOARD_CLIENT_JS).toContain('"nothing has happened yet"');
		// One sentence for the tab, with the columns folded away, when there is nothing at all.
		expect(BOARD_CLIENT_JS).toContain("nothing here yet: no cards, no teammates and no mail");
		expect(BOARD_CLIENT_JS).toContain("shell.grid.hidden = barren");
	});

	test("names a waiting row's recipient, and draws a broadcast once", () => {
		expect(BOARD_CLIENT_JS).toContain("message.to.map(function (each) { return each.label; })");
		expect(BOARD_CLIENT_JS).toContain('node.appendChild(document.createTextNode("all (" + to.length + ")"))');
		// The worst state among the recipients is the one the row wears, and its name is on the hover.
		expect(BOARD_CLIENT_JS).toContain("STATE_RANK[state] &lt; STATE_RANK[worst]".replace("&lt;", "<"));
		// Every glyph is decoration: the kind is a chip with its word in it.
		expect(BOARD_CLIENT_JS).toContain('chip(message.kind, "muted")');
		expect(BOARD_CLIENT_JS).toContain('glyph.setAttribute("aria-hidden", "true")');
		// A rail row's kind is a word too, and a move names the lane it went to.
		expect(BOARD_CLIENT_JS).toContain("ACTIVITY_LABEL[event.kind]");
		expect(BOARD_CLIENT_JS).toContain('label.replace("{lane}"');
	});

	test("draws no percentage, because the record measures no progress", () => {
		// A bar is identity and a count is a count: the tab has no meter for the board's work.
		// The Board tab's done meter is the header's own (#422), and this tab adds none.
		expect(BOARD_CSS).not.toContain("board-team__progress");
		expect(BOARD_CSS).not.toContain("board-team__meter");
		expect(BOARD_CLIENT_JS).not.toContain("team-progress");
	});

	test("names the filter's one subject, because it narrows cards", () => {
		// A query empties two columns that have nothing to do with the card it names, so the box
		// says what it reads: the roster and the mail queue stand still.
		expect(pageOf("team")).toContain('placeholder="filter cards"');
		expect(pageOf("team")).toContain('<span class="sr-only">Filter cards</span>');
		expect(BOARD_CLIENT_JS).not.toContain("function mailMatches");
		expect(BOARD_CLIENT_JS).not.toContain("agent.label.toLowerCase()");
	});

	test("walks a decision row and a mission card with j/k, and enters them", () => {
		// One selector for everything that opens a card, so the walk and the dialog's "n of m"
		// agree about what a card on this page is.
		expect(BOARD_CLIENT_JS).toContain(
			'var nodes = document.querySelectorAll(".bf-row, .board-decision, .board-mission");',
		);
		expect(BOARD_CLIENT_JS).toContain('here.closest(".bf-row, .board-decision, .board-mission")');
		expect(BOARD_CLIENT_JS).toContain('.querySelector(".bf-row__title, .board-decision__open, .board-mission__title")');
	});

	test("is three columns with one page scroll, and the grid is the only thing it lays out", () => {
		expect(BOARD_CSS).toContain(
			".board-team__grid{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr) minmax(0,20rem)",
		);
		expect(BOARD_CSS).not.toContain("board-team__queue,.board-team__roster{max-height");
		// The kit's class vocabulary is still the only one it wears, and every name it declares is drawn.
		for (const name of Object.values(BOARD_CLASS).filter((value) => value.startsWith("board-team"))) {
			expect(BOARD_CSS, name).toContain(`.${name}`);
		}
		// A caption sticks; a lane's head does not, because the page has one scroll box and the
		// column captions are its only landmarks.
		expect(ownRules()).toMatch(/\.board-team__caption\{[^}]*position:sticky/);
	});

	test("draws the counting pill in tabular figures, so two columns' numbers line up", () => {
		for (const rule of ["board-team__count", "board-team__lane-count", "board-team__pane-count"]) {
			expect(BOARD_CSS, rule).toMatch(new RegExp(`\\.${rule}\\{[^}]*font-variant-numeric:tabular-nums`));
		}
	});

	test("caps the queue at the snapshot's own limit, so the two cannot disagree", () => {
		// The page draws what it was given: the cap is `WAITING_LIMIT` in the reader, and the rail's
		// cap is `ACTIVITY_LIMIT` in the derivation. A page that sliced again would hide a row the
		// signature still counted.
		expect(WAITING_LIMIT).toBe(6);
		expect(BOARD_CLIENT_JS).not.toContain("view.waiting.slice");
		// What the cap left out is drawn, not dropped: a queue of twenty says 6/20 rather than
		// reading like a quiet board.
		expect(BOARD_CLIENT_JS).toContain("waiting.length + queue.dropped");
		expect(BOARD_CLIENT_JS).toContain("var events = recent.events;");
	});
});
