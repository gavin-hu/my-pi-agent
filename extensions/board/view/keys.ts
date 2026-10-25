/**
 * The board page's keyboard: one table, and the two halves that read it.
 *
 * The sheet the user opens with `?` is server-rendered from {@link BOARD_KEYS}, and
 * the bindings that make those keys work are {@link BOARD_KEYS_JS}, so the key a row
 * advertises and the key the client listens for sit in one file — the drift this
 * module exists to prevent, since no type checker sees the bundle.
 *
 * The vocabulary is the TUI's where it means the same thing (`j`/`k`, `?`, `Esc`);
 * `n`, `/` and `t` are this page's own.
 */

import type { KeyHint } from "../../../lib/web/index.ts";

/** One binding: the key or keys, and what pressing it does. */
export const BOARD_KEYS: readonly KeyHint[] = [
	{ keys: "n", label: "New card — focus the title field" },
	{ keys: "/", label: "Filter the cards" },
	{ keys: ["j", "k"], label: "Next or previous card" },
	{ keys: "Enter", label: "Open the focused card" },
	{ keys: "t", label: "Switch Board and Team" },
	{ keys: "Esc", label: "Close a dialog, or clear the filter" },
	{ keys: "?", label: "This sheet" },
];

/**
 * The bindings, as the client sees them.
 *
 * Every branch reads `board.` state and calls `board.` handlers that `render.ts`,
 * `team.ts`, and `live.ts` already published, so this module decides only *which
 * key* does what. A field with focus keeps its keys: `n` inside the note input types
 * an `n`.
 */
export const BOARD_KEYS_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /** Whether the event landed in a field, where every key is text. */
  function typing(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
  }

  /** The card nodes in reading order, so j/k walk the board as it is drawn. */
  function cards() {
    var seen = [];
    var nodes = document.querySelectorAll(".board-card");
    for (var i = 0; i < nodes.length; i++) if (!nodes[i].hidden) seen.push(nodes[i]);
    return seen;
  }

  /** Move focus to the next or previous drawn card, and say so for a screen reader. */
  function step(delta) {
    var drawn = cards();
    if (drawn.length === 0) return;
    var at = drawn.indexOf(document.activeElement);
    var next = at < 0 ? (delta > 0 ? 0 : drawn.length - 1) : (at + delta + drawn.length) % drawn.length;
    var button = drawn[next].querySelector(".board-card__title");
    if (button) button.focus();
  }

  board.bindKeys = function (doc) {
    doc.addEventListener("keydown", function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      var target = event.target;
      if (event.key === "?" && !typing(target)) {
        event.preventDefault();
        board.openKeys();
        return;
      }
      if (event.key === "Escape") {
        if (board.keysOpen && board.keysOpen()) {
          board.closeKeys();
          return;
        }
        if (board.dialogOpen && board.dialogOpen()) {
          board.closeCard();
          return;
        }
        // A filter with text is what Escape is for here; an empty one gives the
        // keyboard back to the page by leaving the field.
        if (board.hasFilter()) {
          board.clearFilter();
          if (typing(target)) target.blur();
          return;
        }
        if (typing(target)) {
          target.blur();
          return;
        }
        return;
      }
      if (typing(target)) {
        if (event.key === "Enter" && target.id === "card-dialog-note") board.addNote();
        if (event.key === "Enter" && target.id === "board-filter") board.applyFilter();
        return;
      }
      if (event.key === "n") {
        event.preventDefault();
        board.focusComposer();
      } else if (event.key === "/") {
        event.preventDefault();
        board.focusFilter();
      } else if (event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "k") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "t") {
        event.preventDefault();
        board.showView(board.viewName() === "team" ? "board" : "team");
      }
    });
  };
})();`;
