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
 * `team.ts` draws the round, `actions.ts` posts, `keys.ts` binds, and `live.ts` owns
 * the frame stream and the wiring.
 */

export const BOARD_RENDER_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /** Lanes in the order the server sends them, with the words a reader expects. */
  var LANE_LABEL = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done" };
  var LANE_EMPTY = { todo: "nothing waiting", doing: "nothing in flight", blocked: "nothing blocked", done: "nothing finished yet" };
  /** Path chips a lane card shows before it counts the rest. */
  var PATH_CHIPS = 3;

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

  /** Whether this session holds the card. */
  function mine(card, me) {
    if (!card.owner) return false;
    if (card.owner.id !== undefined && me.id !== undefined) return card.owner.id === me.id;
    return String(card.owner.label).toLowerCase() === String(me.label).toLowerCase();
  }

  /** The one line under a card's meta: why it sits where it does. */
  function reasonOf(card) {
    var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
    if (card.status === "blocked") {
      return { text: last ? "blocked: " + last.text : "blocked", kind: "blocked" };
    }
    if (card.status === "doing" && !card.plan) {
      return { text: "unplanned — no plan recorded", kind: "unplanned" };
    }
    if (card.status === "doing") return { text: "✓ planned", kind: "plan" };
    if (card.status === "done") return { text: "✓ done" + (card.owner ? " by " + card.owner.label : ""), kind: "done" };
    return last ? { text: last.text, kind: "note" } : undefined;
  }

  /** A path hint, or the +N chip that points at the rest. */
  function paths(card, limit) {
    var list = el("ul", "board-card__paths");
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
    var item = el("li", "board-card");
    item.setAttribute("data-card", card.id);
    item.setAttribute("data-status", card.status);
    item.setAttribute("data-rev", String(card.rev));

    var head = el("p", "board-card__head");
    head.appendChild(el("span", "board-card__id", "#" + card.id));
    var title = actionButton(card.title, function () {
      board.openCard(card.id);
    });
    title.className = "board-card__title";
    head.appendChild(title);
    item.appendChild(head);

    var meta = el("p", "board-card__meta");
    meta.appendChild(card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned"));
    meta.appendChild(el("span", "", ago(card.updatedAt)));
    item.appendChild(meta);

    if (card.paths.length > 0) item.appendChild(paths(card, PATH_CHIPS));

    var reason = reasonOf(card);
    if (reason) {
      var kind = reason.kind === "blocked" || reason.kind === "unplanned" ? " board-card__reason--" + reason.kind : "";
      item.appendChild(el("p", "board-card__reason" + kind, reason.text));
    }

    var actions = el("div", "board-card__actions");
    if (card.status === "todo") {
      actions.appendChild(actionButton("Claim", function () { board.act("claim", card); }, "plain"));
    } else if (card.status !== "done") {
      actions.appendChild(actionButton("Move", function () { board.openCard(card.id, "move"); }, "plain"));
    }
    actions.appendChild(actionButton("Note", function () { board.openCard(card.id, "note"); }));
    actions.appendChild(actionButton("Open", function () { board.openCard(card.id); }));
    item.appendChild(actions);
    return item;
  }

  /** The toolbar's identity, progress, and footer. */
  function renderChrome(view) {
    var me = document.getElementById("board-me");
    if (me) {
      me.textContent = view.me.label;
      me.title = "Writes from this page are made as " + view.me.label;
    }
    var progress = document.getElementById("board-progress");
    if (progress) {
      var total = view.counts.total;
      progress.hidden = total === 0;
      var fill = document.getElementById("board-progress-fill");
      if (fill) fill.style.width = total === 0 ? "0%" : Math.round((view.counts.done / total) * 100) + "%";
      var text = document.getElementById("board-progress-text");
      if (text) text.textContent = view.counts.done + "/" + total + " done";
    }
    var where = document.getElementById("board-where");
    if (where) {
      where.textContent = "store " + view.where + " · " + plural(view.counts.total, "card") + " · " + size(view.bytes);
    }
  }

  /** 1 card, 2 cards. */
  function plural(count, noun) {
    return count + " " + noun + (count === 1 ? "" : "s");
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
    section = el("section", "board-lane");
    section.setAttribute("data-status", lane.status);
    var head = el("h2", "board-lane__head");
    var toggle = actionButton(LANE_LABEL[lane.status] || lane.status, function () {
      board.toggleLane(lane.status);
    });
    toggle.className = "board-lane__toggle";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-controls", "lane-" + lane.status);
    toggle.id = "lane-head-" + lane.status;
    head.appendChild(el("span", "board-lane__dot"));
    head.appendChild(toggle);
    head.appendChild(el("span", "board-lane__count"));
    section.appendChild(head);
    var list = el("ol", "board-lane__list");
    list.id = "lane-" + lane.status;
    section.appendChild(list);
    section.appendChild(el("p", "board-lane__empty", LANE_EMPTY[lane.status] || "nothing"));
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
    document.getElementById("card-dialog-meta").textContent =
      "#" + card.id + " · " + card.status + " · updated " + ago(card.updatedAt) + " · last edited by " + card.by;
    var owner = document.getElementById("card-dialog-owner");
    owner.textContent = "";
    owner.appendChild(card.owner ? chip(card.owner.label, "accent") : document.createTextNode("unassigned"));

    var pathList = document.getElementById("card-dialog-paths");
    pathList.textContent = "";
    for (var i = 0; i < card.paths.length; i++) {
      var item = el("li", "");
      item.appendChild(chip(card.paths[i]));
      pathList.appendChild(item);
    }

    var plan = document.getElementById("card-dialog-plan");
    plan.hidden = !card.plan;
    plan.textContent = card.plan ? "plan " + card.plan : "";

    var notes = document.getElementById("card-dialog-notes");
    notes.textContent = "";
    for (var j = 0; j < card.notes.length; j++) {
      var note = card.notes[j];
      var row = el("li", "board-dialog__note");
      row.appendChild(el("span", "board-dialog__note-by", note.by + " · " + ago(note.at) + " · "));
      row.appendChild(document.createTextNode(note.text));
      notes.appendChild(row);
    }
    var earlier = document.getElementById("card-dialog-earlier");
    earlier.hidden = card.notesDropped === 0;
    earlier.textContent = card.notesDropped === 0 ? "" : card.notesDropped + " earlier notes dropped";

    board.fillDialogActions(card, view);
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
  board.mine = mine;
  board.matches = matches;
  board.fillDialog = fillDialog;
  board.plural = plural;
})();`;
