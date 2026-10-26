/**
 * The client's renderer: snapshot in, DOM out — the toolbar, the lanes, the cards,
 * and the card dialog's contents.
 *
 * This file runs in the browser, where no type checker sees it, so it holds to one
 * rule: **every value from the snapshot is set as `textContent`** — never as
 * `innerHTML`, never into a template string. A card title is model-written and a note
 * can be anything a person typed, so the only safe renderer is one that never parses
 * them.
 *
 * A frame replaces what changed and leaves the rest alone: a lane is rebuilt only
 * when its cards' revisions moved, so the filter input, a collapsed lane, the scroll
 * offset, and an open dialog all survive a peer's write.
 *
 * The client modules share one namespace, `window.bfBoard`: this one paints,
 * `team.ts` draws the round, `dialog.ts` opens a card, `keys.ts` binds, and `live.ts`
 * owns the frame stream and the wiring.
 *
 * `plural`, `tabTitle`, `matchesQuery`, `el`, `typing`, and `paintStatus` are not written
 * here. Their one bodies live in `lib/` beside the rules they express, and the assembler
 * hands the source in — a second copy in the bundle is a second wording for `1 card`, a
 * second shape for the tab, a filter that finds a different card than the tool does, or an
 * element builder and a typing test that drift from the review page's.
 */

/**
 * The renderer, with what it needs spliced in: the counts' wording, the tab title's
 * shape, what a query matches, and the browser runtime's element builder and typing test —
 * each written once in `lib/` and handed in as source.
 */
export function renderJs(rules: { plural: string; tabTitle: string; matches: string; runtime: string }): string {
	return renderTemplate
		.replace("__PLURAL__", rules.plural)
		.replace("__TAB_TITLE__", rules.tabTitle)
		.replace("__MATCHES__", rules.matches)
		.replace("__RUNTIME__", rules.runtime);
}

const renderTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /** Lanes in the order the server sends them, with the words a reader expects. */
  var LANE_LABEL = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done" };
  var LANE_EMPTY = { todo: "nothing waiting", doing: "nothing in flight", blocked: "nothing blocked", done: "nothing finished yet" };
  /** Path chips a lane card shows before it counts the rest. */
  var PATH_CHIPS = 3;
  /**
   * Finished cards a lane may hold before it starts folded.
   *
   * A board of 26 cards is 19 of them finished, and an open Done lane is four times the
   * height of the three that carry work. Three or four is work a reader still checks;
   * past this it is history, and the count in the head says how much.
   */
  var DONE_FOLD_AT = 6;
  /** The two tones a reason line can take, by the kind reasonOf reports. */
  var REASON_TONE = { blocked: N.cardReasonBlocked, unplanned: N.cardReasonUnplanned };

