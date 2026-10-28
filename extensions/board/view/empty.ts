/**
 * The board's two empty states: no cards at all, and a filter that matches none.
 *
 * Both reuse the one block the document already carries (`#board-no-cards`), because the
 * difference between them is a sentence and one button, not a second layout. They live in
 * their own fragment so the renderer stays the painter of cards and lanes: an empty board is
 * a statement about the whole board, and it is the one part of the page that says a thing
 * instead of drawing one.
 *
 * Same rule as the rest of the client: every value arrives as `textContent`, and the query
 * the reader typed is one of them.
 */

export const BOARD_EMPTY_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /**
   * What the board says when there is nothing to read.
   *
   * Two different emptinesses. No cards at all is the board's own state, and it teaches the
   * verb that fills it. A filter that matches none of them is the reader's own query: the
   * lanes go, because five trays saying "no match" read as a board with no work, and the way
   * back is one button rather than a key a reader has to remember.
   */
  board.renderEmpty = function (view, query, shownTotal) {
    var block = document.getElementById("board-no-cards");
    if (!block) return;
    var lanes = document.getElementById("board-lanes");
    var noCards = view.total === 0;
    var noMatch = !noCards && query !== "" && shownTotal === 0;
    block.hidden = !noCards && !noMatch;
    if (lanes) lanes.hidden = noCards || noMatch;
    var title = document.getElementById("board-no-cards-title");
    var sub = document.getElementById("board-no-cards-sub");
    var hint = document.getElementById("board-no-cards-hint");
    var clear = document.getElementById("board-no-match-clear");
    if (title) title.textContent = noMatch ? "No card matches \u201c" + query + "\u201d" : "No cards yet";
    if (sub) {
      sub.textContent = noMatch
        ? "The filter reads a title, its owner, a path, a plan, and the notes."
        : "One card per feature: what it delivers, who holds it, and where to start.";
    }
    if (hint) hint.hidden = noMatch;
    if (clear) clear.hidden = !noMatch;
  };
})();`;
