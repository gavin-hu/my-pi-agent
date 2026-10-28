/**
 * The client's wiring: the tabs, the lane picker, the filter, and the live frame stream.
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

  /** The badge's text and its kit status role: connecting, live, reconnecting. */
  function badge(state, at) {
    var node = document.getElementById("board-status");
    if (!node) return;
    node.setAttribute("data-state", state);
    node.className = "bf-status " + N.status +
      (state === "live" ? " bf-status--saved" : state === "reconnecting" ? " bf-status--error" : "");
    // "now" would read as "live · now ago", so a fresh frame says only "live".
    if (state === "live") {
      var age = at === undefined ? "now" : board.ago(at);
      node.textContent = age === "now" ? "live" : "live · " + age;
    }
    else if (state === "reconnecting") node.textContent = "reconnecting…";
    else node.textContent = "connecting…";
  }

  /** Show one tab: the panel, the selected tab, and the address so a link is shareable. */
  function showView(view) {
    var team = view === "team";
    document.documentElement.setAttribute("data-view", team ? "team" : "board");
    document.getElementById("panel-board").hidden = team;
    document.getElementById("panel-team").hidden = !team;
    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      var current = tabs[i].getAttribute("data-view") === (team ? "team" : "board");
      // A tablist is read through aria-selected, and a roving tabindex is what makes one
      // Tab land on the strip rather than on each tab in turn. Both are the markup's own
      // attributes: a state painted only in a class is a state a screen reader cannot read.
      tabs[i].setAttribute("aria-selected", current ? "true" : "false");
      tabs[i].setAttribute("tabindex", current ? "0" : "-1");
    }
    var url = new URL(window.location.href);
    url.searchParams.set("view", team ? "team" : "board");
    window.history.replaceState(null, "", url.toString());
  }

  /**
   * Arrow keys move along the tab strip, the way a tablist is expected to behave.
   *
   * Automatic activation: the panels are both in the document already, so showing one is a
   * hidden attribute rather than a request, and a reader who arrows across the strip sees
   * each tab he lands on. Home and End are the ends of it.
   */
  function bindTabKeys(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("keydown", function (event) {
        var names = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (names.indexOf(event.key) === -1) return;
        event.preventDefault();
        var at = 0;
        for (var j = 0; j < tabs.length; j++) if (tabs[j] === event.currentTarget) at = j;
        var step = event.key === "ArrowLeft" ? -1 : 1;
        var next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + step + tabs.length) % tabs.length;
        showView(tabs[next].getAttribute("data-view"));
        tabs[next].focus();
      });
    }
  }

  board.viewName = function () {
    return document.documentElement.getAttribute("data-view") === "team" ? "team" : "board";
  };

  /** The narrow layout shows one lane; the picker is the only way to change it. */
  function applyLane() {
    var narrow = window.matchMedia && window.matchMedia("(max-width: 860px)").matches;
    var lanes = document.querySelectorAll(".board-lane");
    for (var i = 0; i < lanes.length; i++) {
      var selected = lanes[i].getAttribute("data-lane") === board.shown;
      lanes[i].hidden = narrow && !selected;
    }
    var items = document.querySelectorAll("#board-picker [data-picker-lane]");
    for (var j = 0; j < items.length; j++) {
      // A pressed button, because the picker shows one lane rather than joining a tablist:
      // "true" is the lane a reader is looking at, and the kit paints it from this state.
      items[j].setAttribute("aria-pressed", items[j].getAttribute("data-picker-lane") === board.shown ? "true" : "false");
    }
  }

  board.applyLane = applyLane;

  board.showLane = function (lane) {
    board.shown = lane;
    applyLane();
  };

  /** Fold a lane's cards away and leave its head, count and all. */
  board.toggleLane = function (key) {
    board.collapsed = board.collapsed || {};
    board.collapsed[key] = board.collapsed[key] !== true;
    if (board.view) board.render(board.view);
  };

  board.showView = showView;

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
   * looks lanes up by data-lane, so a skeleton that carried one would be adopted
   * as the real lane and the cards would never be drawn into it.
   */
  function skeletons() {
    var lanes = document.getElementById("board-lanes");
    if (!lanes || lanes.childElementCount > 0) return;
    lanes.setAttribute("data-skeleton", "1");
    for (var i = 0; i < board.laneCount; i++) {
      var lane = board.el("section", N.lane);
      for (var j = 0; j < 2; j++) lane.appendChild(board.el("div", N.skeleton));
      lanes.appendChild(lane);
    }
  }

  /**
   * The lane a narrow reader lands on: the first with a card in it, else the first
   * lane. Opening on an empty Backlog while the only card sits in Blocked is a blank
   * page with a picker nobody has a reason to press.
   */
  function laneWithWork(view) {
    for (var i = 0; i < view.lanes.length; i++) if (view.lanes[i].cards.length > 0) return view.lanes[i].key;
    return view.lanes[0] ? view.lanes[0].key : "backlog";
  }

  /** One frame: paint and record when it arrived. */
  function paint(view) {
    board.lastFrame = Date.now();
    board.shown = board.shown || laneWithWork(view);
    badge("live", board.lastFrame);
    board.render(view);
  }

  /** The live channel: a reconnect is the browser's own retry, not a second request. */
  function stream() {
    var source = new EventSource(pageBase() + "/events?token=" + encodeURIComponent(token));
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

  /** The filter and the two tab sets. */
  function wireChrome() {
    var filter = document.getElementById("board-filter");
    if (filter) {
      filter.addEventListener("input", function () {
        board.applyFilter();
      });
    }
    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        showView(event.currentTarget.getAttribute("data-view"));
      });
    }
    bindTabKeys(tabs);
    var picker = document.getElementById("board-picker");
    if (picker) {
      picker.addEventListener("click", function (event) {
        var lane = event.target && event.target.getAttribute ? event.target.getAttribute("data-picker-lane") : null;
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
    board.shown = undefined;
    board.openId = undefined;
    board.query = "";
    board.collapsed = {};
    showView(new URLSearchParams(window.location.search).get("view") === "team" ? "team" : "board");
    wireChrome();
    skeletons();
    board.bindKeys(document);
    stream();
  };
})();`;
