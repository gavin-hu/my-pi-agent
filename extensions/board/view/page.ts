/**
 * The board page's document: an inert shell the client fills from the snapshot.
 *
 * The page carries no card text in its markup — not even escaped — so there is no
 * path from a card file to the document's HTML. Every field the client shows is set
 * as `textContent` from the JSON frame, which is the one property a page with a
 * model-writable store should have.
 *
 * The shell is complete before the script runs: the toolbar, both panels, the three
 * kit dialogs, the keyboard sheet, and the live region are in the markup, so a slow
 * frame shows a skeleton rather than an empty page. Every id here is a contract with
 * the client (`render.ts`, `team.ts`, `live.ts`, `actions.ts`), and the class
 * contract test holds every class to the kit or to this page's stylesheet.
 */

import { brandLockup, button, docHead, keysSheet, themeToggle } from "../../../lib/web/index.ts";
import { BOARD_KEYS } from "./keys.ts";
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
<h1 class="sr-only">board — the shared feature list for this repository</h1>
<a class="skip" href="#main">Skip to the cards</a>
<header class="bf-app__header"><div class="bf-toolbar board-toolbar">
  ${brandLockup("board")}
  <span class="bf-chip bf-chip--accent" id="board-me" title="Writes from this page are made as this session">board</span>
  <p class="bf-status board-status" id="board-status" data-state="connecting" aria-live="polite">connecting…</p>
  <span class="bf-spacer"></span>
  <div class="board-controls">
    <div class="bf-segmented" role="tablist" aria-label="View">
      <button type="button" class="bf-segmented__item" role="tab" id="tab-board" data-view="board" aria-controls="panel-board"${team ? "" : ' aria-current="page"'}>Board</button>
      <button type="button" class="bf-segmented__item" role="tab" id="tab-team" data-view="team" aria-controls="panel-team"${team ? ' aria-current="page"' : ""}>Team</button>
    </div>
    <p class="bf-progress board-progress" id="board-progress" hidden>
      <span class="bf-progress__track"><span class="bf-progress__fill" id="board-progress-fill"></span></span>
      <span id="board-progress-text">0/0</span>
    </p>
    <label class="bf-field board-filter"><span class="sr-only">Filter cards</span>
      <input class="bf-input" id="board-filter" type="search" placeholder="filter cards" autocomplete="off">
    </label>
    ${button({ label: "+ New card", id: "board-new", title: "New card — n", attrs: { "aria-haspopup": "dialog" } })}
    ${button({ label: "?", variant: "icon", id: "keys-open", title: "Keyboard shortcuts", attrs: { "aria-haspopup": "dialog" } })}
    ${themeToggle()}
  </div>
</div></header>
<main class="bf-app__main board-main" id="main" tabindex="-1">
  <p class="bf-note board-banner" id="board-banner" role="status" hidden></p>
  <section class="board-panel" id="panel-board" role="tabpanel" aria-labelledby="tab-board"${team ? " hidden" : ""}>
    <div class="bf-segmented board-picker" id="board-picker" role="tablist" aria-label="Lane"></div>
    <div class="board-lanes" id="board-lanes"></div>
    <div class="bf-empty board-no-cards" id="board-no-cards" hidden>
      <p class="bf-empty__title">No cards yet</p>
      <p class="bf-empty__sub">One card per feature: what it delivers, who holds it, and where to start.</p>
      <button class="bf-btn bf-btn--primary" type="button" id="board-first-card">Add the first card</button>
    </div>
  </section>
  <section class="board-panel" id="panel-team" role="tabpanel" aria-labelledby="tab-team"${team ? "" : " hidden"}>
    <div class="board-team" id="board-team"></div>
  </section>
</main>
<footer class="bf-app__footer"><span id="board-where"></span></footer>

<div class="bf-dialog" id="board-new-dialog" hidden>
  <div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="board-new-title">
    <div class="bf-dialog__head">
      <h2 id="board-new-title">New card</h2>
      <span class="bf-spacer"></span>
      <button type="button" class="bf-btn bf-btn--icon" id="new-dialog-close" aria-label="Close">×</button>
    </div>
    <form class="board-composer" id="board-composer" autocomplete="off">
      <div class="bf-dialog__body">
        <div class="board-composer__fields">
          <label class="bf-field"><span>Title</span>
            <input class="bf-input" id="new-title" name="title" placeholder="the feature's outcome, one line" maxlength="120" required>
          </label>
          <label class="bf-field"><span>Paths</span>
            <input class="bf-input" id="new-paths" name="paths" placeholder="src/… src/…" aria-describedby="composer-hint">
          </label>
        </div>
        <p class="bf-dialog__hint" id="composer-hint">one card per feature — its steps live in the owner's plan and todo</p>
      </div>
      <div class="bf-dialog__actions">
        <button class="bf-btn" type="button" id="board-cancel">Cancel</button>
        <button class="bf-btn bf-btn--primary" type="submit" id="new-submit">Add card</button>
      </div>
    </form>
  </div>
</div>

<div class="bf-dialog" id="board-card-dialog" hidden>
  <div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="card-dialog-title" tabindex="-1">
    <div class="bf-dialog__head">
      <h2 id="card-dialog-title"></h2>
      <span class="board-dialog__state" id="card-dialog-state"></span>
      <span class="bf-spacer"></span>
      <button type="button" class="bf-btn bf-btn--icon" id="card-dialog-close" aria-label="Close">×</button>
    </div>
    <div class="bf-dialog__body">
      <p class="board-dialog__meta" id="card-dialog-meta"></p>
      <p class="board-dialog__owner" id="card-dialog-owner"></p>
      <ul class="board-card__paths" id="card-dialog-paths"></ul>
      <p class="board-dialog__plan" id="card-dialog-plan" hidden></p>
      <ol class="board-dialog__notes" id="card-dialog-notes"></ol>
      <p class="bf-dialog__hint" id="card-dialog-earlier" hidden></p>
      <div class="bf-composer board-dialog__note-composer">
        <label class="bf-field"><span class="sr-only">Add a note</span>
          <input class="bf-input" id="card-dialog-note" placeholder="add a note" maxlength="1000">
        </label>
        <div class="bf-composer__row"><button type="button" class="bf-btn" id="card-dialog-note-add">Note</button></div>
      </div>
    </div>
    <div class="bf-dialog__actions" id="card-dialog-actions"></div>
  </div>
</div>

<div class="bf-dialog board-confirm" id="board-confirm" hidden>
  <div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">
    <div class="bf-dialog__head"><h2 id="confirm-title"></h2></div>
    <div class="bf-dialog__body"><p class="board-confirm__body" id="confirm-body"></p></div>
    <div class="bf-dialog__actions">
      <button type="button" class="bf-btn" id="confirm-cancel">Cancel</button>
      <button type="button" class="bf-btn bf-btn--primary" id="confirm-ok">Confirm</button>
    </div>
  </div>
</div>

${keysSheet(BOARD_KEYS)}
<script src="/app.js" defer></script>
</body>
</html>
`;
}
