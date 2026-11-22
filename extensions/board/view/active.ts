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
 * cards read as the backlog. `DECISION_BAND` in `lib/workflow/tone.ts` is that filing, and it is
 * the same table the pill and the rank come from.
 *
 * Every ask is two lines: the id and the title it changes, then the facts it is read for — the
 * pill it wears, the kind, the sentence the queue exists for (printed rather than hovered, and
 * carried by `aria-describedby` for a reader who never hovers), who holds it with their state's
 * dot, and one age. A band shows five rows and counts the rest behind one fold; its head is the
 * band's name and count and nothing else, because the name already says the shared move and the
 * sentence belongs to the row — a row read on its own still says why it is here.
 *
 * A mission card under the queue is the board's own card, unchanged: a lane bar, a reference,
 * one line of title, and who holds it with their state's dot.
 *
 * The reasons themselves are not decided here: `board.reasonFor` is the one rule the page,
 * the card face and the terminal share, so a blocked card is described one way everywhere.
 */

export function activeJs(rules: {
	decisionLabels: string;
	decisionBands: string;
	sameLabel: string;
	labelKey: string;
}): string {
	return activeTemplate
		.replace("__DECISION_LABEL__", rules.decisionLabels)
		.replace("__DECISION_BAND__", rules.decisionBands)
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
  var BANDS = __DECISION_BAND__;

__SAME_LABEL__

__LABEL_KEY__

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
        return gone[labelKey(group.label)] === undefined ? cards : cards.concat(group.cards);
      }, []),
      function (card) { return (card.owner ? card.owner.label : "its owner") + " is not running \u2014 the card is free"; },
      "gone"
    );
    // A complete contract nobody has read is the lead's decision, and the one the flow stops on.
    add(round.unapproved, function (card) { return why(card, "contract ready \u2014 needs approval"); }, "approval");
    // The other gate is the lead's too, and it is owed from the moment a card enters the lane.
    add(round.unreviewed, function (card) { return why(card, "no spot-check yet"); }, "review");
    // The notice is on the card and never landed: a sign or a handoff, and the page sees a card
    // without the field that tells them apart, so the sentence names both remedies.
    add(round.untold, function () { return "its notice was never announced \u2014 sign or assign again to send it"; }, "untold");
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
   * The key a band's fold is remembered by.
   *
   * The page's folds share one map and a lane's key is its own name, so a band's is prefixed:
   * team-band-claim is the queue's, backlog is the lane's, and neither can answer for the
   * other.
   */
  function foldKey(key) {
    return "team-band-" + key;
  }

  /** The id of a band's rows, which its fold opens and closes: one name, read by the control. */
  function rowsId(key) {
    return "team-rows-" + key;
  }

  /**
   * Whether a band starts folded.
   *
   * Once, like a lane: board.collapsed remembers the reader's answer through every frame a
   * peer's write causes, and the count in the head is what says the rest exists. A band at or
   * under the limit is drawn whole and has no control at all.
   */
  function collapsedOf(rows, key) {
    if (rows.length <= board.foldAt.queue) return false;
    var fold = foldKey(key);
    board.collapsed = board.collapsed || {};
    if (board.collapsed[fold] === undefined) board.collapsed[fold] = true;
    return board.collapsed[fold] === true;
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
    row.setAttribute("data-card", card.id);
    var head = el("div", N.queueHead);
    var ref = el("span", N.queueRef);
    ref.appendChild(el("span", N.queueRank, String(entry.rank)));
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
    // A waiting row's stamp would be the card's last write, not the wait: the reason already
    // names what it waits on, so the row keeps no age rather than the wrong one.
    if (entry.kind !== "waiting") facts.appendChild(board.stamp(card.updatedAt, undefined, true));
    row.appendChild(facts);
    return row;
  }

  /**
   * The asks filed under each band, in the column's order.
   *
   * Every band is drawn, a head with no rows included: the sections are the column's shape, so a
   * board with nothing unclaimed still reads Unclaimed 0 rather than losing the section — and the
   * column's shape stops depending on the data.
   *
   * The rank follows the filing rather than leading it: the caller numbers these rows in the
   * order they are drawn, because the queue is one order the bands explain — not three lists whose
   * numbers would run backwards.
   *
   * A band carries whether it starts folded, because the frame and the build have to agree about
   * it: the signature is what says the pane must be rebuilt, and a fold the signature did not know
   * about would open and close without a repaint.
   */
  function banded(entries) {
    var bands = [];
    for (var b = 0; b < BANDS.order.length; b++) {
      var key = BANDS.order[b];
      var rows = [];
      for (var i = 0; i < entries.length; i++) {
        if (BANDS.of[entries[i].kind] === key) rows.push(entries[i]);
      }
      bands.push({
        key: key,
        label: BANDS.label[key],
        rows: rows,
        collapsed: collapsedOf(rows, key)
      });
    }
    return bands;
  }

  /**
   * One band: the head that names whose move it is, the asks under it, and one control that
   * carries the rest.
   *
   * The head is the band's name and count and nothing else: the name already says the shared
   * move, the sentence belongs to the row, and a head that repeated it made the row's facts line
   * empty. The head is a lane head one level down — the shape the swimlanes under the queue
   * already wear — so the column has one way of saying "these rows belong together".
   */
  function bandSection(band, view) {
    var section = el("section", N.queueBand);
    // No dot: a lane head's dot names which lane a row is in, and a band is not one of the five.
    var head = el("h4", "bf-lane__head");
    head.appendChild(el("span", "", band.label));
    head.appendChild(el("span", "bf-lane__count", String(band.rows.length)));
    head.setAttribute("aria-label", band.label + ", " + plural(band.rows.length, "row"));
    section.appendChild(head);
    var shown = band.collapsed ? band.rows.slice(0, board.foldAt.queue) : band.rows;
    // An empty band is its head and its count: a list under it would be a gap with nothing in it.
    if (shown.length === 0) return section;
    var list = el("ol", N.laneList);
    list.id = rowsId(band.key);
    for (var i = 0; i < shown.length; i++) list.appendChild(decisionRow(shown[i], view));
    section.appendChild(list);
    if (band.rows.length > board.foldAt.queue) {
      var more = el("button", N.fold, band.collapsed ? "Show " + (band.rows.length - shown.length) + " more" : "Show fewer");
      more.type = "button";
      more.setAttribute("data-fold", foldKey(band.key));
      // The pair a disclosure owes: it says whether the rows are open, and which list it opens.
      more.setAttribute("aria-expanded", String(!band.collapsed));
      more.setAttribute("aria-controls", rowsId(band.key));
      more.addEventListener("click", function () { board.toggleFold(foldKey(band.key)); });
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
    var roster = view.teammates;
    if (roster === undefined) return "unknown";
    for (var i = 0; i < roster.length; i++) {
      if (sameLabel(roster[i].label, label)) return roster[i].state;
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
    // The bands are read once, for the signature and for the build alike: whether a band is
    // folded is one of the facts the frame prints, and a fold the signature missed would open and
    // close without a repaint.
    var bands = banded(shown);
    // A rank is the row's place as drawn, running across the bands rather than restarting in
    // each. The numbers were once assigned before the filing, so the queue read 1, 2, 4, 5, 6, 3;
    // the terminal prints its round unnumbered and decisionRank is a kind's rank, not a row's,
    // so the drawn order costs no surface a parity it had. A folded band's tail keeps its
    // numbers, so opening it changes none above it.
    var order = 0;
    for (var br = 0; br < bands.length; br++) {
      for (var rr = 0; rr < bands[br].rows.length; rr++) bands[br].rows[rr].rank = ++order;
    }
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
    for (var b = 0; b < bands.length; b++) {
      sig.push(bands[b].key + ":" + bands[b].rows.length + ":" + (bands[b].collapsed ? "folded" : "open"));
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
        var queue = el("div", N.queue);
        for (var b = 0; b < bands.length; b++) queue.appendChild(bandSection(bands[b], view));
        // Every band is drawn, so an empty queue is three 0-count heads: the sentence under them
        // says why, and a filter says what it hid.
        if (shown.length === 0) {
          queue.appendChild(el("p", N.teamEmpty, filtering ? "nothing matches \"" + query + "\"" : "nothing needs you: nothing to sign, nothing unclaimed, nothing stalled"));
        }
        pane.appendChild(queue);
        slot.appendChild(pane);
        // The lanes keep their own count under a plain label: the column has one head, and the
        // three they count are moving cards, not asks.
        slot.appendChild(el("p", N.queueMoving, "Moving \u00b7 " + plural(active, "card")));
        var list = el("div", N.teamLanes);
        for (var p = 0; p < lanes.length; p++) list.appendChild(swimlane(view, lanes[p], lanes[p].cards));
        slot.appendChild(list);
      }
    };
  };
})();`;
