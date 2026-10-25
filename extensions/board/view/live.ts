/**
 * The client's wiring: the tabs, the lane picker, the new-card dialog, the filter,
 * and the live frame stream.
 *
 * A frame is a whole snapshot, so every message repaints from it rather than patching
 * it — the renderer decides what actually changed. The only client state is which tab
 * is showing, the filter text, which lanes are collapsed, and which card's dialog is
 * open; none of it is authoritative, and none of it is sent anywhere.
 */

export const BOARD_LIVE_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var token = new URLSearchParams(window.location.search).get("token") || "";
  var LANE_LABEL = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done" };

  /** The lane's word, for the dialog's move buttons. */
  board.laneLabel = function (lane) {
    return LANE_LABEL[lane] || lane;
  };

  /** The badge's text and its kit status role: connecting, live, reconnecting. */
  function badge(state, at) {
    var node = document.getElementById("board-status");
    if (!node) return;
    node.setAttribute("data-state", state);
    node.className = "bf-status board-status" +
      (state === "live" ? " bf-status--saved" : state === "reconnecting" ? " bf-status--error" : "");
    // "now" would read as "live · now ago", so a fresh frame says only "live".
    if (state === "live") {
      var age = at === undefined ? "now" : board.ago(at);
      node.textContent = age === "now" ? "live" : "live · " + age;
    }
    else if (state === "reconnecting") node.textContent = "reconnecting…";
    else node.textContent = "connecting…";
  }

  /** Show one tab: the panel, aria-current, and the address so a link is shareable. */
  function showView(view) {
    var team = view === "team";
    document.documentElement.setAttribute("data-view", team ? "team" : "board");
    document.getElementById("panel-board").hidden = team;
    document.getElementById("panel-team").hidden = !team;
    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      var current = tabs[i].getAttribute("data-view") === (team ? "team" : "board");
      if (current) tabs[i].setAttribute("aria-current", "page");
      else tabs[i].removeAttribute("aria-current");
    }
    var url = new URL(window.location.href);
    url.searchParams.set("view", team ? "team" : "board");
    window.history.replaceState(null, "", url.toString());
  }

  board.viewName = function () {
    return document.documentElement.getAttribute("data-view") === "team" ? "team" : "board";
  };

  /** The narrow layout shows one lane; the picker is the only way to change it. */
  function applyLane() {
    var narrow = window.matchMedia && window.matchMedia("(max-width: 860px)").matches;
    var lanes = document.querySelectorAll(".board-lane");
    for (var i = 0; i < lanes.length; i++) {
      var selected = lanes[i].getAttribute("data-status") === board.lane;
      lanes[i].hidden = narrow && !selected;
    }
    var items = document.querySelectorAll("#board-picker [data-lane]");
    for (var j = 0; j < items.length; j++) {
      if (items[j].getAttribute("data-lane") === board.lane) items[j].setAttribute("aria-current", "page");
      else items[j].removeAttribute("aria-current");
    }
  }

  board.applyLane = applyLane;

  board.showLane = function (lane) {
    board.lane = lane;
    applyLane();
  };

  /** Fold a lane's cards away and leave its head, count and all. */
  board.toggleLane = function (status) {
    board.collapsed = board.collapsed || {};
    board.collapsed[status] = board.collapsed[status] !== true;
    if (board.view) board.render(board.view);
  };

  board.showView = showView;

  /**
   * The composer writes one card: a new one, or the one the card dialog was showing.
   *
   * The mode lives here rather than in the form, because the form is a draft: leaving
   * edit mode puts the dialog back the way the toolbar's button opens it, and the text
   * it held was the card's, not the reader's.
   */
  var composer = { mode: "add", card: undefined };

  /** The title's character count, shown from the first character typed. */
  function showTitleCount() {
    var field = document.getElementById("new-title");
    var count = document.getElementById("new-title-count");
    if (!field || !count) return;
    var max = Number(field.getAttribute("maxlength"));
    if (!max) return;
    var used = field.value.length;
    count.textContent = used + "/" + max;
    count.hidden = used === 0;
  }

  /** Dress the dialog for a new card or for the one being edited, and fill it in. */
  function setComposerMode(mode, card) {
    var heading = document.getElementById("board-new-title");
    var submit = document.getElementById("new-submit");
    var hint = document.getElementById("composer-hint");
    var form = document.getElementById("board-composer");
    var was = composer.mode;
    composer.mode = mode;
    composer.card = mode === "edit" ? card : undefined;
    if (mode === "edit") {
      var title = document.getElementById("new-title");
      var paths = document.getElementById("new-paths");
      var priority = document.getElementById("new-priority");
      if (title) title.value = card.title;
      if (paths) paths.value = (card.paths || []).join(" ");
      if (priority) priority.value = board.priorityOf(card);
      if (heading) heading.textContent = "Edit card #" + card.id;
      if (submit) submit.textContent = "Save";
      if (hint) hint.textContent = "links are recorded with the board tool, while the card is being planned";
      showTitleCount();
      return;
    }
    // Leaving edit mode throws its text away; a draft written here survives Esc.
    if (was === "edit" && form) form.reset();
    if (heading) heading.textContent = "New card";
    if (submit) submit.textContent = "Add card";
    if (hint && board.composerHint !== undefined) hint.textContent = board.composerHint;
    showTitleCount();
  }

  /** Open whichever mode the composer is dressed for, with the caret in the title. */
  function openComposerForm() {
    if (!window.bfNew) return;
    // The kit focuses a dialog's first control, which here is its close button; a card
    // starts with a title, so the caret belongs in that field.
    window.bfNew.open();
    var input = document.getElementById("new-title");
    if (input) input.focus();
  }

  /** Open the new-card dialog. */
  board.openComposer = function () {
    if (composer.mode === "edit") setComposerMode("add");
    openComposerForm();
  };

  /** Open it on one card: the same two fields, prefilled, with Save in place of Add. */
  board.editCard = function (card) {
    if (!window.bfNew) return;
    board.closeCard();
    setComposerMode("edit", card);
    openComposerForm();
    var title = document.getElementById("new-title");
    // The end of the title is where a typo is, so that is where the caret starts.
    if (title && title.setSelectionRange) title.setSelectionRange(title.value.length, title.value.length);
  };

  /** Close it and keep the draft: only Cancel throws one away. */
  board.closeComposer = function () {
    if (window.bfNew) window.bfNew.close();
  };

  /** Discard the draft and close, which is what its own Cancel button does. */
  board.cancelComposer = function () {
    var form = document.getElementById("board-composer");
    if (form) form.reset();
    setComposerMode("add");
    board.closeComposer();
  };

  board.composerOpen = function () {
    return window.bfNew ? window.bfNew.isOpen() : false;
  };

  board.focusComposer = function () {
    board.openComposer();
  };
  board.focusFilter = function () {
    var input = document.getElementById("board-filter");
    if (input) {
      input.focus();
      input.select();
    }
  };

  /** Apply the filter box's text to the board, without waiting for a frame. */
  board.applyFilter = function () {
    var input = document.getElementById("board-filter");
    board.query = input ? input.value.trim() : "";
    if (board.view) board.render(board.view);
  };

  board.hasFilter = function () {
    return board.query !== undefined && board.query !== "";
  };

  board.clearFilter = function () {
    var input = document.getElementById("board-filter");
    if (input && input.value !== "") {
      input.value = "";
      board.applyFilter();
    }
  };

  board.openKeys = function () {
    if (window.bfKeys) window.bfKeys.open();
  };
  board.closeKeys = function () {
    if (window.bfKeys) window.bfKeys.close();
  };
  board.keysOpen = function () {
    return window.bfKeys ? window.bfKeys.isOpen() : false;
  };

  /**
   * The grey cards a page shows while it waits for its first frame.
   *
   * They are marked as placeholders rather than given a lane status: the renderer
   * looks lanes up by data-status, so a skeleton that carried one would be adopted
   * as the real lane and the cards would never be drawn into it.
   */
  function skeletons() {
    var lanes = document.getElementById("board-lanes");
    if (!lanes || lanes.childElementCount > 0) return;
    lanes.setAttribute("data-skeleton", "1");
    for (var i = 0; i < 4; i++) {
      var lane = board.el("section", "board-lane");
      for (var j = 0; j < 2; j++) lane.appendChild(board.el("div", "board-skeleton"));
      lanes.appendChild(lane);
    }
  }

  /**
   * The lane a narrow reader lands on: the first with a card in it, else the first
   * lane. Opening on an empty To do while the only card sits in Blocked is a blank
   * page with a picker nobody has a reason to press.
   */
  function laneWithWork(view) {
    for (var i = 0; i < view.lanes.length; i++) if (view.lanes[i].cards.length > 0) return view.lanes[i].status;
    return view.lanes[0] ? view.lanes[0].status : "todo";
  }

  /** One frame: paint and record when it arrived. */
  function paint(view) {
    board.lastFrame = Date.now();
    board.lane = board.lane || laneWithWork(view);
    badge("live", board.lastFrame);
    board.render(view);
  }

  /** The live channel: a reconnect is the browser's own retry, not a second request. */
  function stream() {
    var source = new EventSource("/events?token=" + encodeURIComponent(token));
    source.onopen = function () {
      badge("live", board.lastFrame);
    };
    source.onmessage = function (event) {
      var view;
      try {
        view = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      paint(view);
    };
    source.onerror = function () {
      badge("reconnecting");
    };
  }

  /** The new-card dialog: a title, space-separated path hints, a priority, and Add. */
  function wireComposer() {
    var form = document.getElementById("board-composer");
    if (!form) return;
    // The hint is the page's, not this module's: a second copy of the sentence would drift.
    var hint = document.getElementById("composer-hint");
    board.composerHint = hint ? hint.textContent : "";
    // The field is capped at 120 characters, and a cap nobody can see reads as a bug the
    // first time typing stops; the count appears with the first character.
    var titleField = document.getElementById("new-title");
    if (titleField) titleField.addEventListener("input", showTitleCount);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var title = document.getElementById("new-title");
      if (!title.value.trim()) {
        title.focus();
        return;
      }
      var paths = document.getElementById("new-paths").value.split(/\s+/).filter(Boolean);
      var priorityField = document.getElementById("new-priority");
      var priority = priorityField ? priorityField.value : "normal";
      if (composer.mode === "edit") {
        var card = composer.card;
        if (!card) return;
        // Every field goes, including the unchanged ones: an edit means "this is what it
        // should say", and a priority changed back to normal is a change too.
        board.act("edit", card, { title: title.value.trim(), paths: paths, priority: priority }).then(function (payload) {
          if (payload) board.cancelComposer();
        });
        return;
      }
      var input = { title: title.value.trim(), paths: paths };
      if (priority !== "normal") input.priority = priority;
      board.add(input).then(function (payload) {
        if (!payload) return;
        // The dialog stays open: a lead publishes several cards in a row.
        form.reset();
        showTitleCount();
        title.focus();
      });
    });
    var trigger = document.getElementById("board-new");
    if (trigger) {
      trigger.addEventListener("click", function () {
        if (board.composerOpen()) board.closeComposer();
        else board.openComposer();
      });
    }
    // The dialog's single closer: Esc and the backdrop keep the draft, this does not.
    var cancel = document.getElementById("board-cancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        board.cancelComposer();
      });
    }
    var first = document.getElementById("board-first-card");
    if (first) {
      first.addEventListener("click", function () {
        board.openComposer();
      });
    }
  }

  /** The filter, the note button, and the two tab sets. */
  function wireChrome() {
    var filter = document.getElementById("board-filter");
    if (filter) {
      filter.addEventListener("input", function () {
        board.applyFilter();
      });
    }
    var noteAdd = document.getElementById("card-dialog-note-add");
    if (noteAdd) noteAdd.addEventListener("click", function () { board.addNote(); });

    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        showView(event.currentTarget.getAttribute("data-view"));
      });
    }
    var picker = document.getElementById("board-picker");
    if (picker) {
      picker.addEventListener("click", function (event) {
        var lane = event.target && event.target.getAttribute ? event.target.getAttribute("data-lane") : null;
        if (lane) board.showLane(lane);
      });
    }
    if (window.matchMedia) {
      var query = window.matchMedia("(max-width: 860px)");
      var onChange = function () {
        applyLane();
      };
      if (query.addEventListener) query.addEventListener("change", onChange);
      else if (query.addListener) query.addListener(onChange);
    }
    // The badge says how fresh the last frame is, which is the one thing a quiet
    // board cannot show by changing; the ages are the other, so the same tick keeps
    // them honest without waiting for somebody to write.
    window.setInterval(function () {
      if (board.lastFrame !== undefined) badge("live", board.lastFrame);
      board.refreshAges();
    }, 1000);
  }

  board.start = function () {
    board.lane = undefined;
    board.openId = undefined;
    board.query = "";
    board.collapsed = {};
    showView(new URLSearchParams(window.location.search).get("view") === "team" ? "team" : "board");
    wireChrome();
    wireComposer();
    skeletons();
    board.bindKeys(document);
    stream();
  };
})();`;
