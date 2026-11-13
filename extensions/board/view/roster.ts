/**
 * Who is on the team, joined with what they hold — the Agents column's data.
 *
 * The snapshot carries two records that only make sense together: the bus's sessions
 * (`view.teammates`) and the rollup's owners (`view.round.owners`). Joining them is the
 * one rule the column needs, and it is here rather than in the painter so a test can ask
 * it directly: the lead pinned first in every state, then the living, the dead, the aged
 * and the unrecorded, each by label.
 *
 * Two decisions worth naming:
 *
 * - **The lead is pinned above the sort**, including when it is `quiet`, `gone`, or has
 *   no record at all. A lead with no bus record still holds the gates, so a column that
 *   let a working peer outrank it would point the reader away from the one row that
 *   answers.
 * - **A label is a name a session asked for.** A plain object inherits `constructor` and
 *   `__proto__`, so an owner labelled one reads as a hit that was never written; every map
 *   here is null-prototype.
 *
 * A label the bus has no record of, holding nothing, is history: it folds into one row that
 * states what it finished, because the set only grows with every label that ever claimed a
 * card. The rule (`isHistoryOwner`) is the terminal's, spliced in.
 */

export function rosterJs(rules: { historyOwner: string }): string {
	return rosterTemplate.replace("__HISTORY_OWNER__", rules.historyOwner);
}

const rosterTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});

__HISTORY_OWNER__

  /** The map the roster's label keys come from: one body, in the fragment that draws first. */
  var labelMap = board.labelMap;

  /** The order the column reads: the lead, then alive, dead, aged, and unrecorded. */
  function rankOf(agent) {
    if (agent.lead) return -1;
    if (agent.state === "live") return 0;
    // A crash outranks a stale heartbeat: one is news, the other may be a long turn.
    if (agent.state === "gone") return 1;
    if (agent.state === "quiet") return 2;
    return 3;
  }

  /**
   * Every agent the board knows about: the bus's sessions, plus the owners a card names.
   *
   * The bus's row keeps its own spelling of the label and the card's joins onto it, so an
   * owner renamed on the bus after claiming a card draws once, under the name it answers to.
   */
  board.rosterOf = function (view) {
    var round = view.round;
    // Absent, not empty: null means no bus here, so every state reads "no record" rather than
    // claiming a session is gone.
    var roster = view.teammates === undefined ? null : view.teammates;
    var owners = labelMap();
    for (var i = 0; i < round.owners.length; i++) {
      var group = round.owners[i];
      owners[group.label.toLowerCase()] = { label: group.label, live: group.cards, done: group.done };
    }
    var rows = [];
    var seen = labelMap();
    if (roster !== null) {
      for (var j = 0; j < roster.length; j++) {
        var mate = roster[j];
        seen[mate.label.toLowerCase()] = true;
        rows.push({
          label: mate.label,
          state: mate.state,
          working: mate.working === true,
          lead: mate.lead === true,
          you: mate.you === true,
          mail: mate.mail,
          listening: mate.listening,
          seen: mate.seen,
          cards: owners[mate.label.toLowerCase()] || { live: [], done: [] }
        });
      }
    }
    // An owner the bus has no record of is still somebody: the queue may be reporting its
    // work as free, and a label that ever claimed a card stays an owner for good.
    for (var key in owners) {
      if (seen[key]) continue;
      rows.push({
        label: owners[key].label,
        state: roster === null ? "unknown" : "absent",
        working: false,
        lead: false,
        you: false,
        mail: 0,
        listening: undefined,
        seen: undefined,
        cards: owners[key]
      });
    }
    rows.sort(function (a, b) { return rankOf(a) - rankOf(b) || a.label.localeCompare(b.label); });

    var agents = [];
    var history = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      // A machine with no bus folds nobody: nobody can be called absent there.
      var historyOwner = isHistoryOwner(row.label, row.cards.live.length, roster === null ? undefined : roster);
      if (historyOwner) history.push(row);
      else agents.push(row);
    }
    // Unfolded, history reads by what it finished and then by name, so the list says who did
    // the work rather than who sorts first.
    history.sort(function (a, b) {
      return b.cards.done.length - a.cards.done.length || a.label.localeCompare(b.label);
    });
    return { agents: agents, history: history, roster: roster };
  };
})();`;
