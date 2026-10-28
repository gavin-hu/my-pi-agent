/**
 * One card's face: the title, the facts a reader acts on, and the two marks that say
 * where they have been.
 *
 * It is a fragment of the client bundle like `team.ts` and `dialog.ts`, and it reads the
 * helpers the renderer publishes — the element builder, the chip, the age, the count's
 * wording, and the reason rule spliced in from `lib/board/reason.ts` — so no rule about a
 * card is stated twice.
 *
 * Two of the face's facts are longer than it can draw: the hints past its third path, the
 * reason sentence, and the cards it is holding up. Each is on a hover title for the
 * pointer, and each is named by the title button's `aria-describedby` for the keyboard,
 * because `j`/`k` walks cards by focusing that button and never hovers anything.
 *
 * Every value arrives as `textContent`, never as markup: a title is model-written and a
 * note is anything a person typed.
 */

export const BOARD_CARD_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var reasonFor = board.reasonFor;

  /** Path chips a lane card shows before it counts the rest. */
  var PATH_CHIPS = 3;
  /** The two tones a reason line can take, by the kind the reason rule reports. */
  var REASON_TONE = {
    blocked: N.cardReasonBlocked,
    contract: N.cardReasonUnplanned,
    approval: N.cardReasonUnplanned,
    review: N.cardReasonUnplanned,
  };

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
    var list = el("ul", N.cardPaths);
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
      var rest = el("li", "");
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
    var item = el("li", N.card);
    item.setAttribute("data-card", card.id);
    item.setAttribute("data-lane", card.lane);
    item.setAttribute("data-rev", String(card.rev));

    var head = el("p", N.cardHead);
    head.appendChild(el("span", N.cardId, "#" + card.id));
    // The title is the page's only focusable thing inside a card, so Enter and the focus
    // ring have one home; the card around it is the larger target for a pointer. A native
    // button's Enter and Space arrive as a click that bubbles to the card, so the card is
    // the one handler and the button needs none.
    var title = el("button", N.cardTitle, card.title);
    title.type = "button";
    head.appendChild(title);
    item.appendChild(head);
    item.addEventListener("click", function () {
      // A drag that ends on a card is a reader selecting a title to copy, not opening it.
      if (textSelected()) return;
      board.openCard(card.id);
    });

    /** The face's clipped text, by id: what the title button describes. */
    var described = [];

    var meta = el("p", N.cardMeta);
    meta.appendChild(card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned"));
    // The order inside a lane is the priority, so an urgent card says so: an order
    // nobody can see reads as an accident. The lane's colour stays the card's own.
    if (card.priority !== "normal") meta.appendChild(chip(card.priority, "outline"));
    // The stamp, so the clock can keep the age honest between frames: a board can be
    // quiet for ten minutes while the page still says "live".
    meta.appendChild(stamp(card.updatedAt, "updated {age}"));
    // A card with ten notes and a card with none drew the same face, and the notes are the
    // card's history: the count says how much is there. The last note's own age earns a place
    // only when it reads differently from the stamp beside it — a note is itself a write, so
    // usually the two are one moment and the meta line printed the same bare number twice.
    if (card.notes.length > 0) {
      var last = card.notes[card.notes.length - 1];
      var notes = el("span", N.cardNotes, plural(card.notes.length, "note"));
      if (ago(last.at) !== ago(card.updatedAt)) {
        notes.appendChild(document.createTextNode(" \u00b7 "));
        notes.appendChild(stamp(last.at, "last note {age} by " + last.by));
      }
      meta.appendChild(notes);
    }
    item.appendChild(meta);

    if (card.paths.length > 0) {
      item.appendChild(paths(card, PATH_CHIPS));
      // Only a truncated list is described: the hints a reader can already see are read in
      // order with the card, and the ones behind the chip have nowhere else to be read.
      if (card.paths.length > PATH_CHIPS) described.push("card-paths-" + card.id);
    }

    var reason = reasonOf(card);
    if (reason) {
      // The tone is a lookup, not a suffix: a name assembled from a prefix is a name no
      // test can compare with the stylesheet.
      var tone = REASON_TONE[reason.kind];
      var line = el("p", tone === undefined ? N.cardReason : N.cardReason + " " + tone, reason.text);
      line.id = "card-reason-" + card.id;
      // It clamps on the card, so the full sentence is the tooltip.
      line.title = reason.text;
      item.appendChild(line);
      described.push(line.id);
    }

    // The other side of a link, on the face: what leaving this card undone holds up. It was
    // dialog-only, so a card three others were waiting on looked like any other card.
    if (card.dependents !== undefined) {
      var holds = el("p", N.cardHolds, "holds up " + card.dependents);
      holds.id = "card-holds-" + card.id;
      holds.title = "holds up " + card.dependents;
      item.appendChild(holds);
      described.push(holds.id);
    }

    // The reason and the hints are drawn below the title, and a keyboard reader never
    // hovers: describing the button with them is what makes a clamped line readable from
    // j/k and from a screen reader alike.
    if (described.length > 0) title.setAttribute("aria-describedby", described.join(" "));

    return item;
  }

  board.cardNode = cardNode;
  board.sentence = sentence;

  /** Set a mark on a card, or drop it, so one that lost it does not keep it. */
  function marked(node, name, on) {
    if (on) node.setAttribute(name, "true");
    else node.removeAttribute(name);
  }

  /**
   * Paint the card the reader is on and the cards they have already read.
   *
   * j/k walks the drawn cards and wraps, so walking a lane and coming back looked
   * exactly like arriving for the first time. The two ids are the client's own — never
   * sent anywhere — and this runs after every frame as well as on a focus and an open,
   * because a lane is rebuilt whole when its cards move.
   */
  board.markCards = function () {
    var nodes = document.querySelectorAll(".board-card");
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute("data-card");
      marked(nodes[i], "data-current", board.current !== undefined && String(board.current) === id);
      marked(nodes[i], "data-visited", board.visited !== undefined && board.visited[id] === true);
    }
  };
})();`;
