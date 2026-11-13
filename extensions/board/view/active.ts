/**
 * The Active work column: the lead's queue, in three bands, over the three lanes that move.
 *
 * Agents say *who*, Activity says *what arrived*; neither says what is moving and what is
 * stuck. So the middle column is the board's working half: the asks a lead has to answer,
 * banded by whose move each one is, above the `blocked`, `execute` and `plan` swimlanes.
 * Backlog and Done stay on the Board tab, behind the column's door.
 *
 * The bands are the question a lead asks first — *whose move is this?* — which the kinds alone
 * could not answer: `unassigned` sat beside `needs approval` in one list, so a queue of backlog
 * cards read as the backlog. `DECISION_BAND` in `lib/board/tone.ts` is that filing, and it is
 * the same table the pill and the rank come from.
 *
 * Every ask is drawn, as one line and its reason: an id in mono, the pill it wears, an elided
 * title, who holds it with their state's dot, and one age — then the sentence the queue exists
 * for, printed rather than hovered and carried by `aria-describedby` for a reader who never
 * hovers. Nothing waits behind `+N more`: the pane's head counts what is drawn.
 *
 * A mission card under the queue is the board's own card, unchanged: a lane bar, a reference,
 * one line of title, and who holds it with their state's dot.
 *
 * The reasons themselves are not decided here: `board.reasonFor` is the one rule the page,
 * the card face and the terminal share, so a blocked card is described one way everywhere.
 */

export function activeJs(rules: { decisionLabels: string; decisionBands: string }): string {
	return activeTemplate
		.replace("__DECISION_LABEL__", rules.decisionLabels)
		.replace("__DECISION_BAND__", rules.decisionBands);
}

const activeTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var kindLabel = board.kindLabel;
  var decisionRank = board.decisionRank;
  var labelMap = board.labelMap;
  var decisionTone = board.decisionTone;

  var DECISION_LABEL = __DECISION_LABEL__;
  var BANDS = __DECISION_BAND__;

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
    // The one reason whose subject is an age, so it carries one: the row stamps it rather than
    // printing it once, which is the same rule an offered card's sentence follows.
    add(round.unwritten, function (card) {
      return { text: "no writes for " + ago(card.updatedAt), at: card.updatedAt, wording: "no writes for {age}" };
    }, "unwritten");
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

  /** The reason as a pill: the word a reader scans by, and the sentence it stands for on the hover. */
  function whyPill(entry) {
    var tone = decisionTone(entry.kind);
    var pill = chip(DECISION_LABEL[entry.kind] || entry.kind, tone === "dim" ? "dim" : tone);
    pill.title = entry.why;
    return pill;
  }

  /**
   * Who holds a card: a state dot and the name, never a pill.
   *
   * One shape for both rows in this column. A chip in the queue and a dot on the swimlane card
   * was the last two-treatments-for-one-fact in a column that is read for who is on what: the
   * dot is the quieter of the two, and it says how the
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

  /**
   * One ask: the id, the pill it wears, its title, who holds it, one age, and why it is here.
   *
   * The title is the row's one control, as it is on the board's own face, so j/k and the
   * dialog's walk find this row without knowing it exists. The reason is printed rather than
   * hidden in a tooltip: it is the sentence the queue exists for.
   */
  function decisionRow(entry, view, rank) {
    var card = entry.card;
    var row = el("li", N.queueRow);
    // The tone is the pill's and a danger row's sentence — two statements, neither of them the
    // ground, so an ask needs no paper and no glyph of its own.
    row.setAttribute("data-tone", decisionTone(entry.kind));
    row.setAttribute("data-card", card.id);
    row.appendChild(el("span", N.queueRank, String(rank)));
    row.appendChild(el("span", N.queueRef, "#" + card.id));
    row.appendChild(whyPill(entry));
    var title = el("button", "bf-row__title", card.title);
    title.type = "button";
    title.setAttribute("aria-haspopup", "dialog");
    // The reason the row is here, for a reader who never hovers: the control is described by
    // the very sentence printed under it.
    title.setAttribute("aria-describedby", "team-why-" + card.id);
    title.title = card.title;
    title.addEventListener("click", function () { board.openCard(card.id); });
    row.appendChild(title);
    // The holder keeps its cell when there is none: the age sits at the row's edge in every
    // row, and a column of ages with gaps in it is not a column.
    row.appendChild(card.owner ? ownerMeta(view, card.owner.label) : el("span", N.owner));
    var meta = el("p", N.queueWhy);
    // What the card is, in the label the face and the record wear: the queue is where a
    // decision is made, and a breaking change is the one fact it must not hide.
    var kind = kindLabel(card);
    if (kind !== undefined) meta.appendChild(kind);
    // A reason that names an age is stamped rather than printed once — the age in it is the one
    // part of the row that moves without a frame — and every other row says how long it waited
    // at its edge instead.
    if (entry.at === undefined) {
      meta.appendChild(document.createTextNode(entry.why));
      row.appendChild(board.stamp(card.updatedAt, undefined, true));
    } else {
      meta.appendChild(board.reasonNode({ text: entry.why, at: entry.at, wording: entry.wording }));
    }
    meta.id = "team-why-" + card.id;
    row.appendChild(meta);
    return row;
  }

  /**
   * The asks filed under each band, in the column's order, with the empty bands left out.
   *
   * The ranks survive the filing: a card keeps the place decisionsOf gave it, so the order
   * inside a band is the one the terminal's rollup reads, and a heading over nothing is never
   * drawn.
   */
  function banded(entries) {
    var bands = [];
    for (var b = 0; b < BANDS.order.length; b++) {
      var key = BANDS.order[b];
      var rows = [];
      for (var i = 0; i < entries.length; i++) {
        if (BANDS.of[entries[i].kind] === key) rows.push(entries[i]);
      }
      if (rows.length > 0) bands.push({ key: key, label: BANDS.label[key], rows: rows });
    }
    return bands;
  }

  /**
   * One band: the head that names whose move it is, and an ask on each line under it.
   *
   * The head is a lane head one level down — a dot, the word, and how many — the shape the
   * swimlanes under the queue already wear, so the column has one way of saying "these rows
   * belong together".
   */
  function bandSection(band, view, first) {
    var section = el("section", N.queueBand);
    // No dot: a lane head's dot names which lane a row is in, and a band is not one of the five.
    var head = el("h4", "bf-lane__head");
    head.appendChild(el("span", "", band.label));
    head.appendChild(el("span", "bf-lane__count", String(band.rows.length)));
    head.setAttribute("aria-label", band.label + ", " + plural(band.rows.length, "row"));
    section.appendChild(head);
    var list = el("ol", N.laneList);
    for (var i = 0; i < band.rows.length; i++) list.appendChild(decisionRow(band.rows[i], view, first + i));
    section.appendChild(list);
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
   * The queue and the lanes are one signature: an ask's sentence can change because another
   * card moved (a blocker finished), and a lane's cards move on their own revisions — so both
   * facts are in it, and a frame that changed neither leaves the column, its bands and the
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
        // The pane has a name and a number of its own: the caption above counts the lanes, and
        // a reader was left to add the rows under it to a number that did not include them.
        pane.appendChild(board.paneHead("Needs you", shown.length, decisions.length));
        var queue = el("div", N.queue);
        var bands = banded(shown);
        if (bands.length === 0) {
          queue.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "nothing needs you: nothing to sign, nothing unclaimed, nothing stalled"));
        }
        // Ranks run across the bands rather than restarting in each: the queue is one order that
        // the filing explains, not three lists that happen to sit together.
        var first = 1;
        for (var b = 0; b < bands.length; b++) {
          queue.appendChild(bandSection(bands[b], view, first));
          first += bands[b].rows.length;
        }
        pane.appendChild(queue);
        slot.appendChild(pane);
        var list = el("div", N.teamLanes);
        for (var p = 0; p < lanes.length; p++) list.appendChild(swimlane(view, lanes[p], lanes[p].cards));
        slot.appendChild(list);
      }
    };
  };
})();`;
