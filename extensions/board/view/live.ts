/**
 * The client's wiring: the tabs, the composer, the two dialogs, and the live frame
 * stream.
 *
 * A frame is whole snapshot, so every message replaces the page rather than patching
 * it — no client-side diff, no state machine, and nothing to get wrong when a card
 * moves lane while a dialog is open. The only client state is which tab is showing,
 * which card's dialog is open, and the lane the narrow layout is on.
 */

export const BOARD_LIVE_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var token = new URLSearchParams(window.location.search).get("token") || "";

  /** The badge's text and state: connecting, live, reconnecting. */
  function badge(state, at) {
    var node = document.getElementById("board-status");
    if (!node) return;
    node.setAttribute("data-state", state);
    if (state === "live" && at !== undefined) node.textContent = "live · " + board.ago(at);
    else if (state === "reconnecting") node.textContent = "reconnecting…";
    else node.textContent = "connecting…";
  }

  /** Show one tab: the panel, aria-current, and the address so a link is shareable. */
  function showView(view) {
    var team = view === "team";
    document.documentElement.setAttribute("data-view", team ? "team" : "board");
    document.getElementById("panel-board").hidden = team;
    document.getElementById("panel-team").hidden = !team;
    document.getElementById("tab-board").setAttribute("aria-current", team ? "false" : "page");
    document.getElementById("tab-team").setAttribute("aria-current", team ? "page" : "false");
    var url = new URL(window.location.href);
    url.searchParams.set("view", team ? "team" : "board");
    window.history.replaceState(null, "", url.toString());
  }

  /** The narrow layout shows one lane; the picker is the only way to change it. */
  function applyLane() {
    var narrow = window.matchMedia && window.matchMedia("(max-width: 860px)").matches;
    var lanes = document.querySelectorAll(".board-lane");
    for (var i = 0; i < lanes.length; i++) {
      var selected = lanes[i].getAttribute("data-status") === board.lane;
      lanes[i].hidden = narrow && !selected;
    }
    var buttons = document.querySelectorAll("#lane-picker [data-lane]");
    for (var j = 0; j < buttons.length; j++) {
      var on = buttons[j].getAttribute("data-lane") === board.lane;
      buttons[j].setAttribute("aria-pressed", String(on));
      buttons[j].className = "bf-btn" + (on ? " bf-btn--primary" : " bf-btn--ghost");
    }
  }

  function showLane(lane) {
    board.lane = lane;
    applyLane();
  }

  /** Fill and open the card dialog; the second argument names what to focus. */
  function openCard(id, focus) {
    var view = board.view;
    if (!view) return;
    var card = board.findCard(view, id);
    if (!card) return;
    board.openId = id;
    board.fillDialog(card, view);
    var dialog = document.getElementById("board-card-dialog");
    dialog.showModal();
    if (focus === "note") document.getElementById("card-dialog-note").focus();
    else document.getElementById("card-dialog-close").focus();
  }

  function closeCard() {
    board.openId = undefined;
    var dialog = document.getElementById("board-card-dialog");
    if (dialog.open) dialog.close();
  }

  /** The gray cards a page shows while it waits for its first frame. */
  function skeletons() {
    var lanes = document.getElementById("board-lanes");
    if (!lanes || lanes.childElementCount > 0) return;
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
      // An empty board is an invitation: the caret goes to the one field that fills it.
      board.focused = true;
      var title = document.getElementById("new-title");
      if (title) title.focus();
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

  /** The composer: title, space-separated paths, and an optional first note. */
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
      var note = document.getElementById("new-note").value.trim();
      var input = { title: title.value.trim() };
      if (paths.length > 0) input.paths = paths;
      if (note) input.note = note;
      board.add(input).then(function (payload) {
        if (!payload) return;
        form.reset();
        title.focus();
      });
    });
  }

  /** The card dialog: its note, its plan, and its own close buttons. */
  function wireDialog() {
    var dialog = document.getElementById("board-card-dialog");
    if (!dialog) return;
    document.getElementById("card-dialog-close").addEventListener("click", closeCard);
    document.getElementById("card-dialog-close-2").addEventListener("click", closeCard);
    dialog.addEventListener("cancel", function () {
      board.openId = undefined;
    });

    var noteForm = document.getElementById("card-dialog-note-form");
    noteForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("card-dialog-note");
      var text = input.value.trim();
      if (!text || board.openId === undefined) return;
      var card = board.findCard(board.view, board.openId);
      if (!card) return;
      board.note(card, text).then(function (payload) {
        if (!payload) return;
        input.value = "";
      });
    });

    var planForm = document.getElementById("card-dialog-plan-form");
    planForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("card-dialog-plan-input");
      var path = input.value.trim();
      if (!path || board.openId === undefined) return;
      var card = board.findCard(board.view, board.openId);
      if (!card) return;
      board.plan(card, path).then(function (payload) {
        if (!payload) return;
        input.value = "";
      });
    });
  }

  /** The tabs, the lane picker, and the dialog's own open/close. */
  function wireChrome() {
    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        showView(event.currentTarget.getAttribute("data-view"));
      });
    }
    var picker = document.getElementById("lane-picker");
    if (picker) {
      picker.addEventListener("click", function (event) {
        var lane = event.target && event.target.getAttribute ? event.target.getAttribute("data-lane") : null;
        if (lane) showLane(lane);
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

  board.showView = showView;
  board.showLane = showLane;
  board.applyLane = applyLane;
  board.openCard = openCard;
  board.closeCard = closeCard;
  board.start = function () {
    board.lane = undefined;
    board.openId = undefined;
    showView(new URLSearchParams(window.location.search).get("view") === "team" ? "team" : "board");
    wireChrome();
    wireComposer();
    wireDialog();
    skeletons();
    stream();
  };
})();`;
