/**
 * The Agents column: one card per session, the lead pinned first.
 *
 * The card answers three questions in the order a lead asks them — *who*, *how are they*,
 * *what are they holding* — and answers each as a shape rather than a sentence: a monogram
 * and a name, a state pill whose word is always spelled out beside the dot, and one line per
 * mission with the lane as a bar.
 *
 * Two of the card's facts are the reason it exists rather than a bare list:
 *
 * - **A lead's card counts what waits for it.** The eye starts top-left while the queue is in
 *   the middle column, so the first card points at it: `1 needs you`.
 * - **A quiet session's pill carries its age.** "quiet" alone does not tell a lead whether to
 *   reclaim the card a session dropped; the heartbeat age does.
 *
 * The tail — labels the bus has no record of, holding nothing — folds into one row, because
 * that set only grows and eighteen rows of "no record · 1 done" are one fact printed
 * eighteen times.
 */

export function fleetJs(rules: { historyLine: string }): string {
	return fleetTemplate.replace("__HISTORY_LINE__", rules.historyLine);
}

const fleetTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var ago = board.ago;
  var plural = board.plural;
  var stamp = board.stamp;

__HISTORY_LINE__

  /** The word a session's state is read as; a colour never carries it alone. */
  var STATE_WORD = { live: "free", quiet: "quiet", gone: "gone", absent: "no record", unknown: "\u2014" };

  /** How many missions one card prints before it counts the rest. */
  var MISSIONS = 3;

  /**
   * The two graphemes a session is recognised by.
   *
   * Two and not one, because billing-core and billing-other share a first letter; and by
   * code point, so a label a session chose in its own script is not cut through the middle of
   * a character. Escaped like any other text, because it is one.
   */
  function monogram(label) {
    var letters = Array.from ? Array.from(label) : label.split("");
    return letters.slice(0, 2).join("").toUpperCase();
  }

  /** How the session is doing, as a pill: the word, the age a quiet one needs, and a dot. */
  function statePill(agent) {
    var pill = el("span", N.agentState);
    pill.setAttribute("data-state", agent.state);
    var dot = el("span", N.dot);
    dot.setAttribute("data-state", agent.state);
    dot.setAttribute("aria-hidden", "true");
    pill.appendChild(dot);
    if (agent.working) {
      // A turn is a different fact from a heartbeat, and the one a lead picking a card up needs:
      // "working" is a session that will read the handoff at the end of its turn.
      pill.appendChild(document.createTextNode("working"));
      pill.setAttribute("aria-label", "working, inside a turn");
      return pill;
    }
    var word = STATE_WORD[agent.state] || agent.state;
    if (agent.state === "quiet" && agent.seen !== undefined) {
      pill.appendChild(document.createTextNode("quiet "));
      pill.appendChild(stamp(ago(agent.seen), agent.seen));
      pill.setAttribute("aria-label", "quiet for " + ago(agent.seen));
      return pill;
    }
    pill.appendChild(document.createTextNode(word));
    return pill;
  }

  /** One mission: a lane bar, the id, the lane's word, and one age. */
  function mission(card, laneWord) {
    var line = el("li", N.mission);
    line.setAttribute("data-lane", card.lane);
    // The lane is the word beside the number and nothing else: a 2px bar in its colour said the
    // same thing a second time, and inside a card the paper is what carries the lane.
    line.appendChild(el("span", N.missionRef, "#" + card.id));
    line.appendChild(el("span", N.missionLane, laneWord(card.lane)));
    // One age, and the card's own clock: when it last moved. The lane's birthday is the Board
    // tab's answer, and a second age on a three-word line is noise.
    line.appendChild(stamp(ago(card.updatedAt), card.updatedAt));
    line.title = "#" + card.id + " " + card.title;
    return line;
  }

  /** The word a lane is printed as, from the snapshot's own table rather than a second copy. */
  function laneWord(view, key) {
    var lane = board.laneOf(view, key);
    return lane === undefined ? key : lane.label;
  }

  /** One agent's card. */
  function agentCard(agent, view, needs) {
    var card = el("li", "bf-row " + N.agent);
    card.setAttribute("data-state", agent.state);
    if (agent.you) card.setAttribute("data-you", "1");
    if (agent.lead) card.setAttribute("data-lead", "1");
    var mark = el("span", "bf-row__mark " + N.monogram, monogram(agent.label));
    mark.setAttribute("aria-hidden", "true");
    card.appendChild(mark);
    var body = el("div", N.agentBody);
    card.appendChild(body);

    var head = el("div", N.agentHead);
    head.appendChild(el("span", N.agentName, agent.label));
    // The state is the last fact on the name's line, at the row's edge: tags are labels a
    // reader scans once, and a state is the one word compared from row to row.
    head.appendChild(statePill(agent));
    body.appendChild(head);

    var chips = el("div", N.agentChips);
    // The two facts are two chips on purpose: the page serves as the lead, so collapsing them
    // would make a renamed lead undetectable — the row would still say "you" and nothing else.
    if (agent.lead) chips.appendChild(chip("lead", "accent"));
    if (agent.you) chips.appendChild(chip("you"));
    // A live peer whose watch is off reads a handoff at its next turn instead of being woken.
    if (agent.state === "live" && agent.listening === false) {
      var silent = chip("not listening");
      silent.title = "Mail waits for this session's next turn; it is not woken for it.";
      chips.appendChild(silent);
    }
    if (agent.mail > 0) {
      var mail = el("span", N.agentMail, plural(agent.mail, "mail"));
      mail.title = plural(agent.mail, "message") + " waiting in its inbox";
      chips.appendChild(mail);
    }
    // The lead's own card says how much of the queue is its work, so the scan that starts
    // top-left lands on the reason to look right.
    if (agent.lead && needs > 0) chips.appendChild(chip(needs + " needs you", "accent"));
    body.appendChild(chips);

    var missions = el("ul", N.missions);
    var live = agent.cards.live;
    // One lookup for the card's whole list: the lane table is the snapshot's, so the word a
    // mission prints is the one the Board tab's head prints.
    var word = function (key) { return laneWord(view, key); };
    if (live.length === 0) {
      var none = el("li", N.agentNone, "no mission");
      missions.appendChild(none);
    }
    for (var i = 0; i < live.length && i < MISSIONS; i++) missions.appendChild(mission(live[i], word));
    if (live.length > MISSIONS) {
      var rest = el("li", N.agentNone, "+" + (live.length - MISSIONS) + " more");
      rest.title = board.plural(live.length, "open card");
      missions.appendChild(rest);
    }
    body.appendChild(missions);
    return card;
  }

  /**
   * The folded history row: the labels nothing answers to, counted once.
   *
   * It wears the same absence its rows would — a hollow dot — and the count is the round
   * text's own sentence, so the page and /team cannot describe one board two ways.
   */
  function historyRow(history, folded) {
    var finished = 0;
    for (var i = 0; i < history.length; i++) finished += history[i].cards.done.length;
    var row = el("li", "bf-row " + N.agent);
    row.setAttribute("data-state", "absent");
    var mark = el("span", "bf-row__mark", "\u25cb");
    mark.setAttribute("aria-hidden", "true");
    row.appendChild(mark);
    var body = el("div", N.agentBody);
    row.appendChild(body);
    var button = el("button", N.fold);
    button.type = "button";
    button.setAttribute("data-fold", "team-history");
    button.setAttribute("aria-expanded", String(!folded));
    var dot = el("span", N.dot);
    dot.setAttribute("data-state", "absent");
    dot.setAttribute("aria-hidden", "true");
    button.appendChild(dot);
    button.appendChild(document.createTextNode(historyLine(history.length, finished)));
    button.addEventListener("click", function () { board.toggleFold("team-history"); });
    body.appendChild(button);
    return row;
  }

  /** Whether the history starts folded: once, like a lane, and the reader decides after. */
  function historyFolded(count) {
    if (count < board.foldAt.roster) return false;
    board.collapsed = board.collapsed || {};
    if (board.collapsed["team-history"] === undefined) board.collapsed["team-history"] = true;
    return board.collapsed["team-history"] === true;
  }

  /**
   * A caption's count, in the one shape both the eye and a screen reader can read.
   *
   * The noun is the caller's, because the columns count different things: agents, cards, and
   * rows. Spoken, "AGENTS, 4" is a word and a number with nothing between them; "4 agents" is
   * the sentence the pill already draws as a 4.
   */
  /**
   * The mark a deck's head wears: one lane glyph, in the column's role.
   *
   * The Team tab draws two marks and no lines — this dot and the paper a card sits on — and the
   * dot is the board's lane dot, so a column and a lane are marked by the same thing.
   */
  board.headDot = function (head) {
    var dot = el("span", "bf-lane__dot", "\u25a0");
    dot.setAttribute("aria-hidden", "true");
    head.appendChild(dot);
  };

  board.captionOf = function (text, count, noun) {
    var head = el("h2", "bf-section__cap");
    board.headDot(head);
    head.appendChild(document.createTextNode(text));
    head.appendChild(el("span", "bf-section__count", String(count)));
    head.setAttribute("aria-label", text + ", " + plural(count, noun));
    return head;
  };

  /**
   * The column, as a signature and a builder: the facts its cards print, and the drawing.
   *
   * The signature is what keeps a frame from repainting a card the reader is on: it lists the
   * facts the rows read and nothing that moves on its own — a heartbeat is not one, and a
   * working turn is. The filter is not one either: it narrows the cards, and this column is
   * about who is here.
   */
  board.fleetColumn = function (view, decisions) {
    var joined = board.rosterOf(view);
    var agents = joined.agents;
    var history = joined.history;
    var folded = historyFolded(history.length);
    var needs = decisions.length;
    var sig = [folded ? "folded" : "open", joined.roster === null ? "no bus" : "bus", String(needs)];
    function row(agent) {
      var ids = [];
      for (var i = 0; i < agent.cards.live.length; i++) {
        ids.push(agent.cards.live[i].id + ":" + agent.cards.live[i].rev + ":" + agent.cards.live[i].updatedAt);
      }
      return [
        agent.label, agent.state, agent.working ? 1 : 0, agent.lead ? 1 : 0, agent.you ? 1 : 0,
        agent.mail, agent.listening, ids.join("+"), agent.cards.done.length
      ].join(",");
    }
    for (var i = 0; i < agents.length; i++) sig.push(row(agents[i]));
    sig.push("--");
    for (var j = 0; j < history.length; j++) sig.push(row(history[j]));

    return {
      sig: sig.join("|"),
      count: agents.length + history.length,
      build: function (slot) {
        slot.appendChild(board.captionOf("Agents", agents.length + history.length, "agent"));
        if (agents.length + history.length === 0) {
          slot.appendChild(el("p", N.teamEmpty, joined.roster === null ? "session-bus is not loaded here" : "nobody is here yet"));
          return;
        }
        var list = el("ul", N.agents);
        for (var k = 0; k < agents.length; k++) list.appendChild(agentCard(agents[k], view, needs));
        if (history.length > 0) {
          list.appendChild(historyRow(history, folded));
          if (folded) {
            slot.appendChild(list);
            return;
          }
          for (var h = 0; h < history.length; h++) list.appendChild(agentCard(history[h], view, needs));
        }
        slot.appendChild(list);
      }
    };
  };
})();`;
