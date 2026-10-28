/**
 * The board page's keyboard: one table, and the two halves that read it.
 *
 * The sheet the user opens with `?` is server-rendered from {@link BOARD_KEYS}, and
 * the bindings that make those keys work are {@link BOARD_KEYS_JS}, so the key a row
 * advertises and the key the client listens for sit in one file — the drift this
 * module exists to prevent, since no type checker sees the bundle.
 *
 * The vocabulary is the TUI's where it means the same thing (`j`/`k`, `?`, `Esc`);
 * `/` and `t` are this page's own. There is no key that changes a card: the page reads.
 */

import type { KeyHint } from "../../../lib/web/index.ts";

/** One binding: the key or keys, and what pressing it does. */
export const BOARD_KEYS: readonly KeyHint[] = [
	{ keys: "/", label: "Filter the cards" },
	{ keys: ["j", "k"], label: "Next or previous card, or the next card in an open dialog" },
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

  /** The render bundle's runtime: one typing test for the whole page. */
  var typing = board.typing;

  /** The card nodes in reading order, so j/k walk the board as it is drawn. */
  function cards() {
    return board.drawnCards();
  }

  /** Move the open dialog to the next or previous card; false when no dialog is open. */
  function walk(delta) {
    if (!board.dialogOpen || !board.dialogOpen()) return false;
    var drawn = cards();
    if (drawn.length === 0) return true;
    // The open card is the one marked open, not the focused node: focus sits on the
    // dialog's own panel, which is not one of the cards.
    var at = -1;
    for (var i = 0; i < drawn.length; i++) {
      if (drawn[i].getAttribute("data-card") === String(board.openId)) at = i;
    }
    var next = at < 0 ? (delta > 0 ? 0 : drawn.length - 1) : (at + delta + drawn.length) % drawn.length;
    board.openCard(drawn[next].getAttribute("data-card"));
    return true;
  }

  /** Move focus to the next or previous drawn card, and say so for a screen reader. */
  function step(delta) {
    // An open dialog walks instead of moving focus: the record stays whole, and Esc
    // still returns to the board where it was.
    if (walk(delta)) return;
    var drawn = cards();
    if (drawn.length === 0) return;
    // Focus sits on a card's title button, not on the card, so the step reads the card that
    // holds it: an index of -1 for every card made j from one land on the first card in the
    // lane instead of the next — which is the place a reader lost when they came back.
    var here = document.activeElement;
    var card = here && here.closest ? here.closest(".board-card") : null;
    var at = card === null ? -1 : drawn.indexOf(card);
    var next = at < 0 ? (delta > 0 ? 0 : drawn.length - 1) : (at + delta + drawn.length) % drawn.length;
    var button = drawn[next].querySelector(".board-card__title");
    if (button) button.focus();
  }

  board.bindKeys = function (doc) {
    doc.addEventListener("keydown", function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      var target = event.target;
      // A dialog is modal for the pointer and for the keyboard alike: "/", "t", and "?"
      // reach the page behind the scrim from nowhere else, so a modal keeps them and the
      // keys that move inside it -- j, k, Enter, Esc -- are the ones still read.
      var modal = (board.dialogOpen && board.dialogOpen()) || (board.keysOpen && board.keysOpen());
      if (event.key === "?" && !typing(target) && !modal) {
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
        // What is left for Escape is the filter: a field with text loses it, and the field
        // itself then gives the keyboard back to the page. The keys sheet and the card
        // dialog are above this, in the order a reader is likely to be inside them.
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
        if (event.key === "Enter" && target.id === "board-filter") board.applyFilter();
        return;
      }
      if (event.key === "/") {
        if (modal) return;
        event.preventDefault();
        board.focusFilter();
      } else if (event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "k") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "t") {
        if (modal) return;
        event.preventDefault();
        board.showView(board.viewName() === "team" ? "board" : "team");
      }
    });
  };
})();`;
