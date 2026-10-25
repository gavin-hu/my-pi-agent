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

  /** A section heading: the table's title and a count, not a caption inside it. */
  function heading(text, count) {
    var node = el("h2", "board-team__caption", text);
    node.appendChild(chip(String(count)));
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

  /** Which cards need the lead, and why — the second table's rows. */
  function needs(round) {
    var rows = [];
    function add(cards, why, kind) {
      for (var i = 0; i < cards.length; i++) rows.push(entry(cards[i], why(cards[i]), kind));
    }
    add(round.blocked, function (card) {
      var last = card.notes.length > 0 ? card.notes[card.notes.length - 1] : undefined;
      return last ? last.text : "blocked";
    }, "blocked");
    add(round.idle, function (card) { return "no touch for " + ago(card.updatedAt); }, "idle");
    add(round.unplanned, function () { return "in flight without a plan"; }, "unplanned");
    add(round.unassigned, function () { return "nobody holds it"; }, "unassigned");
    return rows;
  }

  /** One decision row: the card, why it is here, who holds it, and the action. */
  function entry(card, why, kind) {
    var open = actionButton("#" + card.id + " " + card.title, function () { board.openCard(card.id); });
    open.className = "board-card__title";
    var owner = card.owner ? chip(card.owner.label, "accent") : el("span", "", "unassigned");
    var action = card.owner
      ? actionButton("Reclaim", function () { board.act("reclaim", card); })
      : el("span", "", "—");
    return row([
      open,
      { text: why, className: "board-team__why" + (kind === "blocked" ? " board-team__why--blocked" : "") },
      owner,
      { node: action, className: "board-team__action" },
    ]);
  }

  board.renderTeam = function (view) {
    var root = document.getElementById("board-team");
    if (!root) return;
    root.textContent = "";
    var round = view.round;

    // A group is its heading and its table together, so the gap between groups is
    // the only gap — otherwise the heading floats away from the header row it names.
    var owners = el("section", "board-team__group");
    owners.appendChild(heading("Owners", round.owners.length));
    if (round.owners.length === 0) {
      owners.appendChild(el("p", "board-lane__empty", "nobody is holding a card"));
    } else {
      var ownerRows = [];
      for (var i = 0; i < round.owners.length; i++) {
        var group = round.owners[i];
        ownerRows.push(row([chip(group.label, "accent"), String(group.cards.length), oldest(group.cards)]));
      }
      owners.appendChild(table(["Owner", "Cards", "Oldest"], ownerRows, "board-team__owners"));
    }
    root.appendChild(owners);

    var decisions = needs(round);
    var needsBlock = el("section", "board-team__group");
    needsBlock.appendChild(heading("Needs a decision", decisions.length));
    if (decisions.length === 0) {
      needsBlock.appendChild(el("p", "board-lane__empty", "nothing needs you: no blockers, nothing idle, every card planned and held"));
    } else {
      needsBlock.appendChild(table(["Card", "Why", "Owner", ""], decisions, "board-team__needs"));
    }
    root.appendChild(needsBlock);

    var done = el("p", "board-done", "");
    done.textContent = round.done.length === 0
      ? "nothing finished yet"
      : "Done · " + round.done.map(function (card) { return "#" + card.id; }).join(" ") + " · " + plural(round.done.length, "card");
    root.appendChild(done);
  };
})();`;
