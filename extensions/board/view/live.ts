/**
 * The client's wiring: the tabs, the lane picker, the filter, and the live frame stream.
 *
 * A frame is a whole snapshot, so every message repaints from it rather than patching
 * it — the renderer decides what actually changed. The only client state is which tab
 * is showing, the filter text, which lanes are collapsed, which card's dialog is open,
 * and where the reader is on the board — the card they are on and the ones they have
 * read; none of it is authoritative, and none of it is sent anywhere.
 */

export function liveJs(rules: { picker: string }): string {
	return liveTemplate.replace("__PICKER_MQ__", rules.picker);
}

const liveTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var token = new URLSearchParams(window.location.search).get("token") || "";
  /**
   * The width below which the board shows one lane at a time, with the picker.
   *
   * One constant, spliced from the stylesheet's own number: the media query and the two
   * matchMedia calls here are the same question, and two copies of it is how the picker
   * came to appear 320px after the lanes had already started stacking under each other.
   */
  var PICKER_MQ = "(max-width: " + __PICKER_MQ__ + "px)";
  /** The state the shared stream client last reported, which the age ticker repaints. */
  var streamState = "connecting";

  /**
   * The chip's word and its tone, in this page's four states.
   *
   * The states and their transitions are the shared client's, and the words and tones are the
   * kit's — the board appends the frame's age and nothing else, so a quiet board can show that
   * its frames are still arriving without owning a second table of what a state says.
   */
  function badge(state, at) {
    streamState = state;
    var node = document.getElementById("board-status");
    if (!node) return;
    node.setAttribute("data-state", state);
    // "now" would read as "live · now ago", so a fresh frame adds nothing to the word.
    var age = state === "live" ? (at === undefined ? "now" : board.ago(at)) : "";
    board.paintLiveState(node, state, age === "" || age === "now" ? "" : " · " + age);
    // A stream that has not come back is where this page stops being true, and a reload is the
    // one action a reader has. While the browser is still retrying, the chip says that instead.
    var reload = document.getElementById("reload-hint");
    if (reload) reload.hidden = state !== "dead";
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
    var narrow = window.matchMedia && window.matchMedia(PICKER_MQ).matches;
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

  /**
   * Fold one list away and leave its control standing.
   *
   * Three things on the page fold: a lane, the roster's tail of owners nothing answers to, and
   * the Done strip. They share one map, and a key says which kind it is: a lane keeps its own
   * name, and the two the Team tab owns are team-roster and team-done, because done is
   * already a lane.
   *
   * The key is also recorded, because the panel a fold lives in is repainted: the element the
   * reader clicked no longer exists when the frame lands, and the renderer focuses
   * data-fold="<key>" to put the keyboard back where it was.
   */
  board.toggleFold = function (key) {
    board.collapsed = board.collapsed || {};
    board.collapsed[key] = board.collapsed[key] !== true;
    board.foldFocus = key;
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
   * The Team tab's grey columns, for the same moment: a page that has not had its first
   * frame should look like it is loading, not like it has nothing to say.
   */
  function teamSkeleton() {
    var root = document.getElementById("board-team");
    if (!root || root.childElementCount > 0) return;
    var grid = board.el("div", N.teamGrid);
    for (var i = 0; i < 3; i++) {
      var column = board.el("section", N.teamColumn);
      for (var j = 0; j < 2; j++) column.appendChild(board.el("div", N.teamSkeleton));
      grid.appendChild(column);
    }
    root.appendChild(grid);
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
  function paintFrame(view) {
    board.lastFrame = Date.now();
    board.shown = board.shown || laneWithWork(view);
    board.render(view);
  }

  /** The live channel: one state machine for every page, in this page's words. */
  function stream() {
    board.liveStream({
      url: pageBase() + "/events",
      token: token,
      words: function (state) {
        badge(state, board.lastFrame);
      },
      frame: function (event) {
        var view;
        try {
          view = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        paintFrame(view);
      },
    });
  }

  /** The filter and the two tab sets. */
  function wireChrome() {
    var reload = document.getElementById("reload-hint");
    if (reload) {
      reload.addEventListener("click", function () {
        window.location.reload();
      });
    }
    var filter = document.getElementById("board-filter");
    if (filter) {
      filter.addEventListener("input", function () {
        board.applyFilter();
      });
    }
    // The no-match state's one control: a view action, like the tab switch, and it puts the
    // reader back in the field they were typing in.
    var clear = document.getElementById("board-no-match-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        board.clearFilter();
        board.focusFilter();
      });
    }
    var tabs = document.querySelectorAll("[data-view][role='tab']");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        showView(event.currentTarget.getAttribute("data-view"));
      });
    }
    bindTabKeys(tabs);
    // A card's title button takes the keyboard from j/k, a Tab, or a click, and the mark
    // follows focus rather than the key that moved it. A focus outside the cards leaves the
    // last card marked, which is what a reader coming back from the filter expects.
    document.addEventListener("focusin", function (event) {
      var node = event.target;
      var card = node && node.closest ? node.closest(".board-row") : null;
      if (!card) return;
      board.current = card.getAttribute("data-card");
      board.markCards();
    });
    var picker = document.getElementById("board-picker");
    if (picker) {
      picker.addEventListener("click", function (event) {
        var lane = event.target && event.target.getAttribute ? event.target.getAttribute("data-picker-lane") : null;
        if (lane) board.showLane(lane);
      });
    }
    if (window.matchMedia) {
      var query = window.matchMedia(PICKER_MQ);
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
      if (board.lastFrame !== undefined) badge(streamState, board.lastFrame);
      board.refreshAges();
    }, 1000);
  }

  board.start = function () {
    board.shown = undefined;
    board.openId = undefined;
    board.query = "";
    board.collapsed = {};
    // The fold a reader just moved, and the panels' remembered signatures: both belong to the
    // tab, and a fresh tab is a fresh read of what the store holds.
    board.foldFocus = undefined;
    board.teamPanels = undefined;
    // Where the reader is and has been: the two marks a card face can wear, which live as
    // long as the tab does and never reach the store.
    board.current = undefined;
    board.visited = {};
    showView(new URLSearchParams(window.location.search).get("view") === "team" ? "team" : "board");
    wireChrome();
    skeletons();
    teamSkeleton();
    board.bindKeys(document);
    stream();
  };
})();`;
