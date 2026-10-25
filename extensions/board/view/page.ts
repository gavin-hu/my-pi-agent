/**
 * The board page's document: an inert shell the client fills from the snapshot.
 *
 * The page carries no card text in its markup — not even escaped — so there is no
 * path from a card file to the document's HTML. Every field the client shows is set
 * as `textContent` from the JSON frame, which is the one property a page with a
 * model-writable store should have.
 *
 * The shell is complete before the script runs: the toolbar, both panels, the two
 * dialogs, and the live region are in the markup, so a slow frame shows a skeleton
 * rather than an empty page.
 */

import { docHead, brandLockup, themeToggle } from "../../../lib/web/index.ts";
import { BOARD_CSS } from "./styles.ts";

/** The two views the page offers. */
export type PageView = "board" | "team";

/**
 * Render the document for one initial view.
 *
 * Both panels are rendered and one is `hidden`, so switching tabs costs no request
 * and a shared link opens the tab it names.
 */
export function renderBoardPage(input: { view: PageView }): string {
	const team = input.view === "team";
	return `<!doctype html>
<html lang="en" data-view="${team ? "team" : "board"}">
<head>
${docHead({ title: "board", css: BOARD_CSS })}
</head>
<body class="bf-app">
<a class="skip" href="#main">Skip to the board</a>
<header class="bf-app__header"><div class="bf-toolbar board-toolbar">
  ${brandLockup("board")}
  <span class="bf-chip bf-chip--accent" id="board-me" title="Writes from this page are made as this session">board</span>
  <p class="bf-status board-status" id="board-status" data-state="connecting" aria-live="polite">connecting…</p>
  <div class="bf-segmented board-tabs" role="tablist" aria-label="View">
    <button type="button" role="tab" id="tab-board" data-view="board" aria-controls="panel-board"${team ? "" : ' aria-current="page"'}>Board</button>
    <button type="button" role="tab" id="tab-team" data-view="team" aria-controls="panel-team"${team ? ' aria-current="page"' : ""}>Team</button>
  </div>
  <dl class="board-counts" id="board-counts" aria-label="Cards by lane"></dl>
  ${themeToggle()}
</div></header>
<main class="bf-app__main" id="main" tabindex="-1">
  <p class="bf-note board-banner" id="board-banner" role="status" hidden></p>
  <section class="board-panel" id="panel-board" role="tabpanel" aria-labelledby="tab-board"${team ? " hidden" : ""}>
    <form class="board-composer" id="board-composer" autocomplete="off">
      <label class="bf-field"><span>Title</span>
        <input class="bf-input" id="new-title" name="title" placeholder="the feature's outcome, one line" maxlength="120" required>
      </label>
      <label class="bf-field"><span>Paths</span>
        <input class="bf-input" id="new-paths" name="paths" placeholder="src/billing src/api">
      </label>
      <label class="bf-field board-composer__note"><span>Note</span>
        <textarea class="bf-textarea" id="new-note" name="note" rows="1" placeholder="why it exists"></textarea>
      </label>
      <button class="bf-btn bf-btn--primary" type="submit" id="new-submit">Add card</button>
    </form>
    <div class="bf-segmented board-lane-picker" id="lane-picker" role="tablist" aria-label="Lane"></div>
    <div class="board-lanes" id="board-lanes"></div>
  </section>
  <section class="board-panel" id="panel-team" role="tabpanel" aria-labelledby="tab-team"${team ? "" : " hidden"}>
    <div class="board-team" id="board-team"></div>
  </section>
</main>
<footer class="bf-app__footer"><span id="board-where"></span></footer>

<dialog class="bf-dialog board-dialog" id="board-card-dialog" aria-labelledby="card-dialog-title">
  <header class="bf-dialog__head">
    <h2 class="bf-dialog__title" id="card-dialog-title"></h2>
    <button type="button" class="bf-btn bf-btn--icon" id="card-dialog-close" aria-label="Close">×</button>
  </header>
  <div class="bf-dialog__body">
    <p class="board-dialog__meta" id="card-dialog-meta"></p>
    <p class="board-dialog__owner" id="card-dialog-owner"></p>
    <ul class="board-card__row" id="card-dialog-paths"></ul>
    <p class="board-dialog__plan" id="card-dialog-plan" hidden></p>
    <form class="bf-composer" id="card-dialog-plan-form" hidden>
      <label class="bf-field"><span>Record the plan file</span>
        <input class="bf-input" id="card-dialog-plan-input" placeholder="~/.pi/agent/plans/…/plan.md" maxlength="300">
      </label>
      <button class="bf-btn" type="submit">Record plan</button>
    </form>
    <ol class="board-dialog__notes" id="card-dialog-notes"></ol>
    <p class="bf-note" id="card-dialog-earlier" hidden></p>
    <form class="bf-composer" id="card-dialog-note-form">
      <label class="bf-field"><span>Add a note</span>
        <textarea class="bf-textarea" id="card-dialog-note" rows="2" maxlength="1000"></textarea>
      </label>
      <button class="bf-btn bf-btn--primary" type="submit">Note</button>
    </form>
  </div>
  <footer class="bf-dialog__actions" id="card-dialog-actions">
    <button type="button" class="bf-btn bf-btn--ghost" id="card-dialog-move">Move</button>
    <button type="button" class="bf-btn bf-btn--ghost" id="card-dialog-release">Release</button>
    <button type="button" class="bf-btn bf-btn--ghost" id="card-dialog-close-2">Close</button>
  </footer>
</dialog>

<dialog class="bf-dialog board-confirm" id="board-confirm" aria-labelledby="confirm-title">
  <header class="bf-dialog__head"><h2 class="bf-dialog__title" id="confirm-title"></h2></header>
  <div class="bf-dialog__body"><p class="bf-note" id="confirm-body"></p></div>
  <footer class="bf-dialog__actions">
    <button type="button" class="bf-btn bf-btn--ghost" id="confirm-cancel" autofocus>Cancel</button>
    <button type="button" class="bf-btn" id="confirm-ok">Confirm</button>
  </footer>
</dialog>

<script src="/app.js" defer></script>
</body>
</html>
`;
}