__RUNTIME__

  /**
   * One button that calls back, so nothing on the page is a click handler in markup.
   *
   * 'plain' is the bordered kit button, 'ghost' the text one: a card's primary
   * action (Claim, Move) is bordered and the rest are text, which is what makes one
   * of three controls on a card the obvious one.
   */
  function actionButton(label, onClick, variant) {
    var kind = variant === "plain" ? "" : variant ? " bf-btn--" + variant : " bf-btn--ghost";
    var node = el("button", "bf-btn" + kind, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /** A kit chip, with a tone when the meaning is a state. */
  function chip(text, tone) {
    return el("span", "bf-chip" + (tone ? " bf-chip--" + tone : ""), text);
  }

  /** "12m", "3h", "2d" — the age of a card's last write, compact enough for a meta line. */
  function ago(at) {
    var seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 45) return "now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h";
    return Math.round(hours / 24) + "d";
  }

  /** Bytes, the way the footer says them. */
  function size(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /** Every card the snapshot carries, in lane order. */
  function cards(view) {
    var all = [];
    for (var i = 0; i < view.lanes.length; i++) all = all.concat(view.lanes[i].cards);
    return all;
  }

  /** One card by id, or undefined when the last frame no longer has it. */
  function findCard(view, id) {
    var all = cards(view);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return undefined;
  }

  /** The one line under a card's meta: why it sits where it does. */
  function reasonOf(card, view) {
    var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
    // An order is the strongest reason a card is not being worked on, and the one a
    // reader cannot see from the lane: it comes before the note that says the same.
    // The sentence is the snapshot's, so this line and the tool's refusal name one list.
    if (card.waits !== undefined) return { text: "waits on " + card.waits, kind: "waiting" };
    if (card.status === "blocked") {
      // The lane already says blocked and the tone already says danger; the line says why.
      // The recorded reason comes first: the note is what somebody happened to write last,
      // and it is the reason a move to blocked asks for. The slot carries the reason alone —
      // the lane head already says blocked, and a status prefix in it would be a second voice.
      if (card.blockedBy) return { text: card.blockedBy, kind: "blocked" };
      return { text: last ? last.text : "blocked, with nothing recorded", kind: "blocked" };
    }
    if (card.status === "doing" && !card.plan) {
      return { text: "no plan recorded", kind: "unplanned" };
    }
    if (card.status === "doing") return { text: "planned", kind: "plan" };
    if (card.status === "done") {
      var landed = card.landed ? " · landed " + card.landed.commit : "";
      return { text: "✓ done" + (card.owner ? " by " + card.owner.label : "") + landed, kind: "done" };
    }
    return last ? { text: last.text, kind: "note" } : undefined;
  }

  /** A path hint, or the +N chip that points at the rest. */
  function paths(card, limit) {
    var list = el("ul", N.cardPaths);
    var shown = card.paths.slice(0, limit);
    for (var i = 0; i < shown.length; i++) {
      var item = el("li", "");
      item.appendChild(chip(shown[i]));
      list.appendChild(item);
    }
    if (card.paths.length > limit) {
      var rest = el("li", "");
      rest.appendChild(chip("+" + (card.paths.length - limit)));
      list.appendChild(rest);
    }
    return list;
  }

  /** One card in its lane. */
  function cardNode(card, view) {
    var item = el("li", N.card);
    item.setAttribute("data-card", card.id);
    item.setAttribute("data-status", card.status);
    item.setAttribute("data-rev", String(card.rev));

    var head = el("p", N.cardHead);
    head.appendChild(el("span", N.cardId, "#" + card.id));
    var title = actionButton(card.title, function () {
      board.openCard(card.id);
    });
    title.className = N.cardTitle;
    head.appendChild(title);
    item.appendChild(head);

    var meta = el("p", N.cardMeta);
    meta.appendChild(card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned"));
    // The order inside a lane is the priority, so an urgent card says so: an order
    // nobody can see reads as an accident. The lane's colour stays the card's own.
    if (card.priority !== "normal") meta.appendChild(chip(card.priority));
    // The stamp, so the clock can keep the age honest between frames: a board can be
    // quiet for ten minutes while the page still says "live".
    var age = el("span", "", ago(card.updatedAt));
    age.setAttribute("data-at", String(card.updatedAt));
    meta.appendChild(age);
    item.appendChild(meta);

    if (card.paths.length > 0) item.appendChild(paths(card, PATH_CHIPS));

    var reason = reasonOf(card, view);
    if (reason) {
      // The tone is a lookup, not a suffix: a name assembled from a prefix is a name no
      // test can compare with the stylesheet.
      var tone = REASON_TONE[reason.kind];
      var line = el("p", tone === undefined ? N.cardReason : N.cardReason + " " + tone, reason.text);
      // It clamps to one line on the card, so the full sentence is the tooltip.
      line.title = reason.text;
      item.appendChild(line);
    }

    return item;
  }

  /**
   * The cards as the page draws them.
   *
   * A folded lane keeps its cards in the document, and so does a panel the other tab
   * hides: the box is the only honest test of whether a reader can see one, and it is
   * what j/k walks and what the dialog's position counts.
   */
  function drawnCards() {
    var nodes = document.querySelectorAll(".board-card");
    var seen = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].hidden) continue;
      if (!nodes[i].getClientRects || nodes[i].getClientRects().length === 0) continue;
      seen.push(nodes[i]);
    }
    return seen;
  }

  /** The toolbar's identity, progress, footer, and the tab's own name. */
  function renderChrome(view) {
    var me = document.getElementById("board-me");
    if (me) {
      me.textContent = view.me.label;
      me.title = "This page is served as " + view.me.label + ", and it cannot change a card";
    }
    var progress = document.getElementById("board-progress");
    if (progress) {
      var total = view.counts.total;
      // One or two cards is not a ratio: an empty bar beside "0/1 done" is noise.
      progress.hidden = total < 3;
      var fill = document.getElementById("board-progress-fill");
      if (fill) fill.style.width = total === 0 ? "0%" : Math.round((view.counts.done / total) * 100) + "%";
      var text = document.getElementById("board-progress-text");
      if (text) text.textContent = view.counts.done + "/" + total + " done";
    }
    var where = document.getElementById("board-where");
    if (where) {
      // A footer that only counts read cards would say "2 cards" over a board holding
      // three files, so the unreadable ones are named beside the size.
      where.textContent =
        "store " + view.where + " · " + plural(view.counts.total, "card") + " · " + size(view.bytes) +
        (view.skipped > 0 ? " · " + plural(view.skipped, "unreadable") : "");
    }
    // The tab has to tell two boards apart, and a board's own name is the last segment of
    // its store: one board per repository, so that key is the subject. The count is what
    // a browser full of tabs is read for, and an empty board says nothing rather than 0.
    var open = view.counts.total - view.counts.done;
    document.title = tabTitle("board", view.where.split("/").pop(), open > 0 ? open + " open" : undefined);
  }

  /** 1 card, 2 cards — the one body, handed in by the bundle's assembler. */
  var plural = __PLURAL__;
  /** board · my-pi-agent · 3 open, the tab's one shape, handed in the same way. */
  var tabTitle = __TAB_TITLE__;

  /**
   * Rewrite every age already on the page from its own timestamp.
   *
   * A frame carries the ages of the moment it was built, so on a board nobody is
   * writing to the cards would slowly lie about how long they have sat there. The
   * ticker calls this; it touches nothing else, so a filter, a folded lane, or an
   * open dialog survives it.
   */
  function refreshAges() {
    var nodes = document.querySelectorAll("[data-at]");
    for (var i = 0; i < nodes.length; i++) {
      var next = ago(Number(nodes[i].getAttribute("data-at")));
      if (nodes[i].textContent !== next) nodes[i].textContent = next;
    }
  }

  /** Whether the filter keeps a card: the module's one predicate, spliced in as source. */
  var matches = __MATCHES__;

  /** The lane section for one status, created once and then reused. */
  function laneNode(lane) {
    var section = document.querySelector('.board-lane[data-status="' + lane.status + '"]');
    if (section) return section;
    section = el("section", N.lane);
    section.setAttribute("data-status", lane.status);
    var head = el("h2", N.laneHead);
    var toggle = actionButton(LANE_LABEL[lane.status] || lane.status, function () {
      board.toggleLane(lane.status);
    });
    toggle.className = N.laneToggle;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-controls", "lane-" + lane.status);
    toggle.id = "lane-head-" + lane.status;
    head.appendChild(el("span", N.laneDot));
    head.appendChild(toggle);
    head.appendChild(el("span", N.laneCount));
    section.appendChild(head);
    var list = el("ol", N.laneList);
    list.id = "lane-" + lane.status;
    section.appendChild(list);
    section.appendChild(el("p", N.laneEmpty, LANE_EMPTY[lane.status] || "nothing"));
    return section;
  }

  /** Draw the lanes, rebuilding only one whose cards actually moved. */
  function renderLanes(view) {
    var lanes = document.getElementById("board-lanes");
    if (!lanes) return;
    if (lanes.getAttribute("data-skeleton") === "1") {
      // The placeholders have done their job; the real lanes replace them whole.
      lanes.textContent = "";
      lanes.removeAttribute("data-skeleton");
    }
    var query = board.query || "";
    var empty = document.getElementById("board-no-cards");
    if (empty) empty.hidden = view.counts.total !== 0;
    lanes.hidden = view.counts.total === 0;
    for (var i = 0; i < view.lanes.length; i++) {
      var lane = view.lanes[i];
      var section = laneNode(lane);
      if (section.parentNode !== lanes) lanes.appendChild(section);
      // Finished work starts folded, once: the default is what the page opens with, and
      // toggleLane writes a boolean from then on, so a reader who unfolds Done keeps it
      // unfolded through every frame a peer's write causes.
      if (lane.status === "done" && lane.cards.length >= DONE_FOLD_AT) {
        board.collapsed = board.collapsed || {};
        if (board.collapsed[lane.status] === undefined) board.collapsed[lane.status] = true;
      }
      // A lane holding nothing is a rail: its dot, its word, and its count, in the width
      // the fact deserves. The filter never does this — filtering is a view of the cards,
      // not a statement that the lane has none.
      section.setAttribute("data-empty", lane.cards.length === 0 ? "true" : "false");
      var shown = lane.cards.filter(function (card) { return matches(card, query); });
      var sig = lane.cards.map(function (card) { return card.id + ":" + card.rev; }).join(",") + "|" + query;
      if (section.getAttribute("data-sig") !== sig) {
        section.setAttribute("data-sig", sig);
        var list = section.querySelector(".board-lane__list");
        list.textContent = "";
        for (var j = 0; j < shown.length; j++) list.appendChild(cardNode(shown[j], view));
      }
      var count = section.querySelector(".board-lane__count");
      if (count) {
        count.textContent = query === "" || shown.length === lane.cards.length
          ? String(lane.cards.length)
          : shown.length + "/" + lane.cards.length;
      }
      var none = section.querySelector(".board-lane__empty");
      if (none) {
        none.hidden = shown.length !== 0;
        none.textContent = query !== "" && lane.cards.length > 0 ? "no match" : LANE_EMPTY[lane.status] || "nothing";
      }
      var collapsed = board.collapsed && board.collapsed[lane.status] === true;
      var list = section.querySelector(".board-lane__list");
      if (list) list.hidden = collapsed;
      // A folded lane shows nothing, so it takes the rail's width the way an empty one
      // does: the count in its head is the whole fact, and the lanes with cards keep the
      // width that would otherwise be a tray of nothing.
      section.setAttribute("data-folded", collapsed ? "true" : "false");
      var toggle = section.querySelector(".board-lane__toggle");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
    }
    renderPicker(view);
  }

  /** The lane selector the narrow layout shows instead of four columns. */
  function renderPicker(view) {
    var picker = document.getElementById("board-picker");
    if (!picker) return;
    picker.textContent = "";
    for (var i = 0; i < view.lanes.length; i++) {
      (function (lane) {
        var item = el("button", "bf-segmented__item", (LANE_LABEL[lane.status] || lane.status) + " " + lane.cards.length);
        item.type = "button";
        item.setAttribute("role", "tab");
        item.setAttribute("data-lane", lane.status);
        item.addEventListener("click", function () { board.showLane(lane.status); });
        picker.appendChild(item);
      })(view.lanes[i]);
    }
    board.applyLane();
  }

  /** Fill the card dialog's contents from a card, without opening or closing it. */
  function fillDialog(card, view) {
    document.getElementById("card-dialog-title").textContent = card.title;
    document.getElementById("card-dialog-id").textContent = "#" + card.id;
    // The lane is a status of its own, not a word inside a sentence: the same dot and
    // label a lane head wears, so the dialog and the board speak the same vocabulary.
    var state = document.getElementById("card-dialog-state");
    state.setAttribute("data-status", card.status);
    state.textContent = card.status;

    // One fact per row of the ladder, so a reader can pick out a value instead of
    // hunting for it in a sentence. A row with nothing to say takes its label with it:
    // an empty cell under a heading reads as a missing value, not as an absence.
    var pair = function (name, shown) {
      var dt = document.getElementById("card-dialog-" + name + "-label");
      var dd = document.getElementById("card-dialog-" + name);
      if (dt) dt.hidden = !shown;
      if (dd) dd.hidden = !shown;
      return dd;
    };
    var setRow = function (name, shown, value, full) {
      var dd = pair(name, shown);
      dd.textContent = shown ? value : "";
      if (full === undefined) dd.removeAttribute("title");
      else dd.setAttribute("title", full);
    };

    var owner = document.getElementById("card-dialog-owner");
    owner.textContent = "";
    owner.appendChild(card.owner ? chip(card.owner.label, "accent") : document.createTextNode("unassigned"));
    pair("owner", true);

    var priority = pair("priority", card.priority !== "normal");
    priority.textContent = "";
    if (card.priority !== "normal") priority.appendChild(chip(card.priority));

    setRow("updated", true, ago(card.updatedAt));
    setRow("by", true, card.by);
    setRow("landed", card.landed !== undefined, card.landed ? card.landed.commit : "", card.landed ? card.landed.commit : undefined);

    // The dialog and the card face say one thing, from one field: the ids it was linked
    // to are the storage, and a reader is owed the lanes that make them a decision.
    setRow("depends", card.waits !== undefined, card.waits || "", card.waits);
    // The other side of the same link: what leaving this card undone is holding up, which
    // is the one thing a card's own row cannot say.
    setRow("dependents", card.dependents !== undefined, card.dependents || "", card.dependents);

    // A long plan path elides on one line, and the whole of it is on the hover title and
    // in the text, so it stays copyable: the reason to open a card is often its plan.
    setRow("plan", Boolean(card.plan), card.plan || "", card.plan || undefined);

    pair("paths", card.paths.length > 0);
    var pathList = document.getElementById("card-dialog-path-list");
    pathList.textContent = "";
    for (var i = 0; i < card.paths.length; i++) {
      var item = el("li", "");
      var hint = chip(card.paths[i]);
      hint.className += " " + N.dialogPath;
      hint.title = card.paths[i];
      item.appendChild(hint);
      pathList.appendChild(item);
    }

    var notes = document.getElementById("card-dialog-notes");
    notes.textContent = "";
    for (var j = 0; j < card.notes.length; j++) {
      var note = card.notes[j];
      // The prose is the record and reads at body size; who wrote it and when is its
      // footnote, so it follows the sentence instead of standing over it.
      var row = el("li", N.dialogNote);
      row.appendChild(el("p", N.dialogNoteText, note.text));
      var foot = el("p", N.dialogNoteFoot);
      foot.appendChild(el("span", N.dialogNoteBy, note.by));
      foot.appendChild(el("span", N.dialogNoteAt, ago(note.at)));
      row.appendChild(foot);
      notes.appendChild(row);
    }
    var count = document.getElementById("card-dialog-note-count");
    if (count) count.textContent = card.notes.length === 0 ? " · none" : " · " + card.notes.length;
    var earlier = document.getElementById("card-dialog-earlier");
    earlier.hidden = card.notesDropped === 0;
    earlier.textContent = card.notesDropped === 0 ? "" : card.notesDropped + " earlier notes dropped";

    // A modal whose title changes is not announced, so walking with j/k says where it
    // landed: the position is counted over the cards as they are drawn, not as stored, so
    // a filter or a folded lane cannot make the number disagree with the screen.
    var where = document.getElementById("card-dialog-where");
    if (where) {
      var drawn = drawnCards();
      var at = 0;
      for (var k = 0; k < drawn.length; k++) {
        if (drawn[k].getAttribute("data-card") === String(card.id)) at = k + 1;
      }
      // Opened from the Team tab there is no drawn board to count along, so the line
      // names the card instead of claiming a position it cannot know.
      where.textContent = drawn.length === 0 ? card.title : "card " + at + " of " + drawn.length + ": " + card.title;
    }
  }

  /** Paint a whole snapshot. */
  board.render = function (view) {
    board.view = view;
    renderChrome(view);
    renderLanes(view);
    board.renderTeam(view);
    if (board.openId !== undefined) {
      var card = findCard(view, board.openId);
      if (card) fillDialog(card, view);
      else board.closeCard();
    }
  };

  board.el = el;
  board.typing = typing;
  board.chip = chip;
  board.actionButton = actionButton;
  board.ago = ago;
  board.findCard = findCard;
  board.drawnCards = drawnCards;
  board.matches = matches;
  board.fillDialog = fillDialog;
  board.refreshAges = refreshAges;
  board.plural = plural;
})();`;
