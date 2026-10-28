/**
 * The card dialog: one card, whole, as a read view.
 *
 * Filling it, opening it, and forgetting which card is open is the whole of it. `render.ts`
 * paints the board and hands each frame to {@link syncDialog}, which keeps an open record
 * current and closes it when its card has left the board. The page cannot change a card, so
 * this module has no request, no confirmation, no banner and no footer actions — the dialogs
 * it used to fill are gone from the document, and the only way a card changes is a tool.
 *
 * A note is the one field that is not a `textContent` write: its prose is Markdown, read by
 * the kit's one inline renderer (`lib/web/markdown.ts`, spliced into the bundle as
 * `INLINE_MARKDOWN_JS`), which appends text nodes and the four inline atoms and never parses
 * markup. Everything else here is set as text, like the rest of the page.
 *
 * The one thing it must not do is leave a stale panel behind: a dialog the kit closed —
 * `Esc`, a backdrop click, its own close button — forgets `openId`, so the next frame
 * stops filling something nobody can see.
 */

export const BOARD_DIALOG_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;

  /** Fill the dialog's contents from a card, without opening or closing it. */
  function fillDialog(card, view) {
    document.getElementById("card-dialog-title").textContent = card.title;
    document.getElementById("card-dialog-id").textContent = "#" + card.id;
    // The lane is a status of its own, not a word inside a sentence: the same dot and
    // label a lane head wears, so the dialog and the board speak the same vocabulary.
    var state = document.getElementById("card-dialog-state");
    var lane = board.laneOf(view, card.lane);
    state.setAttribute("data-lane", card.lane);
    state.textContent = lane === undefined ? card.lane : lane.label;

    // One fact per row of the ladder, so a reader can pick out a value instead of
    // hunting for it in a sentence. A row with nothing to say takes its label with it:
    // an empty cell under a heading reads as a missing value, not as an absence.
    var pair = function (name, shown) {
      var dt = document.getElementById("card-dialog-" + name + "-label");
      var dd = document.getElementById("card-dialog-" + name);
      if (dt) dt.hidden = !shown;
      if (dd) dd.hidden = !shown;
      return dd;
    };
    var setRow = function (name, shown, value, full) {
      var dd = pair(name, shown);
      dd.textContent = shown ? value : "";
      if (full === undefined) dd.removeAttribute("title");
      else dd.setAttribute("title", full);
    };

    var owner = document.getElementById("card-dialog-owner");
    owner.textContent = "";
    owner.appendChild(card.owner ? chip(card.owner.label, "accent") : document.createTextNode("unassigned"));
    pair("owner", true);

    var priority = pair("priority", card.priority !== "normal");
    priority.textContent = "";
    if (card.priority !== "normal") priority.appendChild(chip(card.priority, "outline"));

    setRow("updated", true, ago(card.updatedAt));
    // How long the card has been in the lane it is in now, which updatedAt cannot say:
    // a note filed against a blocked card moves that stamp without moving the card. Absent
    // for a card written before the log existed, so the row takes its label with it.
    setRow("lane", card.since !== undefined, card.lane + " \u00b7 " + ago(card.since));
    setRow("by", true, card.by);
    setRow("landed", card.landed !== undefined, card.landed ? card.landed.commit : "", card.landed ? card.landed.commit : undefined);

    // The dialog and the card face say one thing, from one field: the ids it was linked
    // to are the storage, and a reader is owed the lanes that make them a decision.
    setRow("depends", card.waits !== undefined, card.waits || "", card.waits);
    // The other side of the same link: what leaving this card undone is holding up, which
    // is the one thing a card's own row cannot say.
    setRow("dependents", card.dependents !== undefined, card.dependents || "", card.dependents);

    // A long plan path elides on one line, and the whole of it is on the hover title and
    // in the text, so it stays copyable: the reason to open a card is often its plan.
    setRow("plan", Boolean(card.planPath), card.planPath || "", card.planPath || undefined);

    // The contract is three lines and a signature, and each is its own rung: a reader
    // comparing what was promised with what was done reads them one at a time, and the
    // approval's age is the fact that says whether anybody has looked.
    var contract = card.contract;
    setRow("goal", Boolean(contract), contract ? contract.goal : "", contract ? contract.goal : undefined);
    setRow("acceptance", Boolean(contract), contract ? contract.acceptance : "", contract ? contract.acceptance : undefined);
    setRow("scope-out", Boolean(contract), contract ? contract.scopeOut : "", contract ? contract.scopeOut : undefined);
    var approved = contract && contract.approved;
    setRow("approved", Boolean(approved), approved ? approved.by + " \u00b7 " + ago(approved.at) : "");
    setRow("reviewed", card.review !== undefined, card.review ? card.review.by + " \u00b7 " + ago(card.review.at) : "");

    pair("paths", card.paths.length > 0);
    var pathList = document.getElementById("card-dialog-path-list");
    pathList.textContent = "";
    for (var i = 0; i < card.paths.length; i++) {
      var item = el("li", "");
      var hint = chip(card.paths[i]);
      hint.className += " " + N.dialogPath;
      hint.title = card.paths[i];
      item.appendChild(hint);
      pathList.appendChild(item);
    }

    var notes = document.getElementById("card-dialog-notes");
    notes.textContent = "";
    for (var j = 0; j < card.notes.length; j++) {
      var note = card.notes[j];
      // The prose is the record and reads at body size; who wrote it and when is its
      // footnote, so it follows the sentence instead of standing over it.
      var row = el("li", N.dialogNote);
      // A note is Markdown, read by the kit's one inline renderer: a backtick, a bold word,
      // or an ordinary URL reads as what it says, a target the policy refuses stays text,
      // and nothing a person typed can become markup.
      var text = el("p", N.dialogNoteText);
      renderInline(text, note.text);
      row.appendChild(text);
      var foot = el("p", N.dialogNoteFoot);
      foot.appendChild(el("span", N.dialogNoteBy, note.by));
      foot.appendChild(el("span", N.dialogNoteAt, ago(note.at)));
      row.appendChild(foot);
      notes.appendChild(row);
    }
    var count = document.getElementById("card-dialog-note-count");
    if (count) count.textContent = card.notes.length === 0 ? " \u00b7 none" : " \u00b7 " + card.notes.length;
    var earlier = document.getElementById("card-dialog-earlier");
    earlier.hidden = card.notesDropped === 0;
    earlier.textContent = card.notesDropped === 0 ? "" : card.notesDropped + " earlier notes dropped";

    // A modal whose title changes is not announced, so walking with j/k says where it
    // landed: the position is counted over the cards as they are drawn, not as stored, so
    // a filter or a folded lane cannot make the number disagree with the screen.
    var where = document.getElementById("card-dialog-where");
    if (where) {
      var drawn = board.drawnCards();
      var at = 0;
      for (var k = 0; k < drawn.length; k++) {
        if (drawn[k].getAttribute("data-card") === String(card.id)) at = k + 1;
      }
      // Opened from the Team tab there is no drawn board to count along, so the line
      // names the card instead of claiming a position it cannot know.
      where.textContent = drawn.length === 0 ? card.title : "card " + at + " of " + drawn.length + ": " + card.title;
    }
  }

  /**
   * Keep an open record current: fill it from the frame, or close it when its card left.
   *
   * The frame owns this rather than the open handler: a peer's note moves the card's
   * revision, and a panel left showing the record it was opened with is a page that lies
   * for as long as the tab stays open.
   */
  board.syncDialog = function (view) {
    if (board.openId === undefined) return;
    var card = board.findCard(view, board.openId);
    if (card) fillDialog(card, view);
    else board.closeCard();
  };

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
    fillDialog(card, view);
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
