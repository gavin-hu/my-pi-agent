/**
 * The Active work column: the seat's own queue, over the four lanes that hold open cards.
 *
 * Agents say *who*, Activity says *what arrived*; neither says what is waiting on the seat and
 * what is moving. So the middle column is the board's working half: the moves only the seat can
 * finish — sign a contract nobody has read, send a notice that never landed, free a card whose
 * owner is gone, chase one nobody has written to — above the `blocked`, `execute`, `plan` and
 * `backlog` swimlanes. `done` stays on the Board tab.
 *
 * Membership is a capability rule, not a grouping: a row is here because nobody else can finish
 * that move. A card that owes somebody else's work is the lanes' business — a missing contract is
 * on the plan card's own reason line, `waits on #X` on the backlog card's, "nobody holds it" on
 * the lane's count — so the queue never restates another person's obligation, and a tally of 14
 * asks can no longer sit over a board where the seat owes nothing. The four kinds that remain, in
 * `DECISION_KINDS`' rank order, are `gone`, `untold`, `approval` and `unwritten`; the bands they
 * used to be filed under are gone with `DECISION_BAND`.
 *
 * Every ask is two lines: the id and the title it changes, then the facts it is read for — the
 * pill it wears, the kind, the sentence the queue exists for (printed rather than hovered, and
 * carried by `aria-describedby` for a reader who never hovers), who holds it with their state's
 * dot, and one age. The list shows five rows and counts the rest behind one fold.
 *
 * A mission card under the queue is the board's own card, unchanged: a lane bar, a reference,
 * one line of title, and who holds it with their state's dot.
 *
 * The reasons themselves are not decided here: `board.reasonFor` is the one rule the page,
 * the card face and the terminal share, so a blocked card is described one way everywhere.
 */

export function activeJs(rules: { decisionLabels: string; sameLabel: string; labelKey: string }): string {
	return activeTemplate
		.replace("__DECISION_LABEL__", rules.decisionLabels)
		.replace("__SAME_LABEL__", rules.sameLabel)
		.replace("__LABEL_KEY__", rules.labelKey);
}

const activeTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chipNode = board.chipNode;
  var ago = board.ago;
  var plural = board.plural;
  var kindLabel = board.kindLabel;
  var decisionRank = board.decisionRank;
  var labelMap = board.labelMap;
  var decisionTone = board.decisionTone;

  var DECISION_LABEL = __DECISION_LABEL__;

__SAME_LABEL__

