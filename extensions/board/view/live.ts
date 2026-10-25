/**
 * The client's wiring: the tabs, the lane picker, the composer, the filter, and the
 * live frame stream.
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

  /** Open the composer drawer and put the caret in it. */
  board.openComposer = function () {
    var form = document.getElementById("board-composer");
    var trigger = document.getElementById("board-new");
    if (form) form.hidden = false;
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    var input = document.getElementById("new-title");
    if (input) input.focus();
  };

  /** Fold it away, unless a draft is in it — a half-typed card is not lost on Esc. */
  board.closeComposer = function () {
    var form = document.getElementById("board-composer");
    var trigger = document.getElementById("board-new");
    var title = document.getElementById("new-title");
    var paths = document.getElementById("new-paths");
    if (!form || form.hidden) return;
    if (title && title.value.trim() !== "") return;
    if (paths && paths.value.trim() !== "") return;
    form.hidden = true;
    if (trigger && trigger.focus) trigger.focus();
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  };

  /** Discard whatever is in the drawer and fold it, leaving focus on the trigger. */
  board.cancelComposer = function () {
    var form = document.getElementById("board-composer");
    if (!form) return;
    form.hidden = true;
    var trigger = document.getElementById("board-new");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    }
  };

  board.composerOpen = function () {
    var form = document.getElementById("board-composer");
    return form ? !form.hidden : false;
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

  /** One frame: paint, record when it arrived, and put the caret where a reader acts. */
  function paint(view) {
    board.lastFrame = Date.now();
    board.lane = board.lane || (view.lanes[0] ? view.lanes[0].status : "todo");
    badge("live", board.lastFrame);
    board.render(view);
    if (!board.focused && view.counts.total === 0) {
      board.focused = true;
      board.focusComposer();
    }
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

  /** The composer: a title, space-separated path hints, and Add. */
  function wireComposer() {
    var form = document.getElementById("board-composer");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var title = document.getElementById("new-title");
      if (!title.value.trim()) {
        title.focus();
        return;
      }
      var paths = document.getElementById("new-paths").value.split(/\s+/).filter(Boolean);
      var input = { title: title.value.trim() };
      if (paths.length > 0) input.paths = paths;
      board.add(input).then(function (payload) {
        if (!payload) return;
        // The drawer stays open: a lead publishes several cards in a row.
        form.reset();
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
    // A drawer with a draft opens no other way out, so Cancel discards it on purpose.
    var cancel = document.getElementById("board-cancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        form.reset();
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
    // board cannot show by changing.
    window.setInterval(function () {
      if (board.lastFrame !== undefined) badge("live", board.lastFrame);
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
