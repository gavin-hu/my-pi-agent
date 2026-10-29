/**
 * The Team tab: the lead's dashboard.
 *
 * Two panels and one strip. **Needs a decision** is the queue — one row per card,
 * carrying why it is there and the action that fixes it — and **Teammates** is the
 * people: the sessions this repository's bus knows, plus every owner a card names, so a
 * session holding nothing and a label that stopped answering are both visible. Done is a
 * quiet strip of ids that open their cards.
 *
 * Two of those lists only grow: an owner a card names stays one, and a finished card is
 * finished for good. Both therefore fold — the owners the bus has no record of into one row
 * that states what they finished, and the strip past its sixth id behind its own count — and
 * the three slots are refilled only when what they print has moved, so a peer's write does
 * not take the reader's scroll or their focus with it.
 *
 * Which owners are history, and the sentence that states them, are not decided here: the
 * terminal's round prints the same fold, so both read `lib/board/round-text.ts`'s two bodies
 * through {@link teamJs}. A second copy in this fragment is how the page and `/team` came to
 * describe one board two ways.
 *
 * The roster is optional throughout: `view.teammates` is absent when `session-bus`
 * has no records here, and every state then reads `—` rather than claiming the
 * session is gone. A card is the only thing that can make a row a decision, so the
 * first panel is drawn from the round and the second from the round and the roster
 * together.
 *
 * Same rule as the rest of the client: every value arrives as `textContent`.
 */

/**
 * The tab's fragment, with the fold's rule and its sentence spliced in.
 *
 * The source crosses as text, because a page's bundle has no import graph, and the two
 * `__NAME__` placeholders are rules a served script must never carry — `pages.test` fails an
 * unfilled one.
 */
export function teamJs(rules: { historyOwner: string; historyLine: string }): string {
	return teamTemplate.replace("__HISTORY_OWNER__", rules.historyOwner).replace("__HISTORY_LINE__", rules.historyLine);
}

const teamTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var rankOf = board.rankOf;
  var decisionTone = board.decisionTone;

__HISTORY_OWNER__

