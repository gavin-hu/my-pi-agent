/**
 * The client's renderer: snapshot in, DOM out — the toolbar, the lanes, the cards, and the
 * card dialog's contents.
 *
 * This file runs in the browser, where no type checker sees it, so it holds to one
 * rule: **every value from the snapshot is set as `textContent`** — never as
 * `innerHTML`, never into a template string. A card title is model-written and a note
 * can be anything a person typed, so the only safe renderer is one that never parses
 * them.
 *
 * A frame replaces what changed and leaves the rest alone: a lane is rebuilt only
 * when what its cards draw has moved — a revision of their own, or a blocker or a
 * dependent the rest of the board decides — so the filter input, a collapsed lane, the
 * scroll offset, and an open dialog all survive a peer's write.
 *
 * The client modules share one namespace, `window.bfBoard`: this one paints the whole
 * frame, `card.ts` draws one card's face, `team.ts` draws the round, `dialog.ts` fills and
 * opens a card, `keys.ts` binds, and `live.ts` owns the frame stream and the wiring. The
 * browser runtime (`el`, `typing`, …) is spliced in here, because a page's one global body
 * is the runtime every fragment reads through `board.`; the note renderer a dialog reads
 * with is spliced into that fragment instead, so nothing reaches `window` that this page
 * does not place on `board.`.
 *
 * `plural`, `tabTitle`, `matchesQuery`, `reasonFor`, `el`, `typing`, and `paintStatus` are
 * not written here. Their one bodies live in `lib/` beside the rules they express, and the
 * assembler hands the source in — a second copy in the bundle is a second wording for
 * `1 card`, a second shape for the tab, a filter that finds a different card than the tool
 * does, a second reason for the same lane, or an element builder and a typing test that
 * drift from the review page's.
 */

/**
 * The renderer, with what it needs spliced in: the counts' wording, the tab title's shape,
 * what a query matches, why a card sits where it does, how many placeholders the skeleton
 * paints, and the browser runtime's element builder and typing test — each written once, in
 * `lib/`, and handed in as source.
 */
export function renderJs(rules: {
	plural: string;
	tabTitle: string;
	matches: string;
	reason: string;
	age: string;
	lanes: string;
	skipped: string;
	decisions: string;
	decisionTones: string;
	reasonTones: string;
	runtime: string;
}): string {
	return renderTemplate
		.replace("__PLURAL__", rules.plural)
		.replace("__SKIPPED__", rules.skipped)
		.replace("__TAB_TITLE__", rules.tabTitle)
		.replace("__MATCHES__", rules.matches)
		.replace("__REASON__", rules.reason)
		.replace("__LANE_COUNT__", rules.lanes)
		.replace("__DECISION_RANK__", rules.decisions)
		.replace("__DECISION_TONES__", rules.decisionTones)
		.replace("__REASON_TONES__", rules.reasonTones)
		.replace("__AGE__", rules.age)
		.replace("__RUNTIME__", rules.runtime);
}

const renderTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /**
   * The page holds no lane table: a lane's words, colour, limit, and count arrive with it
   * from the snapshot, so a head, a picker button, and the transcript cannot name one lane
   * two ways — the words are decided once, in lib/board/lanes.ts.
   */
  /** How many placeholder trays the skeleton paints: the lane table's own length, spliced in. */
  var LANE_COUNT = __LANE_COUNT__;
  /**
   * How many rows a list may show before it starts folded, by list — one table, because two
   * lists are the same pile and a second threshold is a second answer to "how much is history".
   *
   * A board of 26 cards is 19 of them finished, and an open Done lane is four times the
   * height of the three that carry work: three or four is work a reader still checks, past
   * six it is history, and the count says how much. The roster has the same problem for the
   * same reason — a label that ever claimed a card stays an owner for good, so a long
   * history is a wall of no-record rows — and three is where it stops being a team.
   *
   * A working lane has its own number and a bigger one: twenty-four cards at 140-190px each
   * is a 4,000px wall that pushes every lane beside it out of sight, and a reader who wants
   * it open is one press away from it either way. The count stays in the head, which is the
   * fact a fold like this is owed.
   *
   * The queue's bands carry a smaller number and a different shape: a band is not a column and
   * cannot fold away whole, because the asks under it are what the pane is for — it shows five
   * and counts the rest behind one control. Five rows of a queue is a lead's afternoon; sixty
   * is a wall between the reader and the three swimlanes the column exists to preview.
   */
  var FOLD_AT = { done: 6, roster: 3, lane: 24, queue: 5 };

  /**
   * How long a card that moved wears its mark, in milliseconds: one breath, not a state. A
   * peer's write is news, and news that stays becomes a second set of colours on the board.
   */
  var CHANGE_MS = 1500;

  /** The same table, for the fragments painted after this one: team folds two lists. */
  board.foldAt = FOLD_AT;

