/**
 * The Active work column: the lead's queue in a strip, over the three lanes that move.
 *
 * Agents say *who*, Activity says *what arrived*; neither says what is moving and what is
 * stuck. So the middle column is the board's working half: the cards that need a decision as
 * a strip above the `blocked`, `execute` and `plan` swimlanes. Backlog and Done stay on the
 * Board tab, behind the column's door.
 *
 * Every row is a shape with its sentence one hover away:
 *
 * - **A decision** is an edge in its tone, an id in mono, an elided title, the reason as a
 *   pill, the owner, and one age. The whole reason — the sentence the queue exists for — is
 *   carried twice: as the row's `title`, and by `aria-describedby` for a reader who never
 *   hovers. Three rows, then `+N more`, because a queue that fills the column is the Board
 *   tab with extra steps.
 * - **A mission card** is a lane bar, a reference, one line of title, and who holds it with
 *   their state's dot.
 *
 * The reasons themselves are not decided here: `board.reasonFor` is the one rule the page,
 * the card face and the terminal share, so a blocked card is described one way everywhere.
 */

export function activeJs(rules: { decisionLabels: string }): string {
	return activeTemplate.replace("__DECISION_LABEL__", rules.decisionLabels);
}

const activeTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var stamp = board.stamp;
  var kindLabel = board.kindLabel;
  var rankOf = board.rankOf;
  var decisionTone = board.decisionTone;

  var DECISION_LABEL = __DECISION_LABEL__;

  /** How many decisions the strip prints before it counts the rest. */
  var STRIP = 3;
  /** How many mission cards one swimlane prints before it counts the rest. */
  var SWIM = 4;
  /** The lanes the middle column carries, in the order they are read. */
  var LANES = ["blocked", "execute", "plan"];

  /**
   * Which cards need the lead, and why — entries, not rows.
   *
   * The renderer filters this list, so it has to be the data: filtering the built rows would
   * test the element instead of the card.
   *
   * The round's groups overlap on purpose — an executing card untouched for half an hour is
   * both unwritten and unreviewed — so one card can arrive twice, and the strongest reason is
   * the one it keeps.
   */
  function decisionsOf(view) {
    var round = view.round;
    var byCard = {};
    var entries = [];
    function add(cards, why, kind) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var said = why(card);
        var entry = typeof said === "string"
          ? { card: card, why: said, kind: kind }
          : { card: card, why: said.text, at: said.at, wording: said.wording, kind: kind };
        var seen = byCard[card.id];
        if (seen === undefined) {
          byCard[card.id] = entry;
          entries.push(entry);
        } else if (rankOf(kind) < rankOf(seen.kind)) {
          seen.why = entry.why;
          seen.at = entry.at;
          seen.wording = entry.wording;
          seen.kind = entry.kind;
        }
      }
    }
    // The card's own sentence, from the one rule: the page's faces and the transcript read the
    // same body, so a block and a contract cannot be described two ways.
    function why(card, fallback) {
      var reason = board.reasonFor(card, ago);
      return reason === undefined ? fallback : reason;
    }
    add(round.blocked, function (card) { return why(card, "blocked"); }, "blocked");
    // A dead owner is a fact, not an inference from silence: the card is anyone's now.
    var gone = goneLabels(view);
    add(
      round.owners.reduce(function (cards, group) {
        return gone[group.label.toLowerCase()] === undefined ? cards : cards.concat(group.cards);
      }, []),
      function (card) { return (card.owner ? card.owner.label : "its owner") + " is not running \u2014 the card is free"; },
      "gone"
    );
    // A complete contract nobody has read is the lead's decision, and the one the flow stops on.
    add(round.unapproved, function (card) { return why(card, "contract ready \u2014 needs approval"); }, "approval");
    // The other gate is the lead's too, and it is owed from the moment a card enters the lane.
    add(round.unreviewed, function (card) { return why(card, "no spot-check yet"); }, "review");
    // The one sentence with an age that is not a stamp: it needs a bare age in the middle.
    add(round.unwritten, function (card) { return "no writes for " + ago(card.updatedAt); }, "unwritten");
    add(round.unplanned, function (card) { return why(card, "no contract yet"); }, "unplanned");
    add(round.unassigned, function () { return "nobody holds it"; }, "unassigned");
    // An order outranks nobody holding it: the claim would be refused, so the queue says what
    // it waits for instead of offering a card the rules would turn down.
    add(
      round.unassigned.filter(function (card) { return card.waits !== undefined; }),
      function (card) { return "waits on " + card.waits; },
      "waiting"
    );
    // An offer outranks plain silence: the lead has already tried to hand this card out, and
    // the age is the difference between nobody having looked and nobody taking it.
    add(
      round.unassigned.filter(function (card) { return card.offeredAt !== undefined; }),
      function (card) { return why(card, "offered \u2014 nobody took it"); },
      "waiting"
    );
    return entries;
  }

  board.decisionsOf = decisionsOf;

  /** A map keyed by a session label, which the page does not choose. */
  function labelMap() { return Object.create(null); }

  /** The labels of the sessions whose process is gone, in the roster's own spelling. */
  function goneLabels(view) {
    var roster = view.teammates;
    var gone = labelMap();
    if (roster === undefined) return gone;
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].state === "gone") gone[roster[i].label.toLowerCase()] = roster[i].label;
    }
    return gone;
  }

  /** The reason as a rail tag: the word a reader scans by, with the sentence on the hover. */
  function whyPill(entry) {
    var tone = decisionTone(entry.kind);
    var pill = chip(DECISION_LABEL[entry.kind] || entry.kind, tone === "dim" ? "dim" : tone);
    pill.title = entry.why;
    return pill;
  }

  /**
   * Who holds a card: a state dot and the name, never a pill.
   *
   * One shape for both cards in this column. A chip in the strip and a dot on the swimlane card
   * was the last two-treatments-for-one-fact in a column whose whole point is that a decision
   * and a mission are the same box: the dot is the quieter of the two, and it says how the
   * owner is doing rather than only who it is.
   */
  function ownerMeta(view, label) {
    var wrap = el("span", N.owner);
    var dot = el("span", N.dot);
    dot.setAttribute("aria-hidden", "true");
    dot.setAttribute("data-state", ownerState(view, label));
    wrap.appendChild(dot);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  /** One decision: the card, why it is here, who holds it, and how long it has waited. */
  function decisionRow(entry, view) {
    var card = entry.card;
    var tone = decisionTone(entry.kind);
    var node = el("article", "bf-row " + N.decision);
    node.setAttribute("data-tone", tone);
    node.setAttribute("data-card", card.id);
    // The paper is the tone now, so the glyph a decision used to lead with would say a third
    // time what the card's ground and its why word already say: the block is the mark.
    var body = el("div", N.decisionBody);
    node.appendChild(body);

    var open = el("button", N.decisionOpen);
    open.type = "button";
    open.setAttribute("aria-haspopup", "dialog");
    // The reason the row is here, for a reader who never hovers: the tag is inside the button,
    // so the whole row is described by the sentence its tooltip carries.
    open.setAttribute("aria-describedby", "team-why-" + card.id);
    open.appendChild(el("span", N.decisionRef, "#" + card.id));
    open.appendChild(whyPill(entry));
    var title = el("span", "bf-row__title", card.title);
    title.title = card.title;
    open.appendChild(title);
    open.addEventListener("click", function () { board.openCard(card.id); });
    body.appendChild(open);

    var meta = el("p", N.decisionWhy);
    // What the card is, in the label the face and the record wear: the queue is where a
    // decision is made, and a breaking change is the one fact it must not hide.
    var kind = kindLabel(card);
    if (kind !== undefined) meta.appendChild(kind);
    if (card.owner) meta.appendChild(ownerMeta(view, card.owner.label));
    // The sentence is the row's reason, so it is stamped rather than printed once: the age in
    // it is the one part that moves without a frame.
    var sentence = entry.at === undefined ? undefined : board.reasonNode({ text: entry.why, at: entry.at, wording: entry.wording });
    if (sentence !== undefined) meta.appendChild(sentence);
    else meta.appendChild(stamp(ago(card.updatedAt), card.updatedAt));
    meta.id = "team-why-" + card.id;
    body.appendChild(meta);
    return node;
  }

  /**
   * The strip past its third row: the same underlined control a swimlane folds with, opening
   * the same place.
   *
   * It used to be a paragraph saying where the rest was — one of three shapes for "there is
   * more" in a column that now has one.
   */
  function moreRow(count) {
    var row = el("button", N.fold, "+" + count + " more");
    row.type = "button";
    row.title = "every decision is on the Board tab";
    row.addEventListener("click", function () { board.showView("board"); });
    return row;
  }

  /**
   * One mission: the board's own card, unchanged.
   *
   * The middle column exists to preview the board, so it draws the board's card rather than a
   * second rendering of it — the same lane paper, the same four lines in the same order, the same
   * height. A card read here reads the same one tab over.
   */
  function missionCard(card) {
    return board.cardNode(card);
  }

  /** What the bus says about one owner, for the dot beside their name on a mission card. */
  function ownerState(view, label) {
    var roster = view.teammates;
    if (roster === undefined) return "unknown";
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].label.toLowerCase() === label.toLowerCase()) return roster[i].state;
    }
    return "absent";
  }

  /** One swimlane: the head, the rows that fit, and a fold that says how many did not. */
  function swimlane(view, lane, cards) {
    var section = el("section", "bf-lane " + N.laneList);
    section.setAttribute("data-lane", lane.key);
    var head = el("h3", "bf-lane__head");
    var dot = el("span", "bf-lane__dot");
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "\u25a0";
    head.appendChild(dot);
    head.appendChild(el("span", "", lane.label));
    head.appendChild(el("span", "bf-lane__count", String(cards.length)));
    head.setAttribute("aria-label", lane.label + ", " + plural(cards.length, "card"));
    section.appendChild(head);
    if (cards.length === 0) {
      section.appendChild(el("p", "bf-lane__empty", lane.empty));
      return section;
    }
    var swim = el("ol", N.laneList);
    for (var i = 0; i < cards.length && i < SWIM; i++) swim.appendChild(missionCard(cards[i], view));
    section.appendChild(swim);
    if (cards.length > SWIM) {
      var more = el("button", N.fold, "+" + (cards.length - SWIM) + " more on the Board");
      more.type = "button";
      more.addEventListener("click", function () { board.showView("board"); });
      section.appendChild(more);
    }
    return section;
  }

  /**
   * The column, as a signature and a builder.
   *
   * The strip and the lanes are one signature: a decision's sentence can change because another
   * card moved (a blocker finished), and a lane's cards move on their own revisions — so both
   * facts are in it, and a frame that changed neither leaves the column, its folds and the
   * reader's place in it alone.
   */
  board.activeColumn = function (view, decisions, query, filtering) {
    var keep = function (card) { return board.matches(card, query); };
    var shown = decisions.filter(function (entry) { return keep(entry.card); });
    var lanes = [];
    for (var i = 0; i < LANES.length; i++) {
      var lane = board.laneOf(view, LANES[i]);
      if (lane === undefined) continue;
      lanes.push({ key: lane.key, label: lane.label, empty: lane.empty, cards: lane.cards.filter(keep), all: lane.cards.length });
    }
    var sig = [query, String(shown.length), String(decisions.length)];
    for (var d = 0; d < shown.length; d++) {
      sig.push(shown[d].card.id + ":" + shown[d].card.rev + ":" + shown[d].kind + ":" + shown[d].why);
    }
    for (var l = 0; l < lanes.length; l++) {
      var ids = [lanes[l].key];
      for (var c = 0; c < lanes[l].cards.length; c++) ids.push(lanes[l].cards[c].id + ":" + lanes[l].cards[c].rev);
      sig.push(ids.join("+"));
    }
    var active = 0;
    for (var a = 0; a < lanes.length; a++) active += lanes[a].cards.length;

    return {
      sig: sig.join("|"),
      count: active,
      total: view.total,
      decisions: shown.length,
      build: function (slot) {
        // The caption is a count and nothing else: the tab strip above the page is the way to
        // the whole board, and a second door in a heading was a control in a label.
        slot.appendChild(board.captionOf("Active work", active, "card"));
        var pane = el("section", "bf-section " + N.paneBody);
        pane.setAttribute("data-pane", "needs-you");
        pane.setAttribute("data-tone", "warn");
        // The strip has a name and a number of its own: the caption above counts the lanes, and
        // a reader was left to add the rows under it to a number that did not include them.
        pane.appendChild(board.paneHead("Needs you", shown.length, decisions.length));
        var strip = el("div", N.decisions);
        var cap = Math.min(shown.length, STRIP);
        for (var s = 0; s < cap; s++) strip.appendChild(decisionRow(shown[s], view));
        if (shown.length > STRIP) strip.appendChild(moreRow(shown.length - STRIP));
        if (shown.length === 0) {
          strip.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "nothing needs you: no blockers, no contract waiting to be read, nothing unwritten"));
        }
        pane.appendChild(strip);
        slot.appendChild(pane);
        var list = el("div", N.teamLanes);
        for (var p = 0; p < lanes.length; p++) list.appendChild(swimlane(view, lanes[p], lanes[p].cards));
        slot.appendChild(list);
      }
    };
  };
})();`;
