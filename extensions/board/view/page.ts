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

import {
	baseAttribute,
	brandLockup,
	button,
	docHead,
	keysSheet,
	tabTitle,
	themeToggle,
} from "../../../lib/web/index.ts";
import { BOARD_KEYS } from "./keys.ts";
import { BOARD_CLASS as N } from "./names.ts";
import { BOARD_CSS } from "./styles.ts";

/** The two views the page offers. */
export type PageView = "board" | "team";

/**
 * Render the document for one initial view.
 *
 * Both panels are rendered and one is `hidden`, so switching tabs costs no request and a
 * shared link opens the tab it names. The document has no form and no write affordance:
 * a page that cannot change a card cannot offer a button the server would refuse.
 */
export function renderBoardPage(input: { view: PageView; base?: string }): string {
	const team = input.view === "team";
	// The page answers under the session's mount, so its own script and theme are named
	// from that prefix rather than from the origin's root.
	const base = input.base ?? "";
	return `<!doctype html>
<html lang="en" data-view="${team ? "team" : "board"}"${baseAttribute(base)}>
<head>
${docHead({ title: tabTitle("board"), css: BOARD_CSS, base })}
</head>
<body class="bf-app">
<h1 class="sr-only">board — the shared feature list for this repository</h1>
<a class="skip" href="#main">Skip to the cards</a>
<header class="bf-app__header"><div class="bf-toolbar ${N.toolbar}">
  ${brandLockup("board")}
  <span class="bf-chip bf-chip--accent" id="board-me" title="This page is served as this session, and it cannot change a card">board</span>
  <p class="bf-status ${N.status}" id="board-status" data-state="connecting" aria-live="polite">connecting…</p>
  <span class="bf-spacer"></span>
  <div class="${N.controls}">
    <div class="bf-segmented" role="tablist" aria-label="View">
      <button type="button" class="bf-segmented__item" role="tab" id="tab-board" data-view="board" aria-controls="panel-board" aria-selected="${team ? "false" : "true"}" tabindex="${team ? "-1" : "0"}">Board</button>
      <button type="button" class="bf-segmented__item" role="tab" id="tab-team" data-view="team" aria-controls="panel-team" aria-selected="${team ? "true" : "false"}" tabindex="${team ? "0" : "-1"}">Team</button>
    </div>
    <p class="bf-progress ${N.progress}" id="board-progress" hidden>
      <span class="bf-progress__track"><span class="bf-progress__fill" id="board-progress-fill"></span></span>
      <span id="board-progress-text">0/0</span>
    </p>
    <label class="bf-field ${N.filter}"><span class="sr-only">Filter cards</span>
      <input class="bf-input" id="board-filter" type="search" placeholder="filter cards" autocomplete="off">
    </label>
    ${button({ label: "?", variant: "icon", id: "keys-open", title: "Keyboard shortcuts", attrs: { "aria-haspopup": "dialog" } })}
    ${themeToggle()}
  </div>
</div></header>
<main class="bf-app__main ${N.main}" id="main" tabindex="-1">
  <section class="${N.panel}" id="panel-board" role="tabpanel" aria-labelledby="tab-board"${team ? " hidden" : ""}>
    <div class="bf-segmented ${N.picker}" id="board-picker" role="group" aria-label="Lane"></div>
    <div class="${N.lanes}" id="board-lanes"></div>
    <div class="bf-empty ${N.noCards}" id="board-no-cards" hidden>
      <p class="bf-empty__title" id="board-no-cards-title">No cards yet</p>
      <p class="bf-empty__sub" id="board-no-cards-sub">One card per feature: what it delivers, who holds it, and where to start.</p>
      <p class="bf-empty__sub" id="board-no-cards-hint"><code>board add</code> makes one — this page reads, and the tools write.</p>
      <button type="button" class="bf-btn" id="board-no-match-clear" hidden>Clear filter</button>
    </div>
  </section>
  <section class="${N.panel}" id="panel-team" role="tabpanel" aria-labelledby="tab-team"${team ? "" : " hidden"}>
    <div class="${N.team}" id="board-team"></div>
  </section>
</main>
<footer class="bf-app__footer"><span id="board-where"></span></footer>

<div class="bf-dialog" id="board-card-dialog" hidden>
  <div class="bf-dialog__panel ${N.dialogPanel}" role="dialog" aria-modal="true" aria-labelledby="card-dialog-title" tabindex="-1">
    <div class="bf-dialog__head ${N.dialogHead}">
      <span class="${N.dialogId}" id="card-dialog-id"></span>
      <h2 id="card-dialog-title"></h2>
      <span class="bf-spacer"></span>
      <span class="${N.dialogState}" id="card-dialog-state"></span>
      <button type="button" class="bf-btn bf-btn--icon" id="card-dialog-close" aria-label="Close">×</button>
    </div>
    <div class="bf-dialog__body ${N.dialogBody}">
      <p class="sr-only" id="card-dialog-where" aria-live="polite"></p>
      <section class="${N.dialogSection}" aria-labelledby="card-dialog-card-head">
        <h3 class="${N.dialogHeading}" id="card-dialog-card-head">the card</h3>
        <dl class="${N.dialogFacts}">
          <dt id="card-dialog-owner-label">owner</dt><dd class="${N.dialogValue}" id="card-dialog-owner"></dd>
          <dt id="card-dialog-priority-label" hidden>priority</dt><dd class="${N.dialogValue}" id="card-dialog-priority" hidden></dd>
          <dt id="card-dialog-updated-label">updated</dt><dd class="${N.dialogValue}" id="card-dialog-updated"></dd>
          <dt id="card-dialog-lane-label" hidden>in lane</dt><dd class="${N.dialogValue}" id="card-dialog-lane" hidden></dd>
          <dt id="card-dialog-by-label">last edited</dt><dd class="${N.dialogValue}" id="card-dialog-by"></dd>
          <dt id="card-dialog-landed-label" hidden>landed</dt><dd class="${N.dialogValue}" id="card-dialog-landed" hidden></dd>
          <dt id="card-dialog-depends-label" hidden>waits on</dt><dd class="${N.dialogValue}" id="card-dialog-depends" hidden></dd>
          <dt id="card-dialog-dependents-label" hidden>waited on by</dt><dd class="${N.dialogValue}" id="card-dialog-dependents" hidden></dd>
          <dt id="card-dialog-plan-label" hidden>plan</dt><dd class="${N.dialogValue} ${N.dialogPlan}" id="card-dialog-plan" hidden></dd>
          <dt id="card-dialog-goal-label" hidden>goal</dt><dd class="${N.dialogValue}" id="card-dialog-goal" hidden></dd>
          <dt id="card-dialog-acceptance-label" hidden>acceptance</dt><dd class="${N.dialogValue}" id="card-dialog-acceptance" hidden></dd>
          <dt id="card-dialog-scope-out-label" hidden>scope out</dt><dd class="${N.dialogValue}" id="card-dialog-scope-out" hidden></dd>
          <dt id="card-dialog-approved-label" hidden>approved</dt><dd class="${N.dialogValue}" id="card-dialog-approved" hidden></dd>
          <dt id="card-dialog-reviewed-label" hidden>reviewed</dt><dd class="${N.dialogValue}" id="card-dialog-reviewed" hidden></dd>
          <dt id="card-dialog-paths-label" hidden>paths</dt><dd id="card-dialog-paths" hidden><ul class="${N.dialogPaths}" id="card-dialog-path-list"></ul></dd>
        </dl>
      </section>
      <section class="${N.dialogSection}" aria-labelledby="card-dialog-notes-head">
        <h3 class="${N.dialogHeading}" id="card-dialog-notes-head">notes<span class="${N.dialogCount}" id="card-dialog-note-count"></span></h3>
        <ol class="${N.dialogNotes}" id="card-dialog-notes"></ol>
        <p class="bf-dialog__hint" id="card-dialog-earlier" hidden></p>
      </section>
    </div>
  </div>
</div>

${keysSheet(BOARD_KEYS)}
<script src="${base}/app.js" defer></script>
</body>
</html>
`;
}