__RUNTIME__

  /** The live chip's painter, for the stream's fragment: one body, written in the kit. */
  board.paintLive = paintLive;

  /** The stream client, for the same fragment: one state machine, and this page's words. */
  board.liveStream = liveStream;

  /**
   * The queue's order, its colours, and the tone a reason line wears — spliced in from
   * lib/board/tone.ts, which the terminal reads through extensions/board/tone.ts. One
   * table, so a row cannot be the second-strongest reason and the quietest colour.
   */
  var DECISION_RANK = __DECISION_RANK__;
  var DECISION_TONE = __DECISION_TONES__;
  var REASON_TONE = __REASON_TONES__;

  /** Where a kind sits in the queue: the order the table states, not a copy. */
  function decisionRank(kind) {
    return DECISION_RANK.indexOf(kind);
  }

  /**
   * A label is a name a session asks for -- a peer may join as "constructor" -- and a plain
   * object inherits constructor, toString, __proto__ and the rest, so a label that spells one
   * read as a hit that was never written. A null prototype has no members to fall back on.
   * Here, for both fragments that key by a label: the queue's gone-set and the roster's rows.
   */
  function labelMap() { return Object.create(null); }

  /** The colour a decision row is drawn in — its edge and its reason line. */
  function decisionTone(kind) {
    return DECISION_TONE[kind] || "dim";
  }

  /** The colour a card's reason line is drawn in, by the kind the rule reported. */
  function reasonTone(kind) {
    return REASON_TONE[kind] || "muted";
  }


  /**
   * One button that calls back, so nothing on the page is a click handler in markup.
   *
   * The class comes from the caller: a card's title and a lane's head are buttons drawn
   * by the page's own rule, not by the kit's chip-with-border look — and a card draws no
   * action button at all, since claiming, moving, and editing are the tools' work.
   */
  function actionButton(className, label, onClick) {
    var node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /** A kit tag, with a tone when the meaning is a state. */
  function chip(text, tone) {
    return el("span", "bf-tag" + (tone ? " bf-tone--" + tone : ""), text);
  }

  /**
   * The kind a card is, and — inside the same label — whether it breaks an existing user.
   *
   * One label rather than two facts: feature · breaking says something about the kind, and a
   * second word of the same weight read as another kind of card. It is drawn here because the
   * face, the record, and the lead's queue all wear it, and three fragments building one label
   * is three ways for it to drift.
   */
  function kindLabel(card) {
    if (card.type === undefined && card.breaking !== true) return undefined;
    var label = el("span", "bf-row__kind", card.type === undefined ? "" : card.type);
    if (card.breaking === true) {
      if (card.type !== undefined) label.appendChild(document.createTextNode(" \u00b7 "));
      label.appendChild(el("span", "bf-row__breaking", "breaking"));
    }
    return label;
  }

  /**
   * "12m", "3h", "2d" — an age, compact enough for a meta line.
   *
   * The transcript prints the same rule for the same fact, so the body is spliced in from
   * lib/format.ts rather than written twice. No backticks in here: this is a template.
   */
  var ageText = __AGE__;
  function ago(at) { return ageText(Date.now(), at); }

  /** Bytes, the way the footer says them. */
  function size(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /** Every card the snapshot carries, in lane order. */
  function allCards(view) {
    var all = [];
    for (var i = 0; i < view.lanes.length; i++) all = all.concat(view.lanes[i].cards);
    return all;
  }

  /** One card by id, or undefined when the last frame no longer has it. */
  function findCard(view, id) {
    var all = allCards(view);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return undefined;
  }

  /**
   * The ids whose card moved since the frame before: a revision that climbed, or an arrival.
   * A first frame marks nothing — the whole board is new to whoever just opened it — and a
   * card that left is not marked, because it is not drawn.
   */
  function changedIds(previous, view) {
    var changed = {};
    if (!previous) return changed;
    var before = {};
    var prior = allCards(previous);
    for (var i = 0; i < prior.length; i++) before[prior[i].id] = prior[i].rev;
    var now = allCards(view);
    for (var j = 0; j < now.length; j++) {
      if (before[now[j].id] !== now[j].rev) changed[now[j].id] = true;
    }
    return changed;
  }

  /**
   * Clear the mark a frame put on the cards that moved, after one breath. A frame replaces the
   * mark before it, so a card stays marked only while its move is the latest news; this is the
   * other end — the board goes quiet, and no further frame comes to take the mark away.
   */
  function armChanged() {
    if (board.changedTimer !== undefined) clearTimeout(board.changedTimer);
    board.changedTimer = setTimeout(function () {
      board.changedTimer = undefined;
      board.changed = {};
      board.markCards();
    }, CHANGE_MS);
  }

  /**
   * The cards as the page draws them: a board face, a queue row, or a mission card.
   *
   * All three open their card, so all three are what j/k walks and what the dialog's position
   * counts. A folded lane keeps its cards in the document, and so does a panel the other tab
   * hides: the box is the only honest test of whether a reader can see one.
   */
  function drawnCards() {
    var nodes = document.querySelectorAll(".board-row, .board-queue__row");
    var seen = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].hidden) continue;
      if (!nodes[i].getClientRects || nodes[i].getClientRects().length === 0) continue;
      seen.push(nodes[i]);
    }
    return seen;
  }

  /**
   * A pane's head: its name and how much it holds, in the shape a column counts itself in.
   *
   * Shared by the activity panes and the decisions strip, because the tab has one way of
   * saying a number: the pill is count/total when a cap left something out, and the spoken
   * label spells that ratio out rather than reading a slash aloud.
   */
  function paneHead(text, count, total, tone) {
    var head = el("h3", "bf-section__cap");
    board.headDot(head);
    head.appendChild(document.createTextNode(text));
    var filtered = total !== undefined && total !== count;
    var pill = el("span", "bf-section__count", filtered ? count + "/" + total : String(count));
    // A count that is asking for something wears the accent; a count that is merely true does not.
    if (tone !== undefined) pill.setAttribute("data-tone", tone);
    head.appendChild(pill);
    head.setAttribute("aria-label", text + ", " + (filtered ? count + " of " + total : plural(count, "row")));
    return head;
  }

  /** The toolbar's subject, its progress, the footer, and the tab's own name. */
  function renderChrome(view) {
    // The board's subject, which the header carries: the repository's name, with the root's
    // whole path on the hover, because a name alone cannot tell two clones of one repository
    // apart. It arrives in the document too, so the toolbar is complete before the first
    // frame; this keeps it true if a frame ever names a different store.
    var repo = document.getElementById("board-repo");
    if (repo) {
      repo.textContent = view.repo;
      repo.title = view.root;
    }
    var progress = document.getElementById("board-progress");
    var done = laneOf(view, "done");
    var finished = done === undefined ? 0 : done.cards.length;
    if (progress) {
      var total = view.total;
      // One or two cards is not a ratio: an empty gauge beside "0/1 done" is noise.
      progress.hidden = total < 3;
      var filled = total === 0 ? 0 : Math.round((finished / total) * 10);
      var cells = document.getElementById("board-progress-cells");
      if (cells) {
        cells.textContent = "";
        for (var cell = 0; cell < 10; cell++) {
          if (cell < filled) cells.appendChild(document.createTextNode("\u25b0"));
          else cells.appendChild(el("span", "bf-gauge__empty", "\u25b1"));
        }
      }
      progress.setAttribute("aria-valuenow", String(finished));
      progress.setAttribute("aria-valuemax", String(total));
      progress.setAttribute("aria-label", finished + " of " + total + " done");
      var text = document.getElementById("board-progress-text");
      if (text) text.textContent = finished + "/" + total + " done";
    }
    var where = document.getElementById("board-where");
    if (where) {
      // The footer adds only what the header does not: which store these cards are filed
      // under, how many, and what they weigh. A footer that only counted read cards would
      // say "2 cards" over a directory holding three files, so the refused ones are counted
      // beside the size and named with the store's own reason on the hover — the line has no
      // room for a file and a reason each, and a count alone is a fact a reader cannot act on.
      where.textContent =
        "store " + view.where + " · " + plural(view.total, "card") + " · " + size(view.bytes) +
        (view.skipped.length > 0 ? " · " + plural(view.skipped.length, "file") + " could not be read" : "");
      if (view.skipped.length > 0) where.title = skippedText(view.skipped);
      else where.removeAttribute("title");
    }
    // The tab has to tell two boards apart, and a board's subject is its repository: one
    // board per repository, named the way the directory holding it is. The store key is a
    // hash, which no reader can say out loud, so it is not what a tab leads with. The count
    // is what a browser full of tabs is read for, and an empty board says nothing rather
    // than 0.
    var open = view.total - finished;
    document.title = tabTitle("board", view.repo, open > 0 ? open + " open" : undefined);
  }

  /** 1 card, 2 cards — the one body, handed in by the bundle's assembler. */
  var plural = __PLURAL__;
  /** The refused files, named with their reasons: the tool's own sentence, handed in. */
  var skippedText = __SKIPPED__;
  /** board · my-pi-agent · 3 open, the tab's one shape, handed in the same way. */
  var tabTitle = __TAB_TITLE__;

  /**
   * Rewrite every age already on the page from its own timestamp.
   *
   * A frame carries the ages of the moment it was built, so on a board nobody is
   * writing to the cards would slowly lie about how long they have sat there. The
   * ticker calls this; it touches nothing else, so a filter, a folded lane, or an
   * open dialog survives it.
   *
   * A stamp carries its own wording ("updated {age}", "last note {age} by …"), because a
   * card now shows two ages and a ticker that assumed one of them would relabel the other.
   */
  function refreshAges() {
    var nodes = document.querySelectorAll("[data-at]");
    for (var i = 0; i < nodes.length; i++) {
      var at = Number(nodes[i].getAttribute("data-at"));
      var wording = nodes[i].getAttribute("data-at-title");
      // A stamp prints the age alone — the meta line's "5m" — unless it says it is a sentence, and
      // then it re-reads the whole wording with the age in it, which is what a reason line is.
      var sentenceStamp = nodes[i].getAttribute("data-at-sentence") !== null;
      var next = sentenceStamp && wording !== null ? board.sentence(wording, ago(at)) : ago(at);
      if (nodes[i].textContent !== next) nodes[i].textContent = next;
      if (wording !== null) nodes[i].title = board.sentence(wording, ago(at));
    }
  }

  /** Whether the filter keeps a card: the module's one predicate, spliced in as source. */
  var matches = __MATCHES__;

  /** Why a card sits where it does: one body, spliced in from lib/board/reason.ts. */
  var reasonFor = __REASON__;

  /** One lane from the snapshot, by its name; absent when the snapshot no longer has it. */
  function laneOf(view, key) {
    for (var i = 0; i < view.lanes.length; i++) if (view.lanes[i].key === key) return view.lanes[i];
    return undefined;
  }

  /** A lane head's count: n/limit while the lane is pulled, and n otherwise. */
  function headCount(lane) {
    return lane.limit === undefined ? String(lane.count) : lane.count + "/" + lane.limit;
  }

  /**
   * The same count, in words a screen reader can read.
   *
   * The pill prints "1/3" because an eye takes the slash in at a glance; spoken, it is
   * punctuation between two numbers. The heading therefore names itself from the same
   * facts -- "Plan, 1 of 3" -- and the pill keeps the shape.
   */
  function headLabel(lane, shown) {
    if (shown !== undefined) return lane.label + ", " + shown + " of " + lane.cards.length;
    if (lane.limit !== undefined) return lane.label + ", " + lane.count + " of " + lane.limit;
    return lane.label + ", " + plural(lane.count, "card");
  }

  /** The lane section for one lane, created once and then reused. */
  function laneNode(lane) {
    var section = document.querySelector('.board-lane[data-lane="' + lane.key + '"]');
    if (section) return section;
    section = el("section", "bf-lane " + N.lane);
    section.setAttribute("data-lane", lane.key);
    var head = el("h2", "bf-lane__head");
    var toggle = actionButton(N.laneToggle, lane.label, function () {
      board.toggleFold(lane.key);
    });
    toggle.setAttribute("data-fold", lane.key);
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-controls", "lane-" + lane.key);
    toggle.id = "lane-head-" + lane.key;
    board.headDot(head);
    head.appendChild(toggle);
    head.appendChild(el("span", "bf-lane__count"));
    section.appendChild(head);
    var list = el("ol", N.laneList);
    list.id = "lane-" + lane.key;
    section.appendChild(list);
    section.appendChild(el("p", "bf-lane__empty", lane.empty));
    return section;
  }

  /**
   * What one face is drawn from: the card's own revision, and the two facts about it that
   * the rest of the board decides.
   *
   * A face prints what the card waits for and what it holds up, both derived from other
   * cards, so a blocker finished in another lane moves nothing in this card's record — and
   * a lane keyed on revisions alone kept a sentence the board had already left behind. The
   * Team tab's queue carries its rows' reasons the same way: a signature lists the facts a
   * row prints, not just the row's own file.
   */
  function faceSig(card) {
    return card.id + ":" + card.rev + "|" + (card.waits || "") + "|" + (card.dependents || "");
  }

  /** Draw the lanes, rebuilding only one whose faces actually moved. */
  function renderLanes(view) {
    var lanes = document.getElementById("board-lanes");
    if (!lanes) return;
    if (lanes.getAttribute("data-skeleton") === "1") {
      // The placeholders have done their job; the real lanes replace them whole.
      lanes.textContent = "";
      lanes.removeAttribute("data-skeleton");
    }
    var query = board.query || "";
    var shownTotal = 0;
    for (var i = 0; i < view.lanes.length; i++) {
      var lane = view.lanes[i];
      var section = laneNode(lane);
      if (section.parentNode !== lanes) lanes.appendChild(section);
      // A lane past its threshold starts folded, once: the default is what the page opens
      // with, and toggleFold writes a boolean from then on, so a reader who unfolds a lane
      // keeps it unfolded through every frame a peer's write causes. Finished work folds
      // sooner than work in flight — one is history, the other is a wall of the same lane.
      var foldAt = lane.key === "done" ? FOLD_AT.done : FOLD_AT.lane;
      if (lane.cards.length >= foldAt) {
        board.collapsed = board.collapsed || {};
        if (board.collapsed[lane.key] === undefined) board.collapsed[lane.key] = true;
      }
      // A lane holding nothing is a rail: its dot, its word, and its count, in the width
      // the fact deserves. The filter never does this — filtering is a view of the cards,
      // not a statement that the lane has none.
      section.setAttribute("data-empty", lane.cards.length === 0 ? "true" : "false");
      // The lane's share of the row follows the work it holds: the sheet turns this number
      // into a flex-grow, so two cards earn more width than one and a title is not wrapped
      // for want of a column the lane is not using. A count, never text.
      section.style.setProperty("--lane-count", String(lane.cards.length));
      var shown = lane.cards.filter(function (card) { return matches(card, query); });
      shownTotal += shown.length;
      var sig = lane.cards.map(faceSig).join(",") + "|" + query;
      if (section.getAttribute("data-sig") !== sig) {
        section.setAttribute("data-sig", sig);
        var list = section.querySelector('.' + N.laneList);
        // A rebuilt list empties, so the node the reader was on goes with it and focus falls to
        // the document: j reads the focused card, so it would restart at the first one. The id
        // outlives the node, so the reader is put back on their card and j moves on from it.
        var here = document.activeElement;
        var held = here && here.closest && list.contains(here) ? here.closest(".board-row") : null;
        var heldId = held ? held.getAttribute("data-card") : null;
        list.textContent = "";
        for (var j = 0; j < shown.length; j++) list.appendChild(board.cardNode(shown[j]));
        if (heldId !== null) {
          var back = list.querySelector('.board-row[data-card="' + heldId + '"] .bf-row__title');
          if (back) back.focus();
        }
      }
      var count = section.querySelector(".bf-lane__count");
      var head = section.querySelector(".bf-lane__head");
      if (count) {
        var filtered = query !== "" && shown.length !== lane.cards.length;
        count.textContent = filtered ? shown.length + "/" + lane.cards.length : headCount(lane);
        // The visible pill and the spoken name come from the same numbers, so a filtered lane
        // says "1 of 2" rather than reading as a board of one card.
        if (head) head.setAttribute("aria-label", headLabel(lane, filtered ? shown.length : undefined));
      }
      var none = section.querySelector(".bf-lane__empty");
      if (none) {
        none.hidden = shown.length !== 0;
        none.textContent = query !== "" && lane.cards.length > 0 ? "no match" : lane.empty;
      }
      var collapsed = board.collapsed && board.collapsed[lane.key] === true;
      var list = section.querySelector('.' + N.laneList);
      if (list) list.hidden = collapsed;
      // A folded lane shows nothing, so it takes the rail's width the way an empty one
      // does: the count in its head is the whole fact, and the lanes with cards keep the
      // width that would otherwise be a tray of nothing.
      section.setAttribute("data-folded", collapsed ? "true" : "false");
      var toggle = section.querySelector(".board-lane__toggle");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
    }
    board.renderEmpty(view, query, shownTotal);
    renderPicker(view);
  }

  /** The lane selector the narrow layout shows instead of four columns. */
  function renderPicker(view) {
    var picker = document.getElementById("board-picker");
    if (!picker) return;
    picker.textContent = "";
    for (var i = 0; i < view.lanes.length; i++) {
      (function (lane) {
        // A lane switch, not a tablist: it shows one lane and there is no tabpanel behind
        // each button, so the pressed state is the honest one rather than a tab without its
        // panel. The counts stay on the face, where a reader chooses by them.
        var item = el("button", "bf-tabs__item", lane.label + " " + headCount(lane));
        item.type = "button";
        item.setAttribute("data-picker-lane", lane.key);
        item.addEventListener("click", function () { board.showLane(lane.key); });
        picker.appendChild(item);
      })(view.lanes[i]);
    }
    board.applyLane();
  }

  /**
   * Put focus back on the control a reader just moved.
   *
   * A fold repaints the panel it lives in, so the element that was clicked is gone by the
   * time the frame lands and focus would fall to the document — a reader who folds with the
   * keyboard would then start again from the top of the page. toggleFold records the key
   * and each control names itself with it, so this is the whole lookup.
   */
  function restoreFoldFocus() {
    var key = board.foldFocus;
    if (key === undefined) return;
    board.foldFocus = undefined;
    var control = document.querySelector('[data-fold="' + key + '"]');
    if (control) control.focus();
  }

  /** Paint a whole snapshot. */
  board.render = function (view) {
    // What moved is read against the frame before this one, so a lane rebuilt here still knows
    // which of its cards a peer just wrote.
    var previous = board.view;
    board.view = view;
    board.changed = changedIds(previous, view);
    renderChrome(view);
    renderLanes(view);
    board.renderTeam(view);
    // The dialog module keeps an open record current — or closes it when its card left the
    // frame — so the panel and the board cannot disagree about one card.
    board.syncDialog(view);
    // The marks are painted after the frame, not with each card: a lane is rebuilt whole
    // when its cards move, and a reader's place must survive that.
    board.markCards();
    armChanged();
    // Last, because the control it looks for is one this frame has just built.
    restoreFoldFocus();
  };

  board.el = el;
  board.typing = typing;
  board.paneHead = paneHead;
  board.chip = chip;
  board.kindLabel = kindLabel;
  board.ago = ago;
  board.findCard = findCard;
  board.drawnCards = drawnCards;
  board.matches = matches;
  board.reasonFor = reasonFor;
  board.decisionRank = decisionRank;
  board.labelMap = labelMap;
  board.decisionTone = decisionTone;
  board.reasonTone = reasonTone;
  board.laneCount = LANE_COUNT;
  board.laneOf = laneOf;
  board.refreshAges = refreshAges;
  board.plural = plural;
})();`;
