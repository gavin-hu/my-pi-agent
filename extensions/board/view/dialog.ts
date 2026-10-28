/**
 * The card dialog: one card, whole, as a read view.
 *
 * Opening, closing, and forgetting which card is open is the whole of it. The page
 * cannot change a card, so this module has no request, no confirmation, no banner and
 * no footer actions — the dialogs it used to fill are gone from the document, and the
 * only way a card changes is a tool.
 *
 * The one thing it must not do is leave a stale panel behind: a dialog the kit closed —
 * `Esc`, a backdrop click, its own close button — forgets `openId`, so the next frame
 * stops filling something nobody can see.
 */

export const BOARD_DIALOG_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

  /** Fill and open the card dialog. */
  board.openCard = function (id) {
    var view = board.view;
    if (!view) return;
    var card = board.findCard(view, id);
    if (!card || !window.bfCard) return;
    board.openId = id;
    // A card a reader opened is one they have read, and it is where they are: the board
    // paints both marks from these two fields, so closing the record leaves the place.
    board.visited[id] = true;
    board.current = id;
    board.fillDialog(card, view);
    board.markCards();
    window.bfCard.open();
  };

  board.closeCard = function () {
    if (window.bfCard) window.bfCard.close();
  };

  board.dialogOpen = function () {
    return window.bfCard ? window.bfCard.isOpen() : false;
  };

  var cardDialog = document.getElementById("board-card-dialog");
  if (cardDialog) {
    new MutationObserver(function () {
      if (cardDialog.hidden) board.openId = undefined;
    }).observe(cardDialog, { attributes: true, attributeFilter: ["hidden"] });
  }
})();`;
