/**
 * One card's face: the title, the facts a reader acts on, and the three marks that say
 * where they have been, where they are, and what a peer just moved.
 *
 * It is a fragment of the client bundle like `team.ts` and `dialog.ts`, and it reads the
 * helpers the renderer publishes — the element builder, the chip, the age, the count's
 * wording, and the reason rule spliced in from `lib/board/reason.ts` — so no rule about a
 * card is stated twice.
 *
 * Two of the face's facts are longer than it can draw: the title in its two-line clamp and
 * the hints past its third path. Each is on a hover title for the pointer, and each is named
 * by the title button's `aria-describedby` for the keyboard, because `j`/`k` walks cards by
 * focusing that button and never hovers anything.
 *
 * The reason sentence is not drawn at all: the face is an index of the work, one height on
 * every row, and the reason — what the card waits for and what it holds up — stays in the
 * document as the hover and as the same description, which is where the keyboard and a
 * screen reader read it. The dialog prints it in full.
 *
 * Every value arrives as `textContent`, never as markup: a title is model-written and a
 * note is anything a person typed.
 */

export const BOARD_CARD_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var kindLabel = board.kindLabel;
  var ago = board.ago;
  var plural = board.plural;
  var reasonFor = board.reasonFor;
  var reasonTone = board.reasonTone;

  /** Path chips a lane card shows before it counts the rest. */
  var PATH_CHIPS = 3;
  /**
   * The class each priority wears.
   *
   * Both levels are named here rather than one class with a modifier decided at the call
   * site, because this table is what the class contract compares with the stylesheet: a
   * level with no rule, or a rule with no level, fails there instead of in a screenshot.
   * The dialog's head wears the same word, so the table is published rather than restated:
   * a level added here reaches the face and the record beside it.
   */
  var PRIORITY_CLASS = { high: N.rowPriorityHigh, low: N.rowPriorityLow };

  /** "3h", "just now" — the age a stamp is drawn with, read against the reader's clock. */
  function sentence(wording, age) {
    return wording.replace("{age}", age === "now" ? "just now" : age + " ago");
  }

  /**
   * An age the ticker can keep honest: the stamp it was painted from, and the sentence
   * saying which fact it is, which the ticker fills from the same stamp a second later.
   *
   * The wording is the stamp's rather than the ticker's because a card now carries two
   * ages — when it was written to, and when its last note was filed — and a ticker that
   * assumed "updated" would relabel one of them within a minute.
   */
  function stamp(at, wording) {
    var node = el("span", "", ago(at));
    node.setAttribute("data-at", String(at));
    node.setAttribute("data-at-title", wording);
    node.title = sentence(wording, ago(at));
    return node;
  }

  /**
   * A reason sentence as a node: a stamp when it carries an age, plain text when it does not.
   *
   * One body for the three surfaces that print it — the card face, the dialog, and the lead's
   * queue — because the age is the one part of a sentence that moves without a frame, and a
   * second copy is a second place to forget the stamp.
   */
  function reasonNode(reason) {
    if (reason === undefined) return undefined;
    if (reason.at === undefined) return document.createTextNode(reason.text);
    // A sentence stamp, not an age stamp: the meta line prints the age alone, and this prints the
    // whole sentence with the age inside it, so the ticker has to know which it is.
    var node = el("span", "", sentence(reason.wording, ago(reason.at)));
    node.setAttribute("data-at", String(reason.at));
    node.setAttribute("data-at-title", reason.wording);
    node.setAttribute("data-at-sentence", "1");
    node.title = sentence(reason.wording, ago(reason.at));
    return node;
  }

  board.reasonNode = reasonNode;

  /** The one line under a card's meta: why it sits where it does. */
  function reasonOf(card) {
    // An order is the strongest reason a card is not being worked on, and the one a
    // reader cannot see from the lane. The sentence is the snapshot's, so this line and
    // the tool's refusal name one list.
    if (card.waits !== undefined) return { text: "waits on " + card.waits, kind: "waiting" };
    return reasonFor(card, ago);
  }

  /**
   * A path hint, or the +N chip that points at the rest.
   *
   * The hints past the third are the ones a reader needs before opening anything, so they
   * are not dropped: the chip carries them on its hover one per line, and the list holds
   * them again as text a screen reader reads, which is the whole of what the chip counts.
   */
  function paths(card, limit) {
    var list = el("ul", N.rowPaths);
    list.id = "card-paths-" + card.id;
    var shown = card.paths.slice(0, limit);
    for (var i = 0; i < shown.length; i++) {
      var item = el("li", "");
      var hint = chip(shown[i]);
      // A path longer than the card elides, and the whole of it is on the hover title: the
      // card is often the only place its hints are read before opening the record.
      hint.title = shown[i];
      item.appendChild(hint);
      list.appendChild(item);
    }
    if (card.paths.length > limit) {
      var beyond = card.paths.slice(limit);
      // The marker trails the row: with the hints before it on the line, it sits at the end of
      // what they left, and it is not a chip a wrap can leave alone on a line of its own.
      var rest = el("li", N.rowMore);
      var more = chip("+" + beyond.length);
      more.title = beyond.join("\n");
      // The count is a shape, not a word: what it counts is in the list below it, and a
      // reader is owed the hints rather than "+3".
      more.setAttribute("aria-hidden", "true");
      rest.appendChild(more);
      list.appendChild(rest);
      for (var j = 0; j < beyond.length; j++) list.appendChild(el("li", "sr-only", beyond[j]));
    }
    return list;
  }

  /** Whether the reader is dragging a selection, which a click at the end of it would clear. */
  function textSelected() {
    var selection = window.getSelection ? window.getSelection() : null;
    return selection !== null && String(selection) !== "";
  }

  /** One card in its lane. */
  function cardNode(card) {
    var item = el("li", "bf-row " + N.row);
    item.setAttribute("data-card", card.id);
    item.setAttribute("data-lane", card.lane);
    item.setAttribute("data-rev", String(card.rev));
    // A note draws no mark of its own: the column says the lane, the paper says it again, and
    // the glyph a row used to lead with was a third copy of the same fact. The Team tab's rows
    // keep theirs, where a tone is the only thing that ranks one against another.
    var body = el("div", N.rowBody);
    item.appendChild(body);

    /** The face's clipped text, by id: what the title button describes. */
    var described = [];

    // What the note is, before what it says: its number, what kind of work it is (with its
    // breaking marker inside the same label), and the order it is in. A card that recorded
    // neither kind nor order draws only its number, because the face says what the record says
    // and never a guess. This is the line a reader sorts a lane by, so it is the first one.
    var top = el("p", N.rowTop);
    top.appendChild(el("span", "bf-row__id", "#" + card.id));
    var kind = kindLabel(card);
    if (kind !== undefined) top.appendChild(kind);
    if (card.priority !== "normal") {
      top.appendChild(el("span", N.rowPriority + " " + PRIORITY_CLASS[card.priority], card.priority));
    }
    body.appendChild(top);

    var head = el("p", N.rowHead);
    // The title is the page's only focusable thing inside a card, so Enter and the focus
    // ring have one home; the card around it is the larger target for a pointer. A native
    // button's Enter and Space arrive as a click that bubbles to the card, so the card is
    // the one handler and the button needs none.
    var title = el("button", "bf-row__title", card.title);
    title.type = "button";
    // The id outlives the node: a frame rebuilds a lane when any face in it moves, and a dialog
    // opened from this button is restored to the card by looking the id up again.
    title.id = "card-title-" + card.id;
    head.appendChild(title);
    body.appendChild(head);
    item.addEventListener("click", function () {
      // A drag that ends on a card is a reader selecting a title to copy, not opening it.
      if (textSelected()) return;
      board.openCard(card.id);
    });

    var meta = el("p", "bf-row__meta");
    // The note's last line: whose it is at one end, and when it was last written with the history
    // beside it at the other. The holder is a name and not a chip — a chip with a leading bar is
    // the shape a path wears, and who holds a card is not where the work is.
    var owner = el("span", N.rowOwner, card.owner === undefined ? "unassigned" : card.owner.label);
    meta.appendChild(owner);
    // The stamp, so the clock can keep the age honest between frames: a board can be
    // quiet for ten minutes while the page still says "live".
    meta.appendChild(stamp(card.updatedAt, "updated {age}"));
    // A card with ten notes and a card with none drew the same face, and the notes are the
    // card's history: the count says how much is there. The last note's own age earns a place
    // only when it reads differently from the stamp beside it — a note is itself a write, so
    // usually the two are one moment and the meta line printed the same bare number twice.
    if (card.notes.length > 0) {
      var last = card.notes[card.notes.length - 1];
      var notes = el("span", N.rowNotes, plural(card.notes.length, "note"));
      if (ago(last.at) !== ago(card.updatedAt)) {
        notes.appendChild(document.createTextNode(" \u00b7 "));
        notes.appendChild(stamp(last.at, "last note {age} by " + last.by));
      }
      meta.appendChild(notes);
    }
    // The hints sit above the footer: the paths are what the work touches, and the footer is
    // whose it is and when. A note reads top-down — what it is, what it says, where it is,
    // whose it is — in the order a reader reaches for those facts.
    if (card.paths.length > 0) {
      body.appendChild(paths(card, PATH_CHIPS));
      // Only a truncated list is described: the hints a reader can already see are read in
      // order with the card, and the ones behind the chip have nowhere else to be read.
      if (card.paths.length > PATH_CHIPS) described.push("card-paths-" + card.id);
    }
    body.appendChild(meta);

    // One row for the card's links: why it is not moving, and what leaving it undone holds
    // up. The other side of a link used to be a second clamped paragraph, so a card three
    // others waited on spent two rows saying one fact from each end.
    var reason = reasonOf(card);
    var holds = card.dependents === undefined ? undefined : "holds up " + card.dependents;
    var why = reason === undefined ? holds : holds === undefined ? reason.text : reason.text + " \u00b7 " + holds;
    if (why !== undefined) {
      // The tone is a lookup, not a suffix: a name assembled from a prefix is a name no
      // test can compare with the stylesheet. A card that only holds others up is drawn in
      // the tone a waiting card wears, because it is the same edge read the other way.
      var line = el("p", "bf-row__reason", "");
      line.setAttribute("data-tone", reasonTone(reason === undefined ? "waiting" : reason.kind));
      // The sentence is a node, not a string: one that carries an age is stamped so the ticker
      // moves it with the lane age beside it.
      var sentenceNode = reasonNode(reason);
      if (sentenceNode !== undefined) line.appendChild(sentenceNode);
      if (holds !== undefined) line.appendChild(document.createTextNode(sentenceNode === undefined ? holds : " \u00b7 " + holds));
      line.id = "card-reason-" + card.id;
      // The face does not draw it; the stylesheet keeps it in the document and off the card,
      // so the whole sentence is the card's hover and the title button's description above.
      line.title = why;
      body.appendChild(line);
      described.push(line.id);
    }

    // The reason and the hints are drawn below the title, and a keyboard reader never
    // hovers: describing the button with them is what makes a clamped line readable from
    // j/k and from a screen reader alike.
    if (described.length > 0) title.setAttribute("aria-describedby", described.join(" "));

    return item;
  }

  board.cardNode = cardNode;
  board.sentence = sentence;
  // The one builder a surface uses when a fact carries an age: the dialog's rows read it too, so
  // a record's clock is the ticker's business and not a second one of its own.
  board.stamp = stamp;
  board.priorityClass = PRIORITY_CLASS;

  /** Set a mark on a card, or drop it, so one that lost it does not keep it. */
  function marked(node, name, on) {
    if (on) node.setAttribute(name, "true");
    else node.removeAttribute(name);
  }

  /**
   * Give a clamped title the hover the rest of the face has.
   *
   * The title is the one field with nowhere else to be read: the reason, the hints and the
   * plus-N chip each carry their whole sentence on a hover and describe the title button with
   * it, and a two-line clamp with no title left a long name readable only by opening the
   * card. A card in a folded lane or on the other tab measures as nothing, so it keeps
   * what it had and the next pass tries again once a reader can see it.
   */
  function fitTitle(card) {
    var node = card.querySelector(".bf-row__title");
    if (!node || !node.getClientRects || node.getClientRects().length === 0) return;
    if (node.scrollHeight > node.clientHeight + 1) node.title = node.textContent;
    else node.removeAttribute("title");
  }

  /**
   * Paint the card the reader is on, the cards they have already read, the cards a peer just
   * moved, and the hover a clamped title needs.
   *
   * j/k walks the drawn cards and wraps, so walking a lane and coming back looked
   * exactly like arriving for the first time. The two ids are the client's own — never
   * sent anywhere — and this runs after every frame as well as on a focus and an open,
   * because a lane is rebuilt whole when its cards move. The change mark is the one of the
   * three the client does not keep: it is the frame's answer, cleared on its own timer.
   */
  board.markCards = function () {
    var nodes = document.querySelectorAll(".board-row");
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute("data-card");
      marked(nodes[i], "data-current", board.current !== undefined && String(board.current) === id);
      marked(nodes[i], "data-visited", board.visited !== undefined && board.visited[id] === true);
      marked(nodes[i], "data-changed", board.changed !== undefined && board.changed[id] === true);
      fitTitle(nodes[i]);
    }
  };
})();`;
