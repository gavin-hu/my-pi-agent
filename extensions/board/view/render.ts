/**
 * The client's renderer: snapshot in, DOM out.
 *
 * This file runs in the browser, where no type checker sees it, so it holds to one
 * rule: **every value from the snapshot is set as `textContent`** — never as
 * `innerHTML`, never into a template string. A card title is model-written and a
 * note can be anything a person typed, so the only safe renderer is one that never
 * parses them.
 *
 * The three client modules share one namespace, `window.bfBoard`: this one builds
 * nodes and paints, `actions.ts` posts, and `live.ts` owns the frame stream and the
 * wiring.
 */

export const BOARD_RENDER_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /** Lanes in the order the server sends them, with the words a reader expects. */
  var LANE_LABEL = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done" };
  var LANE_EMPTY = {
    todo: "nothing waiting",
    doing: "nothing in flight",
    blocked: "nothing blocked",
    done: "nothing finished yet"
  };

  /** One element with optional class and text. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** One button that calls back, so nothing on the page is a click handler in markup. */
  function actionButton(label, onClick, variant) {
    var node = el("button", "bf-btn" + (variant ? " bf-btn--" + variant : " bf-btn--ghost"), label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /** A kit chip, with a tone when the meaning is a state. */
  function chip(text, tone) {
    return el("span", "bf-chip" + (tone ? " bf-chip--" + tone : ""), text);
  }

  /** "12m ago", "3h ago", "just now" — the age of the last write to a card. */
  function ago(at) {
    var seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 45) return "just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.round(hours / 24) + "d ago";
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

  /** A path hint, or the +N chip that points at the rest. */
  function paths(card, limit) {
    var list = el("ul", "board-card__row");
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
    item.appendChild(el("p", "board-card__id", "#" + card.id));

    var title = actionButton(card.title, function () {
      board.openCard(card.id);
    });
    title.className = "board-card__title";
    item.appendChild(title);

    var owner = el("p", "board-card__owner");
    owner.appendChild(card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned"));
    item.appendChild(owner);

    if (card.paths.length > 0) item.appendChild(paths(card, 3));

    if (card.status === "doing" || card.status === "blocked") {
      item.appendChild(el("p", "board-card__owner" + (card.plan ? "" : " board-card__flagged"), card.plan ? "✓ planned" : "unplanned"));
    }
    var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
    if (last) item.appendChild(el("p", "board-card__note", last.by + ": " + last.text));

    var actions = el("div", "board-card__actions");
    if (card.status === "todo") {
      actions.appendChild(actionButton("Claim", function () { board.act("claim", card); }));
    }
    actions.appendChild(actionButton("Note", function () { board.openCard(card.id, "note"); }));
    if (card.status === "doing" || card.status === "blocked") actions.appendChild(actionButton("Move", function () { board.openCard(card.id, "move"); }));
    actions.appendChild(actionButton("History", function () { board.openCard(card.id); }));
    item.appendChild(actions);
    return item;
  }

  /** The toolbar's tallies. */
  function renderCounts(counts) {
    var list = document.getElementById("board-counts");
    if (!list) return;
    list.textContent = "";
    var order = ["total", "doing", "blocked", "done"];
    for (var i = 0; i < order.length; i++) {
      var pair = el("div", "");
      pair.appendChild(el("dt", "", order[i]));
      pair.appendChild(el("dd", "", counts[order[i]]));
      list.appendChild(pair);
    }
  }

  /** The four lanes. */
  function renderLanes(view) {
    var lanes = document.getElementById("board-lanes");
    if (!lanes) return;
    lanes.textContent = "";
    for (var i = 0; i < view.lanes.length; i++) {
      var lane = view.lanes[i];
      var section = el("section", "board-lane");
      section.setAttribute("data-status", lane.status);
      var head = el("h2", "board-lane__head");
      head.appendChild(el("span", "board-lane__dot"));
      head.appendChild(el("span", "", LANE_LABEL[lane.status] || lane.status));
      head.appendChild(chip(String(lane.cards.length)));
      section.appendChild(head);
      var list = el("ol", "board-lane__list");
      if (lane.cards.length === 0) list.appendChild(el("li", "bf-empty", LANE_EMPTY[lane.status] || "nothing"));
      for (var j = 0; j < lane.cards.length; j++) list.appendChild(cardNode(lane.cards[j], view));
      section.appendChild(list);
      lanes.appendChild(section);
    }
    renderPicker(view);
  }

  /** The lane selector the narrow layout shows instead of four columns. */
  function renderPicker(view) {
    var picker = document.getElementById("lane-picker");
    if (!picker) return;
    picker.textContent = "";
    for (var i = 0; i < view.lanes.length; i++) {
      (function (lane) {
        var button = actionButton(
          (LANE_LABEL[lane.status] || lane.status) + " · " + lane.cards.length,
          function () { board.showLane(lane.status); },
          undefined
        );
        button.setAttribute("data-lane", lane.status);
        button.setAttribute("aria-pressed", String(board.lane === lane.status));
        picker.appendChild(button);
      })(view.lanes[i]);
    }
    board.applyLane();
  }

  /** One owner's panel, or one group's panel. */
  function ownerPanel(label, list, options) {
    var panel = el("article", "bf-panel");
    var head = el("h2", "board-owner__head");
    head.appendChild(chip(label, options && options.accent ? "accent" : undefined));
    head.appendChild(el("span", "board-done", String(list.length) + (list.length === 1 ? " card" : " cards")));
    panel.appendChild(head);
    if (list.length === 0) {
      panel.appendChild(el("p", "bf-empty", (options && options.empty) || "nothing"));
      return panel;
    }
    var rows = el("ul", "board-owner__list");
    for (var i = 0; i < list.length; i++) rows.appendChild(ownerRow(list[i], options));
    panel.appendChild(rows);
    return panel;
  }

  /** One card inside an owner or group panel. */
  function ownerRow(card, options) {
    var row = el("li", "board-owner__row");
    var open = actionButton("#" + card.id + " " + card.title, function () { board.openCard(card.id); });
    open.className = "board-card__title";
    row.appendChild(open);
    var meta = el("div", "board-owner__meta");
    meta.appendChild(chip(card.status));
    if (card.status === "doing") meta.appendChild(chip(card.plan ? "planned" : "unplanned", card.plan ? undefined : "warn"));
    meta.appendChild(el("span", "board-done", ago(card.updatedAt)));
    row.appendChild(meta);
    if (options && options.reclaim && card.status !== "done") {
      row.appendChild(actionButton("Reclaim", function () { board.act("reclaim", card); }));
    }
    return row;
  }

  /** The Team tab: owners first, then what needs the lead's decision. */
  function renderTeam(view) {
    var team = document.getElementById("board-team");
    if (!team) return;
    team.textContent = "";
    var round = view.round;
    for (var i = 0; i < round.owners.length; i++) {
      team.appendChild(ownerPanel(round.owners[i].label, round.owners[i].cards, { accent: true, reclaim: true, empty: "nothing in flight" }));
    }
    team.appendChild(ownerPanel("Unassigned", round.unassigned, { empty: "every card has an owner" }));
    team.appendChild(ownerPanel("Unplanned", round.unplanned, { empty: "every card in flight is planned" }));
    team.appendChild(ownerPanel("Blocked", round.blocked, { empty: "nothing blocked" }));
    team.appendChild(ownerPanel("Idle", round.idle, { empty: "nobody has gone quiet" }));
    if (round.done.length > 0) {
      var names = [];
      for (var j = 0; j < round.done.length; j++) names.push("#" + round.done[j].id);
      team.appendChild(el("p", "board-done", "Done · " + names.join(" ")));
    }
  }

  /** The toolbar's identity, badge, and footer. */
  function renderChrome(view) {
    var me = document.getElementById("board-me");
    if (me) {
      me.textContent = view.me.label;
      me.title = "Writes from this page are made as " + view.me.label;
    }
    var where = document.getElementById("board-where");
    if (where) {
      where.textContent = "store: " + view.where + " · " + view.counts.total + " cards · " + size(view.bytes);
    }
  }

  /** Fill the card dialog from a card, without opening it. */
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
    plan.textContent = card.plan ? "plan: " + card.plan : "";

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

  /** The dialog's footer: the lane buttons this card may move to, and its destructive ones. */
  function fillDialogActions(card, view) {
    var footer = document.getElementById("card-dialog-actions");
    footer.textContent = "";
    var isMine = mine(card, view.me);
    if (card.status !== "done" && isMine) {
      var lanes = ["doing", "blocked", "done"];
      for (var i = 0; i < lanes.length; i++) {
        if (lanes[i] === card.status) continue;
        (function (lane) {
          footer.appendChild(actionButton("Move to " + LANE_LABEL[lane].toLowerCase(), function () {
            board.act("move", card, { status: lane });
          }));
        })(lanes[i]);
      }
    }
    if (card.status !== "done" && isMine) {
      footer.appendChild(actionButton("Release", function () { board.act("release", card); }));
    }
    if (card.status === "todo" || card.status === "done" || isMine) {
      footer.appendChild(actionButton("Drop", function () { board.act("drop", card); }, "danger"));
    }
    var close = actionButton("Close", function () { board.closeCard(); });
    footer.appendChild(close);
  }

  /** Paint a whole snapshot. */
  board.render = function (view) {
    board.view = view;
    renderChrome(view);
    renderCounts(view.counts);
    renderLanes(view);
    renderTeam(view);
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
  board.fillDialog = fillDialog;
})();`;
