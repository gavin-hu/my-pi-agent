/**
 * The Team tab: the lead's round as two tables and one muted line.
 *
 * `render.ts` draws the board as lanes; the round is a different shape, so it is a
 * different module rather than a variant of the lane renderer. The first table
 * summarises who holds what, the second is the queue of cards that need a decision —
 * blocked, idle, unplanned, or nobody's — and only the second carries an action,
 * because "reclaim" is per card and not per owner.
 *
 * Same rule as the rest of the client: every value arrives as `textContent`.
 */

export const BOARD_TEAM_JS = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var chip = board.chip;
  var actionButton = board.actionButton;
  var ago = board.ago;
  var plural = board.plural;

  /**
   * A section heading: the table's title and a count, not a caption inside it.
   *
   * With a filter on it reads shown/total, the same way a lane's head does, so a
   * reader can tell "no cards" from "no matches".
   */
  function heading(text, count, total) {
    var node = el("h2", "board-team__caption", text);
    node.appendChild(chip(total !== undefined && total !== count ? count + "/" + total : String(count)));
    return node;
  }

  /** One table with its header row; the bf-table kit owns the look. */
  function table(headings, rows, className) {
    var node = el("table", "bf-table" + (className ? " " + className : ""));
    var caption = el("caption", "sr-only", headings.join(", "));
    node.appendChild(caption);
    var head = el("thead", "");
    var headRow = el("tr", "");
    for (var i = 0; i < headings.length; i++) headRow.appendChild(el("th", "", headings[i]));
    head.appendChild(headRow);
    node.appendChild(head);
    var body = el("tbody", "");
    for (var j = 0; j < rows.length; j++) body.appendChild(rows[j]);
    node.appendChild(body);
    return node;
  }

  /** A row from cells: a node, a text+className spec, or a plain value. */
  function row(cells) {
    var node = el("tr", "");
    for (var i = 0; i < cells.length; i++) {
      var spec = cells[i];
      var cell = el("td", "");
      if (spec instanceof Node) {
        cell.appendChild(spec);
      } else if (spec && spec.node instanceof Node) {
        cell.className = spec.className || "";
        cell.appendChild(spec.node);
      } else if (spec && typeof spec === "object") {
        cell.className = spec.className || "";
        cell.textContent = spec.text === undefined ? "" : String(spec.text);
        if (spec.title !== undefined) cell.title = String(spec.title);
      } else if (spec !== undefined && spec !== null) {
        cell.textContent = String(spec);
      }
      node.appendChild(cell);
    }
    return node;
  }

  /** The oldest write in a group, as an age. */
  function oldest(cards) {
    var at = cards[0] ? cards[0].updatedAt : 0;
    for (var i = 1; i < cards.length; i++) at = Math.min(at, cards[i].updatedAt);
    return ago(at);
  }

  /**
   * Which cards need the lead, and why — entries, not rows.
   *
   * The renderer filters this list, so it has to be the data: filtering the built
   * rows would test the element instead of the card.
   */
  function needs(round) {
    var entries = [];
    function add(cards, why, kind) {
      for (var i = 0; i < cards.length; i++) entries.push({ card: cards[i], why: why(cards[i]), kind: kind });
    }
    add(round.blocked, function (card) {
      var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
      return last ? last.text : "blocked";
    }, "blocked");
    add(round.idle, function (card) { return "no touch for " + ago(card.updatedAt); }, "idle");
    add(round.unplanned, function () { return "in flight without a plan"; }, "unplanned");
    add(round.unassigned, function () { return "nobody holds it"; }, "unassigned");
    return entries;
  }

  /** One decision row: the card, why it is here, who holds it, and the action. */
  function entry(decision) {
    var card = decision.card;
    var why = decision.why;
    var kind = decision.kind;
    var open = actionButton("#" + card.id + " " + card.title, function () { board.openCard(card.id); });
    open.className = "board-card__title";
    var owner = card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned");
    var action = card.owner
      ? actionButton("Reclaim", function () { board.act("reclaim", card); })
      : el("span", "", "\u2014");
    return row([
      open,
      // The cell clamps to two lines; the tooltip carries the rest, because this
      // sentence is the lead's whole reason to look at the row.
      { text: why, title: why, className: "board-team__why" + (kind === "blocked" ? " board-team__why--blocked" : "") },
      owner,
      { node: action, className: "board-team__action" },
    ]);
  }

  board.renderTeam = function (view) {
    var root = document.getElementById("board-team");
    if (!root) return;
    root.textContent = "";
    var round = view.round;
    // The toolbar's filter is one control for both tabs, so the round reads it too.
    var query = board.query || "";
    var keep = function (card) { return board.matches(card, query); };
    var filtering = query !== "";
    var noMatch = "no card here matches \"" + query + "\"";

    // A group is its heading and its table together, so the gap between groups is
    // the only gap — otherwise the heading floats away from the header row it names.
    var owners = el("section", "board-team__group");
    var ownerGroups = [];
    for (var i = 0; i < round.owners.length; i++) {
      // Live and finished both count as this owner's, so a teammate whose last card is
      // done keeps its row instead of vanishing from the table the moment it finishes.
      var cards = round.owners[i].cards.filter(keep);
      var finished = round.owners[i].done.filter(keep);
      if (cards.length > 0 || finished.length > 0) {
        ownerGroups.push({ label: round.owners[i].label, cards: cards, done: finished });
      }
    }
    owners.appendChild(heading("Owners", ownerGroups.length, round.owners.length));
    if (ownerGroups.length === 0) {
      owners.appendChild(el("p", "board-lane__empty", filtering ? noMatch : "nobody is holding a card"));
    } else {
      var ownerRows = [];
      for (var j = 0; j < ownerGroups.length; j++) {
        var group = ownerGroups[j];
        var held = group.cards.length;
        ownerRows.push(row([
          chip(group.label, "accent"),
          String(held),
          group.done.length > 0 ? String(group.done.length) : "\u2014",
          held > 0 ? oldest(group.cards) : "\u2014",
        ]));
      }
      owners.appendChild(table(["Owner", "Live", "Done", "Oldest"], ownerRows, "board-team__owners"));
    }
    root.appendChild(owners);

    var all = needs(round);
    var decisions = all.filter(function (decision) { return keep(decision.card); });
    var needsBlock = el("section", "board-team__group");
    needsBlock.appendChild(heading("Needs a decision", decisions.length, all.length));
    if (decisions.length === 0) {
      needsBlock.appendChild(el("p", "board-lane__empty", filtering ? noMatch : "nothing needs you: no blockers, nothing idle, every card planned and held"));
    } else {
      needsBlock.appendChild(table(["Card", "Why", "Owner", ""], decisions.map(entry), "board-team__needs"));
    }
    root.appendChild(needsBlock);

    var done = round.done.filter(keep);
    var doneLine = el("p", "board-done", "");
    if (done.length === 0) {
      // While filtering, a third "no card here matches" line adds nothing; the two
      // groups above already said it.
      if (filtering) return root;
      doneLine.textContent = "nothing finished yet";
    } else {
      var ids = [];
      for (var k = 0; k < done.length; k++) ids.push("#" + done[k].id);
      doneLine.textContent = "Done \u00B7 " + ids.join(" ") + " \u00B7 " + plural(done.length, "card") +
        (filtering && done.length !== round.done.length ? " of " + round.done.length : "");
    }
    root.appendChild(doneLine);
  };
})();`;
