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
 * `plural` is not written here. The one body lives in `lib/board/round-text.ts` beside
 * the counts it formats, and the assembler hands its source in — a second copy in the
 * bundle is a second wording for `1 card`.
 */

/** The renderer, with the one `plural` it prints counts through spliced in. */
export function renderJs(pluralSource: string): string {
	return renderTemplate.replace("__PLURAL__", pluralSource);
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

  /** One element with optional class and text. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

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
      return { text: last ? last.text : "blocked, with nothing recorded", kind: "blocked" };
    }
    if (card.status === "doing" && !card.plan) {
      return { text: "no plan recorded", kind: "unplanned" };
    }
    if (card.status === "doing") return { text: "planned", kind: "plan" };
    if (card.status === "done") return { text: "✓ done" + (card.owner ? " by " + card.owner.label : ""), kind: "done" };
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

  /** The toolbar's identity, progress, and footer. */
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
  }

  /** 1 card, 2 cards — the one body, handed in by the bundle's assembler. */
  var plural = __PLURAL__;

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

  /** Whether the filter keeps a card: title, a path hint, or the holder. */
  function matches(card, query) {
    if (!query) return true;
    var needle = query.toLowerCase();
    if (card.title.toLowerCase().indexOf(needle) !== -1) return true;
    if (card.owner && card.owner.label.toLowerCase().indexOf(needle) !== -1) return true;
    for (var i = 0; i < card.paths.length; i++) if (card.paths[i].toLowerCase().indexOf(needle) !== -1) return true;
    return false;
  }

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
    // The lane is a status of its own, not a word inside a sentence: the same dot and
    // label a lane head wears, so the dialog and the board speak the same vocabulary.
    var state = document.getElementById("card-dialog-state");
    state.setAttribute("data-status", card.status);
    state.textContent = card.status;
    document.getElementById("card-dialog-meta").textContent =
      "#" + card.id + " · updated " + ago(card.updatedAt) + " · last edited by " + card.by;
    var owner = document.getElementById("card-dialog-owner");
    owner.textContent = "";
    owner.appendChild(card.owner ? chip(card.owner.label, "accent") : document.createTextNode("unassigned"));
    if (card.priority !== "normal") owner.appendChild(chip(card.priority));

    var pathList = document.getElementById("card-dialog-paths");
    pathList.textContent = "";
    for (var i = 0; i < card.paths.length; i++) {
      var item = el("li", "");
      item.appendChild(chip(card.paths[i]));
      pathList.appendChild(item);
    }

    // The dialog and the card face say one thing, from one field: the ids it was linked
    // to are the storage, and a reader is owed the lanes that make them a decision.
    var waits = document.getElementById("card-dialog-depends");
    if (waits) {
      waits.hidden = card.waits === undefined;
      waits.textContent = card.waits === undefined ? "" : "waits on " + card.waits;
    }

    var plan = document.getElementById("card-dialog-plan");
    plan.hidden = !card.plan;
    plan.textContent = card.plan ? "plan " + card.plan : "";

    var notes = document.getElementById("card-dialog-notes");
    notes.textContent = "";
    for (var j = 0; j < card.notes.length; j++) {
      var note = card.notes[j];
      // Who and when on their own line, the sentence under it, a rule between notes:
      // wrapped prose used to run one note into the next with nothing to separate them.
      var row = el("li", N.dialogNote);
      var head = el("p", N.dialogNoteHead);
      head.appendChild(el("span", N.dialogNoteBy, note.by));
      head.appendChild(el("span", N.dialogNoteAt, ago(note.at)));
      row.appendChild(head);
      row.appendChild(el("p", N.dialogNoteText, note.text));
      notes.appendChild(row);
    }
    var earlier = document.getElementById("card-dialog-earlier");
    earlier.hidden = card.notesDropped === 0;
    earlier.textContent = card.notesDropped === 0 ? "" : card.notesDropped + " earlier notes dropped";

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
  board.chip = chip;
  board.actionButton = actionButton;
  board.ago = ago;
  board.findCard = findCard;
  board.matches = matches;
  board.fillDialog = fillDialog;
  board.refreshAges = refreshAges;
  board.plural = plural;
})();`;