__HISTORY_LINE__

  /** The word a teammate's state is read as; never a colour alone. */
  var STATE_WORD = { live: "live", quiet: "quiet", gone: "gone", absent: "no record", unknown: "\u2014" };

  /**
   * A slot's heading row: the panel's name and the count a reader came for.
   *
   * With a filter on, the count reads shown/total the way a lane head does, so a reader can
   * tell "nothing here" from "nothing matches".
   */
  function caption(slot, text, count, total) {
    var filtered = total !== undefined && total !== count;
    var head = el("h2", N.teamCaption, text);
    head.appendChild(chip(filtered ? count + "/" + total : String(count)));
    // The count is the reason the panel is read, but glued to its name a heading announces
    // "Needs a decision 4" as one word. The label says the same fact in a sentence and the
    // pill keeps the shape a reader scans.
    head.setAttribute("aria-label", text + ", " + (filtered ? count + " of " + total : String(count)));
    slot.setAttribute("aria-label", text);
    slot.appendChild(head);
  }

  /**
   * The tab's three slots, built once and then refilled in place.
   *
   * A lane has always been rebuilt only when its cards moved; the Team tab used to clear
   * itself and start again on every frame, which threw away the scroll offset of a capped
   * roster and put the reader's focus back on the document. A slot is a fixed element, and
   * what a signature guards is its contents.
   */
  function slots() {
    if (board.teamPanels !== undefined) return board.teamPanels;
    var root = document.getElementById("board-team");
    if (!root) return undefined;
    root.textContent = "";
    var grid = el("div", N.teamGrid);
    var queue = el("section", N.teamGroup);
    var people = el("section", N.teamGroup);
    grid.appendChild(queue);
    grid.appendChild(people);
    root.appendChild(grid);
    var strip = el("p", N.teamDone);
    root.appendChild(strip);
    board.teamPanels = { queue: queue, people: people, strip: strip };
    return board.teamPanels;
  }

  /**
   * Refill one slot, but only when what it draws has moved.
   *
   * The signature is the facts the slot prints — ids, revisions, states, counts — plus the
   * filter and the slot's own folded state, so a frame that changed nothing here leaves the
   * rows, the scroll offset, and whatever the reader has focused alone. The data-sig hook is
   * the lanes' own, not a second one.
   */
  function fill(slot, sig, build) {
    if (slot.getAttribute("data-sig") === sig) return;
    slot.setAttribute("data-sig", sig);
    slot.textContent = "";
    build(slot);
  }

  /**
   * Which cards need the lead, and why — entries, not rows.
   *
   * The renderer filters this list, so it has to be the data: filtering the built
   * rows would test the element instead of the card.
   *
   * The round's groups overlap on purpose — an executing card untouched for half an hour
   * is both idle and unplanned — so a card can arrive twice. On the page one card is
   * one row, and the strongest reason is the one it keeps: a blocker outranks silence,
   * which outranks a missing plan, which outranks nobody holding it.
   */
  /** The labels of the sessions whose process is gone, in the roster's own spelling. */
  function goneLabels(view) {
    var roster = view.teammates;
    var gone = {};
    if (roster === undefined) return gone;
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].state === "gone") gone[roster[i].label.toLowerCase()] = roster[i].label;
    }
    return gone;
  }

  function needs(view) {
    var round = view.round;
    var byCard = {};
    var entries = [];
    function add(cards, why, kind) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var entry = { card: card, why: why(card), kind: kind };
        var seen = byCard[card.id];
        if (seen === undefined) {
          byCard[card.id] = entry;
          entries.push(entry);
        } else if (rankOf(kind) < rankOf(seen.kind)) {
          seen.why = entry.why;
          seen.kind = kind;
        }
      }
    }
    // The card's own sentence, from the one rule: the page's faces and the transcript read
    // the same body, so a block and a contract cannot be described two ways.
    function why(card, fallback) {
      var reason = board.reasonFor(card, ago);
      return reason === undefined ? fallback : reason.text;
    }
    add(round.blocked, function (card) { return why(card, "blocked"); }, "blocked");
    // A complete contract nobody has read is the lead's decision, and the one the flow
    // stops on: the card cannot be executed until it is approved.
    add(round.unapproved, function (card) { return why(card, "contract ready — needs approval"); }, "approval");
    // A dead owner is a fact, not an inference from silence: the card is anyone's now.
    var gone = goneLabels(view);
    add(
      round.owners.reduce(function (cards, group) {
        return gone[group.label.toLowerCase()] === undefined ? cards : cards.concat(group.cards);
      }, []),
      function (card) { return (card.owner ? card.owner.label : "its owner") + " is not running — the card is free"; },
      "gone",
    );
    add(round.idle, function (card) { return "no touch for " + ago(card.updatedAt); }, "idle");
    // The board card says the same words for the same fact: one voice for one state.
    add(round.unplanned, function (card) { return why(card, "no contract yet"); }, "unplanned");
    add(round.unassigned, function () { return "nobody holds it"; }, "unassigned");
    // An order outranks nobody holding it: the claim would be refused, so the queue says
    // what it waits for instead of offering a button the rules would turn down.
    add(
      round.unassigned.filter(function (card) { return card.waits !== undefined; }),
      function (card) { return "waits on " + card.waits; },
      "waiting",
    );
    // An offer outranks plain silence: the lead has already tried to hand this card out,
    // and the age is the difference between nobody having looked and nobody taking it. A
    // card that waits keeps that reason, because the claim would be refused either way.
    add(
      round.unassigned.filter(function (card) { return card.offeredAt !== undefined; }),
      function (card) { return "offered " + ago(card.offeredAt) + " ago — nobody took it"; },
      "waiting",
    );
    return entries;
  }

  /** One decision: the card, why it is here, who holds it, and the way out. */
  function decision(entry, view) {
    var card = entry.card;
    var node = el("article", N.teamDecision);
    // What the row is, and how it wears: data-kind names it for a test and a hook, and
    // data-tone is the colour its edge is drawn in, from the table the page's stylesheet
    // and the terminal share.
    node.setAttribute("data-kind", entry.kind);
    node.setAttribute("data-tone", decisionTone(entry.kind));

    var open = el("button", N.teamOpen);
    open.type = "button";
    open.setAttribute("aria-haspopup", "dialog");
    open.appendChild(el("span", N.teamRef, "#" + card.id));
    var title = el("span", N.teamTitle, card.title);
    // A clamped title has no other way to be read, so it carries its own tooltip.
    title.title = card.title;
    open.appendChild(title);
    open.addEventListener("click", function () { board.openCard(card.id); });
    node.appendChild(open);

    var foot = el("div", N.teamFoot);
    if (card.owner) foot.appendChild(chip(card.owner.label, "accent"));
    // No button: this page cannot claim or reclaim, and a page that offered either would
    // be teaching a verb the server refuses. The row is a reason to pick a card up in the
    // terminal, which is where a claim is made.
    node.appendChild(foot);

    // The reason gets the row's whole width and two lines; the tooltip carries the
    // rest, because this sentence is the lead's whole reason to look at the row.
    var why = el("p", N.teamWhy, entry.why);
    why.title = entry.why;
    node.appendChild(why);
    return node;
  }

  /**
   * Every teammate: the bus's sessions and the owners a card names, split in two.
   *
   * The head is who is here to read: the bus's sessions, and any owner a card names that the
   * bus has no record of **and** that holds no card — that second kind is the one the queue
   * reports, and folding it would hide the row the tab exists for.
   *
   * The tail is history: an owner the bus has no record of, holding nothing. The interesting
   * case is why the row stays at all, but the set grows with every label that ever claimed a
   * card, so the page states it once and unfolds it on a click.
   */
  function teammates(view, roster) {
    var round = view.round;
    var byLabel = {};
    var rows = [];
    function labelOf(label) { return label.toLowerCase(); }

    for (var i = 0; i < round.owners.length; i++) {
      var group = round.owners[i];
      byLabel[labelOf(group.label)] = { label: group.label, live: group.cards, done: group.done };
    }
    var seen = {};
    if (roster !== null) {
      for (var j = 0; j < roster.length; j++) {
        var entry = roster[j];
        seen[labelOf(entry.label)] = true;
        rows.push({
          label: entry.label,
          state: entry.state,
          seen: entry.seen,
          mail: entry.mail,
          listening: entry.listening,
          you: entry.you,
          cards: byLabel[labelOf(entry.label)] || { live: [], done: [] },
        });
      }
    }
    for (var key in byLabel) {
      if (seen[key]) continue;
      rows.push({ label: byLabel[key].label, state: roster === null ? "unknown" : "absent", seen: undefined, mail: 0, listening: undefined, you: false, cards: byLabel[key] });
    }

    function rank(mate) {
      if (mate.you) return -1;
      if (mate.state === "live") return 0;
      // A crash outranks a stale heartbeat: one is news, the other may be a long turn.
      if (mate.state === "gone") return 1;
      if (mate.state === "quiet") return 2;
      if (mate.state === "absent") return 3;
      return 4;
    }
    rows.sort(function (a, b) { return rank(a) - rank(b) || a.label.localeCompare(b.label); });

    var head = [];
    var tail = [];
    for (var r = 0; r < rows.length; r++) {
      // The rule is the round text's own (isHistoryOwner), so the tab and /team cannot answer
      // "which owners are only history" two ways. A null roster is a machine with no bus: the
      // rule folds nobody there, because nobody can be called absent.
      if (isHistoryOwner(rows[r].label, rows[r].cards.live.length, roster === null ? undefined : roster)) {
        tail.push(rows[r]);
      } else head.push(rows[r]);
    }
    // Unfolded, history is read by what it finished and then by name, so the list says which
    // labels did the work rather than which sorts first.
    tail.sort(function (a, b) { return b.cards.done.length - a.cards.done.length || a.label.localeCompare(b.label); });
    return { head: head, tail: tail };
  }

  /** A text node carrying its stamp, so refreshAges rewrites it with every other age. */
  function stamped(text, at) {
    var node = el("span", "", text);
    node.setAttribute("data-at", String(at));
    return node;
  }

  /** One teammate: who, how they are, and what they hold. Not a button — nothing to open. */
  function mate(mate) {
    var node = el("li", N.teamMate);
    node.setAttribute("data-state", mate.state);
    if (mate.you) node.setAttribute("data-you", "1");

    var dot = el("span", N.teamDot);
    dot.setAttribute("aria-hidden", "true");
    node.appendChild(dot);
    node.appendChild(el("span", N.teamName, mate.label));
    if (mate.you) node.appendChild(chip("you"));
    // A live peer whose watch is off will read a handoff at its next turn instead of being
    // woken for it, which is the one thing a lead can still act on.
    if (mate.state === "live" && mate.listening === false) {
      var silent = chip("not listening");
      silent.title = "Mail waits for this session's next turn; it is not woken for it.";
      node.appendChild(silent);
    }
    if (mate.mail > 0) node.appendChild(chip(plural(mate.mail, "mail"), "accent"));

    // "quiet" alone does not tell a lead whether to reclaim; the heartbeat age does.
    var mets = el("p", N.teamMets);
    if (mate.state === "quiet" && mate.seen !== undefined) {
      mets.appendChild(document.createTextNode("quiet for "));
      mets.appendChild(stamped(ago(mate.seen), mate.seen));
    } else {
      mets.appendChild(document.createTextNode(STATE_WORD[mate.state] || mate.state));
    }
    var held = mate.cards.live.length;
    var done = mate.cards.done.length;
    mets.appendChild(document.createTextNode(" \u00B7 " + (held === 0 ? "no cards" : held + " held")));
    if (done > 0) mets.appendChild(document.createTextNode(" \u00B7 " + done + " done"));
    if (held > 0) {
      var at = mate.cards.live[0].updatedAt;
      for (var i = 1; i < mate.cards.live.length; i++) at = Math.min(at, mate.cards.live[i].updatedAt);
      mets.appendChild(document.createTextNode(" \u00B7 oldest "));
      mets.appendChild(stamped(ago(at), at));
    }
    node.appendChild(mets);
    return node;
  }

  /**
   * The history row: how many owners nothing answers to, and what they finished.
   *
   * One row instead of eighteen, because a label that ever claimed a card stays an owner for
   * good: eighteen rows of "no record · no cards · 1 done" are one fact printed eighteen
   * times. The row wears the same absence its rows do, so its dot is the hollow ring.
   */
  function tailRow(tail, folded) {
    var finished = 0;
    for (var i = 0; i < tail.length; i++) finished += tail[i].cards.done.length;
    var row = el("li", N.teamMate);
    row.setAttribute("data-state", "absent");
    var button = el("button", N.teamTail);
    button.type = "button";
    button.setAttribute("data-fold", "team-roster");
    button.setAttribute("aria-expanded", String(!folded));
    var dot = el("span", N.teamDot);
    dot.setAttribute("aria-hidden", "true");
    button.appendChild(dot);
    // The row counts in the rows' own words — "no record", "11 done" — so the summary is not
    // a second way of saying what a teammate row says.
    button.appendChild(document.createTextNode(historyLine(tail.length, finished)));
    button.addEventListener("click", function () { board.toggleFold("team-roster"); });
    row.appendChild(button);
    return row;
  }

  /** Whether the history row starts folded: once, like the Done lane, and the reader decides after. */
  function historyFolded(tail) {
    if (tail.length < board.foldAt.roster) return false;
    board.collapsed = board.collapsed || {};
    if (board.collapsed["team-roster"] === undefined) board.collapsed["team-roster"] = true;
    return board.collapsed["team-roster"] === true;
  }

  /**
   * Whether the strip starts folded, and stays as the reader left it.
   *
   * The lane folds at six because a tray of finished cards is history the moment it reaches
   * one more than a reader checks; the strip shows six ids and folds the seventh on, because
   * it is one line and six is what fits before it becomes a wall of underlined numbers.
   */
  function doneFolded(count) {
    if (count <= board.foldAt.done) return false;
    board.collapsed = board.collapsed || {};
    if (board.collapsed["team-done"] === undefined) board.collapsed["team-done"] = true;
    return board.collapsed["team-done"] === true;
  }

  /** One finished id in the strip: a button, because it opens its card. */
  function doneId(card) {
    var id = el("button", N.teamId, "#" + card.id);
    id.type = "button";
    id.setAttribute("aria-haspopup", "dialog");
    id.addEventListener("click", function () { board.openCard(card.id); });
    return id;
  }

  /**
   * What a slot prints, in one string — the facts its rows are drawn from, plus the filter and
   * the slot's own fold. A signature that leaves a fact out is a row that goes stale, so each
   * one is built from the same expressions the rows read.
   */
  function queueSig(decisions, total, query) {
    var parts = [query, String(total)];
    for (var i = 0; i < decisions.length; i++) {
      var card = decisions[i].card;
      parts.push(card.id + ":" + card.rev + ":" + decisions[i].kind + ":" + decisions[i].why);
    }
    return parts.join("|");
  }

  function peopleSig(head, tail, query, folded, noBus) {
    function row(mate) {
      var ids = [];
      for (var i = 0; i < mate.cards.live.length; i++) ids.push(mate.cards.live[i].id + ":" + mate.cards.live[i].rev);
      return mate.label + "," + mate.state + "," + mate.seen + "," + mate.mail + "," + mate.listening +
        "," + (mate.you ? 1 : 0) + "," + ids.join("+") + "," + mate.cards.done.length;
    }
    var parts = [query, folded ? "folded" : "open", noBus ? "no bus" : "bus"];
    for (var i = 0; i < head.length; i++) parts.push(row(head[i]));
    parts.push("--");
    for (var j = 0; j < tail.length; j++) parts.push(row(tail[j]));
    return parts.join("|");
  }

  function stripSig(done, filtering, folded, total) {
    var ids = [];
    for (var i = 0; i < done.length; i++) ids.push(done[i].id);
    return ids.join(",") + "|" + (filtering ? "filtered" : "all") + "|" + (folded ? "folded" : "open") + "|" + total;
  }

  board.renderTeam = function (view) {
    var shell = slots();
    if (shell === undefined) return;
    var round = view.round;
    // Absent, not empty: null means no bus here, so every state reads unknown.
    var roster = view.teammates === undefined ? null : view.teammates;
    // The toolbar's filter is one control for both tabs, so the round reads it too.
    var query = board.query || "";
    var keep = function (card) { return board.matches(card, query); };
    var matchesLabel = function (label) { return label.toLowerCase().indexOf(query.toLowerCase()) !== -1; };
    var filtering = query !== "";
    var noMatch = "no card here matches \"" + query + "\"";

    var all = needs(view);
    var decisions = all.filter(function (entry) { return keep(entry.card); });
    fill(shell.queue, queueSig(decisions, all.length, query), function (slot) {
      caption(slot, "Needs a decision", decisions.length, all.length);
      if (decisions.length === 0) {
        slot.appendChild(el("p", N.teamEmpty, filtering ? noMatch : "nothing needs you: no blockers, no contract waiting to be read, nothing idle"));
        return;
      }
      var list = el("div", N.teamQueue);
      for (var i = 0; i < decisions.length; i++) list.appendChild(decision(decisions[i], view));
      slot.appendChild(list);
    });

    var everyone = teammates(view, roster);
    var keepRow = function (mate) {
      if (!filtering) return true;
      if (matchesLabel(mate.label)) return true;
      var held = mate.cards.live.concat(mate.cards.done);
      for (var k = 0; k < held.length; k++) if (keep(held[k])) return true;
      return false;
    };
    var head = everyone.head.filter(keepRow);
    var history = everyone.tail.filter(keepRow);
    var people = everyone.head.length + everyone.tail.length;
    // A filter is a view of the rows, so it unfolds the history: a matching owner hidden
    // inside a fold would make the panel say "nothing matches" about somebody who is here.
    var folded = filtering ? false : historyFolded(everyone.tail);
    fill(shell.people, peopleSig(head, history, query, folded, roster === null), function (slot) {
      caption(slot, "Teammates", head.length + history.length, people);
      if (head.length + history.length === 0) {
        slot.appendChild(el("p", N.teamEmpty, filtering ? noMatch : roster === null ? "session-bus is not loaded here" : "nobody is here yet"));
        return;
      }
      var list = el("ul", N.teamRoster);
      for (var i = 0; i < head.length; i++) list.appendChild(mate(head[i]));
      if (history.length > 0) {
        // While a filter asks for people by name, the matches are rows like any other; unfolded,
        // they follow the one row that states them.
        if (!filtering) {
          list.appendChild(tailRow(history, folded));
          if (folded) {
            slot.appendChild(list);
            return;
          }
        }
        for (var j = 0; j < history.length; j++) list.appendChild(mate(history[j]));
      }
      slot.appendChild(list);
    });

    var done = round.done.filter(keep);
    var stripFolded = doneFolded(done.length);
    fill(shell.strip, stripSig(done, filtering, stripFolded, round.done.length), function (slot) {
      if (done.length === 0) {
        // While filtering, a third "no card here matches" line adds nothing; the two panels
        // above already said it.
        if (!filtering) slot.textContent = "nothing finished yet";
        return;
      }
      slot.appendChild(document.createTextNode("Done \u00B7 "));
      var shown = Math.min(done.length, board.foldAt.done);
      for (var i = 0; i < shown; i++) slot.appendChild(doneId(done[i]));
      if (done.length > board.foldAt.done) {
        var rest = el("span", N.teamDoneIds);
        rest.id = "team-done-ids";
        rest.hidden = stripFolded;
        for (var j = board.foldAt.done; j < done.length; j++) rest.appendChild(doneId(done[j]));
        slot.appendChild(rest);
      }
      slot.appendChild(document.createTextNode(" \u00B7 "));
      var count = plural(done.length, "card") +
        (filtering && done.length !== round.done.length ? " of " + round.done.length : "");
      if (done.length > board.foldAt.done) {
        // The count is the fold's control here, the way a lane's head is its own: the strip has
        // no room for a second button, and the number is what says how much is out of sight.
        var toggle = el("button", N.teamFold, count);
        toggle.type = "button";
        toggle.setAttribute("data-fold", "team-done");
        toggle.setAttribute("aria-expanded", String(!stripFolded));
        toggle.setAttribute("aria-controls", "team-done-ids");
        toggle.addEventListener("click", function () { board.toggleFold("team-done"); });
        slot.appendChild(toggle);
      } else {
        slot.appendChild(document.createTextNode(count));
      }
    });
  };
})();`;