__LABEL_KEY__

  /** How many mission cards one swimlane prints before it counts the rest. */
  var SWIM = 4;
  /** Past this many cards a pool is one line and a door, not four arbitrary cards. */
  var POOL = 12;
  /**
   * The lanes the middle column carries, in the order they are read: what is stuck, what is being
   * worked, what waits for a sign, then the pool nobody holds.
   */
  var LANES = ["blocked", "execute", "plan", "backlog"];

  /**
   * Which cards wait on the seat, and why — entries, not rows.
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
        } else if (decisionRank(kind) < decisionRank(seen.kind)) {
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
    // The four moves only the seat can finish, in DECISION_KINDS' rank order: the same table the
    // pill and the tone come from, so a row's place is its precedence and not the order these
    // calls happen to be written in. A card that owes somebody else's work is not here — its
    // face or its lane head already says so, and restating it made the queue a second view of the
    // board instead of the seat's own list.
    //
    // A dead owner is a fact, not an inference from silence: the card is anyone's now.
    var gone = goneLabels(view);
    add(
      round.owners.reduce(function (cards, group) {
        return gone[labelKey(group.label)] === undefined ? cards : cards.concat(group.cards);
      }, []),
      function (card) { return (card.owner ? card.owner.label : "its owner") + " is not running \u2014 the card is free"; },
      "gone"
    );
    // The notice is on the card and never landed: a sign or a handoff, and the page sees a card
    // without the field that tells them apart, so the sentence names both remedies.
    add(round.untold, function () { return "its notice was never announced \u2014 sign or assign again to send it"; }, "untold");
    // A complete contract nobody has read is the seat's decision, and the one the flow stops on.
    add(round.unapproved, function (card) { return why(card, "contract ready \u2014 needs approval"); }, "approval");
    // The one ask that is a judgement rather than a record, and the one whose subject is an age,
    // so it carries one: the row prints it rather than stamping the card's write twice. A holder
    // inside a turn is being worked with, not stalled — silence alone is not enough while the bus
    // can say otherwise.
    add(
      round.unwritten.filter(function (card) { return !holderBusy(view, card); }),
      function (card) {
        return { text: "last write " + ago(card.updatedAt), at: card.updatedAt, wording: "last write {age}" };
      },
      "unwritten"
    );
    return entries;
  }

  board.decisionsOf = decisionsOf;

  /** The labels of the sessions whose process is gone, in the roster's own spelling. */
  function goneLabels(view) {
    var roster = view.teammates;
    var gone = labelMap();
    if (roster === undefined) return gone;
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].state === "gone") gone[labelKey(roster[i].label)] = roster[i].label;
    }
    return gone;
  }

  /** The reason as a pill: the word a reader scans by, and the sentence it stands for on the hover. */
  function whyPill(entry) {
    var tone = decisionTone(entry.kind);
    var pill = chipNode({ label: DECISION_LABEL[entry.kind] || entry.kind, tone: tone === "dim" ? "dim" : tone });
    pill.title = entry.why;
    return pill;
  }

  /**
   * Who holds a card: the state dot, the name, and the state said in words.
   *
   * One shape for both rows in this column. A chip in the queue and a dot on the swimlane card
   * was the last two-treatments-for-one-fact in a column that is read for who is on what: the
   * dot is the quieter of the two, and it says how the
   * owner is doing rather than only who it is. The word says it too — from the roster's own table,
   * the one the Agents column prints — because a hue alone is a fact a colour-blind reader cannot
   * read and a screen reader never hears. The dot keeps only the colour: the word is the state, and
   * the dot agrees with it.
   */
  function ownerMeta(view, label) {
    var wrap = el("span", N.owner);
    var state = ownerState(view, label);
    var said = label + ", " + (board.stateWord[state] || state);
    wrap.setAttribute("title", said);
    wrap.setAttribute("aria-label", said);
    var dot = el("span", N.dot);
    dot.setAttribute("aria-hidden", "true");
    dot.setAttribute("data-state", state);
    wrap.appendChild(dot);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  /** The list's own key in board.collapsed, and the id its fold opens: one list, one of each. */
  var ASKS = "needs-you";
  var ASKS_ID = "team-asks";

  /**
   * Whether the list starts folded.
   *
   * Once, like a lane: board.collapsed remembers the reader's answer through every frame a
   * peer's write causes, and the count in the column's head is what says the rest exists. A list
   * at or under the limit is drawn whole and has no control at all. The key cannot be a lane's:
   * the page's folds share one map and a lane's key is its own name.
   */
  function foldedOf(count) {
    if (count <= board.foldAt.queue) return false;
    board.collapsed = board.collapsed || {};
    if (board.collapsed[ASKS] === undefined) board.collapsed[ASKS] = true;
    return board.collapsed[ASKS] === true;
  }

  /**
   * One ask: a title line and a facts line.
   *
   * The title is the row's one control, as it is on the board's own face, so j/k and the
   * dialog's walk find this row without knowing it exists — and it is the whole of the first
   * line, because the six-column row spent 330 px of a 704 px row before the title could have a
   * pixel and elided every one of them. The facts the row is read for — the pill it wears, the
   * kind it changes, the sentence it is here for, who holds it and one age — sit under it, where
   * the reason already ran.
   *
   * The reason is printed rather than hidden in a tooltip: it is the sentence the queue exists
   * for, and every row says its own — the band's head names the move, never the sentence.
   */
  function decisionRow(entry, view) {
    var card = entry.card;
    var row = el("li", N.queueRow);
    // The tone is the pill's and a danger row's sentence — two statements, neither of them the
    // ground, so an ask needs no paper and no glyph of its own.
    row.setAttribute("data-tone", decisionTone(entry.kind));
    // No data-card: an ask row is a line about a card, and the id belongs to the card the lanes
    // draw. What ties the row to its card is the description below, team-why-<id>.
    var head = el("div", N.queueHead);
    var ref = el("span", N.queueRef);
    ref.appendChild(document.createTextNode("#" + card.id));
    head.appendChild(ref);
    var title = el("button", "bf-row__title", card.title);
    title.type = "button";
    title.setAttribute("aria-haspopup", "dialog");
    title.title = card.title;
    title.addEventListener("click", function () { board.openCard(card.id); });
    head.appendChild(title);
    row.appendChild(head);
    var facts = el("div", N.queueFacts);
    var labels = el("div", N.queueLabels);
    labels.appendChild(whyPill(entry));
    // What the card is, in the label the face and the record wear: it leaves the title's line,
    // where it cost the room an 80-character title needs, and a breaking change keeps the word a
    // decision must not hide.
    var kind = kindLabel(card);
    if (kind !== undefined) labels.appendChild(kind);
    facts.appendChild(labels);
    // The row's own sentence, always: the head names the move, the row says why it is here, and
    // the title is described by the line under it.
    var meta = el("p", N.queueWhy);
    if (entry.at === undefined) {
      meta.appendChild(document.createTextNode(entry.why));
    } else {
      meta.appendChild(board.reasonNode({ text: entry.why, at: entry.at, wording: entry.wording }));
    }
    meta.id = "team-why-" + card.id;
    // The whole sentence on the hover: the line is clamped to two, and nothing is lost with the
    // words the box hides.
    meta.title = entry.why;
    title.setAttribute("aria-describedby", meta.id);
    facts.appendChild(meta);
    facts.appendChild(card.owner ? ownerMeta(view, card.owner.label) : el("span", N.owner));
    // An ask whose sentence carries the age keeps no stamp: one age, printed once. The sentence
    // is the row's own fact, and a stamp beside it printed the same minutes twice.
    if (entry.kind !== "unwritten") facts.appendChild(board.stamp(card.updatedAt, undefined, true));
    row.appendChild(facts);
    return row;
  }

  /**
   * The asks: one list, under the column's one head.
   *
   * The list is homogeneous by construction — every row is a move the seat can finish — so it
   * needs no head of its own: the column's caption counts it, and the pill says which move. A list
   * past the limit folds and says how many are behind the control, and the fold is a fact the
   * frame prints: the signature is what says the pane must be rebuilt, and a fold it did not know
   * about would open and close without a repaint.
   */
  function askList(entries, folded, view) {
    var section = el("div", N.queue);
    if (entries.length === 0) return section;
    var shown = folded ? entries.slice(0, board.foldAt.queue) : entries;
    var list = el("ol", N.laneList);
    list.id = ASKS_ID;
    for (var i = 0; i < shown.length; i++) list.appendChild(decisionRow(shown[i], view));
    section.appendChild(list);
    if (entries.length > board.foldAt.queue) {
      var more = el("button", N.fold, folded ? "Show " + (entries.length - shown.length) + " more" : "Show fewer");
      more.type = "button";
      more.setAttribute("data-fold", ASKS);
      // The pair a disclosure owes: it says whether the rows are open, and which list it opens.
      more.setAttribute("aria-expanded", String(!folded));
      more.setAttribute("aria-controls", ASKS_ID);
      more.addEventListener("click", function () { board.toggleFold(ASKS); });
      section.appendChild(more);
    }
    return section;
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
    var row = teammateOf(view, label);
    if (row !== undefined) return row.state;
    return view.teammates === undefined ? "unknown" : "absent";
  }

  /** The roster row for one label, or nothing: a name is case-insensitive when it is a send target. */
  function teammateOf(view, label) {
    var roster = view.teammates;
    if (roster === undefined) return undefined;
    for (var i = 0; i < roster.length; i++) {
      if (sameLabel(roster[i].label, label)) return roster[i];
    }
    return undefined;
  }

  /**
   * Whether the bus says a card's holder is inside a turn right now.
   *
   * The one ask that is a judgement rather than a record — a card nobody has written to — is only
   * as good as this: a holder mid-turn is probably editing, so silence alone would ask the seat to
   * chase a card somebody is working on. Without a roster the page cannot tell, and silence is all
   * it has.
   */
  function holderBusy(view, card) {
    var row = card.owner === undefined ? undefined : teammateOf(view, card.owner.label);
    return row !== undefined && row.working === true;
  }

  /**
   * One swimlane: the head, the cards that fit, and a fold that says how many did not.
   *
   * sayEmpty is whether this lane's sentence earns its line: an empty lane says why on a board
   * where no lane holds a card, and stays a head and a count otherwise, because four "nothing
   * here" lines are four lines of nothing.
   *
   * A pool past POOL prints one line rather than four cards: the lane's job is to say what it
   * holds, the Board tab is where a pool that size is read, and four arbitrary cards out of two
   * hundred would be noise dressed as information.
   */
  function swimlane(view, lane, cards, sayEmpty) {
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
      if (sayEmpty) section.appendChild(el("p", "bf-lane__empty", lane.empty));
      return section;
    }
    if (lane.key === "backlog" && cards.length > POOL) {
      var pool = el("button", N.fold, plural(cards.length, "card") + " in the pool \u2014 see them on the Board");
      pool.type = "button";
      pool.addEventListener("click", function () { board.showView("board"); });
      section.appendChild(pool);
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
   * The asks and the lanes are one signature: an ask's sentence can change because another card
   * moved (a holder went idle), and a lane's cards move on their own revisions — so both facts are
   * in it, and a frame that changed neither leaves the column, its one fold and the reader's place
   * in it alone.
   */
  board.activeColumn = function (view, decisions, query, filtering) {
    var keep = function (card) { return board.matches(card, query); };
    var shown = decisions.filter(function (entry) { return keep(entry.card); });
    // One list, so one fold: whether it is folded is a fact the frame prints, and a fold the
    // signature missed would open and close without a repaint.
    var folded = foldedOf(shown.length);
    var lanes = [];
    for (var i = 0; i < LANES.length; i++) {
      var lane = board.laneOf(view, LANES[i]);
      if (lane === undefined) continue;
      lanes.push({ key: lane.key, label: lane.label, empty: lane.empty, cards: lane.cards.filter(keep), all: lane.cards.length });
    }
    var sig = [query, String(shown.length), String(decisions.length), folded ? "folded" : "open"];
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
        // One head for the column: it counts the asks, and carries the filtered total when a
        // filter narrows them. The tab strip above the page is the way to the whole board, and a
        // second door in a heading was a control in a label.
        slot.appendChild(board.captionOf("Needs you", shown.length, "ask", decisions.length));
        var pane = el("section", "bf-section " + N.paneBody);
        pane.setAttribute("data-pane", "needs-you");
        var queue = askList(shown, folded, view);
        // The list is homogeneous, so an empty one is a sentence rather than a stack of 0-count
        // heads: it says why, and a filter says what it hid.
        if (shown.length === 0) {
          queue.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "nothing to sign"));
        }
        pane.appendChild(queue);
        slot.appendChild(pane);
        // One label for the board's half, counting what the lanes hold: the column has one head
        // for the asks, and the lanes say which of them is full.
        slot.appendChild(el("p", N.queueBoard, "The board \u00b7 " + active + " open"));
        var list = el("div", N.teamLanes);
        for (var p = 0; p < lanes.length; p++) list.appendChild(swimlane(view, lanes[p], lanes[p].cards, active === 0));
        slot.appendChild(list);
      }
    };
  };
})();`;
