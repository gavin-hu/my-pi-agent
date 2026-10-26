/**
 * The Team tab: the lead's dashboard.
 *
 * Two panels and one strip. **Needs a decision** is the queue — one row per card,
 * carrying why it is there and the action that fixes it — and **Teammates** is the
 * people: the sessions this repository's bus knows, plus every owner a card names,
 * so a session holding nothing and a label that stopped answering are both visible.
 * Done is a quiet strip of ids that open their cards.
 *
 * The roster is optional throughout: `view.teammates` is absent when `session-bus`
 * has no records here, and every state then reads `—` rather than claiming the
 * session is gone. A card is the only thing that can make a row a decision, so the
 * first panel is drawn from the round and the second from the round and the roster
 * together.
 *
 * Same rule as the rest of the client: every value arrives as `textContent`.
 */

export const BOARD_TEAM_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;

  /** The word a teammate's state is read as; never a colour alone. */
  var STATE_WORD = { live: "live", quiet: "quiet", gone: "gone", absent: "no record", unknown: "\u2014" };

  /**
   * A panel: its heading row, then its body.
   *
   * With a filter on, the count reads shown/total the way a lane head does, so a
   * reader can tell "nothing here" from "nothing matches".
   */
  function panel(text, count, total) {
    var node = el("section", "board-team__group");
    node.setAttribute("aria-label", text);
    var caption = el("h2", "board-team__caption", text);
    caption.appendChild(chip(total !== undefined && total !== count ? count + "/" + total : String(count)));
    node.appendChild(caption);
    return node;
  }

  /**
   * Which cards need the lead, and why — entries, not rows.
   *
   * The renderer filters this list, so it has to be the data: filtering the built
   * rows would test the element instead of the card.
   *
   * The round's groups overlap on purpose — a doing card untouched for half an hour
   * is both idle and unplanned — so a card can arrive twice. On the page one card is
   * one row, and the strongest reason is the one it keeps: a blocker outranks silence,
   * which outranks a missing plan, which outranks nobody holding it.
   */
  var KIND_RANK = { blocked: 0, gone: 1, waiting: 2, idle: 3, unplanned: 4, unassigned: 5 };

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
        } else if (KIND_RANK[kind] < KIND_RANK[seen.kind]) {
          seen.why = entry.why;
          seen.kind = kind;
        }
      }
    }
    add(round.blocked, function (card) {
      var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
      return last ? last.text : "blocked";
    }, "blocked");
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
    add(round.unplanned, function () { return "no plan recorded"; }, "unplanned");
    add(round.unassigned, function () { return "nobody holds it"; }, "unassigned");
    // An order outranks nobody holding it: the claim would be refused, so the queue says
    // what it waits for instead of offering a button the rules would turn down.
    add(
      round.unassigned.filter(function (card) { return card.waits !== undefined; }),
      function (card) { return "waits on " + card.waits; },
      "waiting",
    );
    return entries;
  }

  /** One decision: the card, why it is here, who holds it, and the way out. */
  function decision(entry, view) {
    var card = entry.card;
    var node = el("article", "board-team__decision");
    node.setAttribute("data-kind", entry.kind);

    var open = el("button", "board-team__open");
    open.type = "button";
    open.setAttribute("aria-haspopup", "dialog");
    open.appendChild(el("span", "board-team__ref", "#" + card.id));
    var title = el("span", "board-team__title", card.title);
    // A clamped title has no other way to be read, so it carries its own tooltip.
    title.title = card.title;
    open.appendChild(title);
    open.addEventListener("click", function () { board.openCard(card.id); });
    node.appendChild(open);

    var foot = el("div", "board-team__foot");
    if (card.owner) foot.appendChild(chip(card.owner.label, "accent"));
    // No button: this page cannot claim or reclaim, and a page that offered either would
    // be teaching a verb the server refuses. The row is a reason to pick a card up in the
    // terminal, which is where a claim is made.
    node.appendChild(foot);

    // The reason gets the row's whole width and two lines; the tooltip carries the
    // rest, because this sentence is the lead's whole reason to look at the row.
    var why = el("p", "board-team__why", entry.why);
    why.title = entry.why;
    if (entry.kind === "blocked") why.className = "board-team__why board-team__why--blocked";
    node.appendChild(why);
    return node;
  }

  /**
   * Every teammate: the bus's sessions and the owners a card names, as one list.
   *
   * An owner with no live session is the interesting row — work is held by a label
   * nothing answers to — so it stays, with "no record" where a heartbeat would be.
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
    return rows;
  }

  /** A text node carrying its stamp, so refreshAges rewrites it with every other age. */
  function stamped(text, at) {
    var node = el("span", "", text);
    node.setAttribute("data-at", String(at));
    return node;
  }

  /** One teammate: who, how they are, and what they hold. Not a button — nothing to open. */
  function mate(mate) {
    var node = el("li", "board-team__mate");
    node.setAttribute("data-state", mate.state);
    if (mate.you) node.setAttribute("data-you", "1");

    var dot = el("span", "board-team__dot");
    dot.setAttribute("aria-hidden", "true");
    node.appendChild(dot);
    node.appendChild(el("span", "board-team__name", mate.label));
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
    var mets = el("p", "board-team__mets");
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

  board.renderTeam = function (view) {
    var root = document.getElementById("board-team");
    if (!root) return;
    root.textContent = "";
    var round = view.round;
    // Absent, not empty: null means no bus here, so every state reads unknown.
    var roster = view.teammates === undefined ? null : view.teammates;
    // The toolbar's filter is one control for both tabs, so the round reads it too.
    var query = board.query || "";
    var keep = function (card) { return board.matches(card, query); };
    var matchesLabel = function (label) { return label.toLowerCase().indexOf(query.toLowerCase()) !== -1; };
    var filtering = query !== "";
    var noMatch = "no card here matches \"" + query + "\"";

    var grid = el("div", "board-team__grid");

    var all = needs(view);
    var decisions = all.filter(function (entry) { return keep(entry.card); });
    var queue = panel("Needs a decision", decisions.length, all.length);
    if (decisions.length === 0) {
      queue.appendChild(el("p", "board-team__empty", filtering ? noMatch : "nothing needs you: no blockers, nothing idle, every card planned and held"));
    } else {
      var list = el("div", "board-team__queue");
      for (var i = 0; i < decisions.length; i++) list.appendChild(decision(decisions[i], view));
      queue.appendChild(list);
    }
    grid.appendChild(queue);

    var everyone = teammates(view, roster);
    var shown = everyone.filter(function (m) {
      if (!filtering) return true;
      if (matchesLabel(m.label)) return true;
      var held = m.cards.live.concat(m.cards.done);
      for (var k = 0; k < held.length; k++) if (keep(held[k])) return true;
      return false;
    });
    var people = panel("Teammates", shown.length, everyone.length);
    if (shown.length === 0) {
      people.appendChild(el("p", "board-team__empty", filtering ? noMatch : roster === null ? "session-bus is not loaded here" : "nobody is here yet"));
    } else {
      var rosterList = el("ul", "board-team__roster");
      for (var j = 0; j < shown.length; j++) rosterList.appendChild(mate(shown[j]));
      people.appendChild(rosterList);
    }
    grid.appendChild(people);
    root.appendChild(grid);

    var done = round.done.filter(keep);
    var strip = el("p", "board-team__done");
    if (done.length === 0) {
      // While filtering, a third "no card here matches" line adds nothing; the two
      // panels above already said it.
      if (filtering) return root;
      strip.textContent = "nothing finished yet";
    } else {
      strip.appendChild(document.createTextNode("Done \u00B7 "));
      for (var m = 0; m < done.length; m++) {
        (function (card) {
          var id = el("button", "board-team__id", "#" + card.id);
          id.type = "button";
          id.setAttribute("aria-haspopup", "dialog");
          id.addEventListener("click", function () { board.openCard(card.id); });
          strip.appendChild(id);
        })(done[m]);
      }
      strip.appendChild(document.createTextNode(" \u00B7 " + plural(done.length, "card") +
        (filtering && done.length !== round.done.length ? " of " + round.done.length : "")));
    }
    root.appendChild(strip);
  };
})();`;
