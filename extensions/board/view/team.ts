/**
 * The Team tab's shell: three columns, each counting itself, and nothing else.
 *
 * There is no summary header: the tab opens on its columns, and the numbers are in the
 * captions a reader's eye lands on anyway — `AGENTS · 4`, `ACTIVE WORK · 3`, `ACTIVITY · 11`.
 * The columns answer, left to right, *who is here*, *what is moving*, *what arrived*; each is
 * painted by its own fragment (`fleet.ts`, `active.ts`, `feed.ts`) and this module only says
 * where they go and when they are rebuilt.
 *
 * **A frame must not take the reader's place.** Every column is a fixed element whose contents
 * are rebuilt only when the facts it prints have moved — a signature per column, one per pane
 * in the activity column — so a peer's heartbeat, a fold the reader opened, the scroll offset,
 * and whatever has focus survive a repaint. That is why `#board-team` is emptied once and never
 * again, and why the folds live in `board.collapsed` rather than in the DOM.
 *
 * One page scroll: the shell's main pane is the only scroll box (`lib/web/layout.ts`), so the
 * captions stick to its top and a long agents list beside a short middle column is one page,
 * not three scrollbars.
 *
 * Same rule as the rest of the client: every value arrives as `textContent`.
 */

export function teamJs(): string {
	return teamTemplate;
}

const teamTemplate = String.raw`(function () {
  "use strict";
  var board = window.bfBoard || (window.bfBoard = {});
  var el = board.el;
  var plural = board.plural;

  /**
   * The shell, built once: three columns, the activity one split into its two panes.
   *
   * A pane is a slot of its own because it moves on its own clock — a message landing must not
   * rebuild the history behind it — and the caption above them is repainted only when its two
   * counts move.
   */
  function slots() {
    if (board.teamPanels !== undefined) return board.teamPanels;
    var root = document.getElementById("board-team");
    if (!root) return undefined;
    root.textContent = "";
    root.removeAttribute("data-skeleton");
    var grid = el("div", N.teamGrid);
    var agents = el("section", N.teamColumn);
    agents.setAttribute("data-column", "agents");
    var active = el("section", N.teamColumn);
    active.setAttribute("data-column", "active");
    var activity = el("section", N.teamColumn);
    activity.setAttribute("data-column", "activity");
    var caption = el("div", "");
    var waiting = el("section", N.paneBody);
    waiting.setAttribute("data-pane", "waiting");
    waiting.setAttribute("aria-label", "Waiting");
    var recent = el("section", N.paneBody);
    recent.setAttribute("data-pane", "recent");
    recent.setAttribute("aria-label", "Recent");
    activity.appendChild(caption);
    activity.appendChild(waiting);
    activity.appendChild(recent);
    grid.appendChild(agents);
    grid.appendChild(active);
    grid.appendChild(activity);
    root.appendChild(grid);
    board.teamPanels = { root: root, grid: grid, agents: agents, active: active, caption: caption, waiting: waiting, recent: recent };
    return board.teamPanels;
  }

  /**
   * Refill one slot, but only when what it draws has moved.
   *
   * The signature is the facts the slot prints — ids, revisions, states, counts — so a frame
   * that changed nothing here leaves the rows, the scroll offset, and whatever the reader has
   * focused alone. The data-sig hook is the Board tab's lanes' own, not a second one.
   */
  function fill(slot, spec) {
    if (slot.getAttribute("data-sig") === spec.sig) return;
    slot.setAttribute("data-sig", spec.sig);
    slot.textContent = "";
    spec.build(slot);
  }

  /** The activity column's caption: the two counts, and nothing to click. */
  function fillCaption(slot, waiting, recent) {
    var sig = "ACTIVITY|" + waiting + "|" + recent;
    if (slot.getAttribute("data-sig") === sig) return;
    slot.setAttribute("data-sig", sig);
    slot.textContent = "";
    slot.appendChild(board.captionOf("ACTIVITY", waiting + recent, undefined, "row"));
  }

  /**
   * What the tab says when there is nothing at all to read.
   *
   * One sentence for the whole tab, with the columns folded away: three empty captions over
   * three empty panes is a page that looks broken rather than a board that is new.
   */
  function emptySentence() {
    return "nothing here yet: no cards, no teammates and no mail \u2014 board add makes the first card";
  }

  board.renderTeam = function (view) {
    var shell = slots();
    if (shell === undefined) return;
    // The toolbar's filter is one control for both tabs, so the Team tab reads it too: it
    // matches cards, agent labels, and mail, which are the three things here.
    var query = board.query || "";
    var filtering = query !== "";
    var decisions = board.decisionsOf(view);
    var fleet = board.fleetColumn(view, decisions, query, filtering);
    var active = board.activeColumn(view, decisions, query, filtering);
    var feed = board.feedPanes(view, query, filtering);

    var barren = view.total === 0 && fleet.count === 0 && feed.waiting.total === 0 && feed.recent.total === 0;
    shell.grid.hidden = barren;
    var statement = shell.root.querySelector(".board-team__empty");
    if (barren) {
      if (statement === null) shell.root.appendChild(el("p", N.teamEmpty, emptySentence()));
      return;
    }
    if (statement !== null) statement.parentNode.removeChild(statement);

    fill(shell.agents, fleet);
    fill(shell.active, active);
    fillCaption(shell.caption, feed.waiting.total, feed.recent.total);
    fill(shell.waiting, feed.waiting);
    fill(shell.recent, feed.recent);
  };
})();`;
