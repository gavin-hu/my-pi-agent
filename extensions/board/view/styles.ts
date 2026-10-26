/**
 * The board page's stylesheet: the shared Bytefly shell and components, then the
 * page-only `board-*` layout rules.
 *
 * Layout only — every colour, size step, and radius is a kit token, so the page
 * follows the theme and `lib/web/web.test.ts`'s "draws every colour through a token"
 * rule holds without an exception here. Colour is a role: a lane's dot, its head,
 * and the reason line read `--muted`, `--accent`, `--danger`, and `--success`
 * through `data-status`, never a literal.
 *
 * The sheet is in three parts, in the order the page stacks: the toolbar, the
 * board (lanes, cards, and the Team tables), then its dialogs.
 */

import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";

/** The shared shell, the components, and the board's own layout. */
export const BOARD_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}

/* Toolbar: identity and state on the left, the controls the reader uses on the right. */
.board-toolbar{gap:var(--space-3);flex-wrap:wrap}
.board-status{margin:0}
/* The right side of the toolbar is one group, so a wrap happens between groups
   rather than between two controls that belong together. */
.board-controls{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;justify-content:flex-end}
.board-filter{width:13rem}
.board-progress{margin:0}
.board-picker{display:none;margin-bottom:var(--space-3)}

/* The main pane is this page's only child of the shell, so it grows to fill the
   column and the footer stays at the bottom however short the board is. */
.board-main{flex:1 1 auto}
/* One panel per tab; the shell's main pane is the only scroll box. */
.board-panel{display:flex;flex-direction:column;min-width:0}
.board-panel[hidden]{display:none}
.board-no-cards{max-width:32rem;margin:auto;padding:var(--space-8) var(--space-6)}

/* Lanes: trays of cards, each with a head that sticks while the pane scrolls. A lane is
   sized by the work it holds rather than by its share of the row, so one holding nothing
   narrows to a rail and hands the width to the lanes carrying cards. */
.board-lanes{display:flex;flex-wrap:nowrap;gap:var(--space-4);align-items:start}
.board-lane{display:flex;flex:1 1 0;flex-direction:column;gap:var(--space-2);min-width:0;padding:0 var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
/* The rail: a dot, a word, and a count — the fact that the lane is showing nothing, not a
   tray. A lane is a rail when it holds no cards and when it is folded, because both say
   the same thing: there is nothing here to read. */
.board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:0 0 8.5rem}
.board-lane__head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:var(--space-2);margin:0 calc(-1 * var(--space-2)) var(--space-1);padding:var(--space-2) var(--space-2);background:var(--surface);border-bottom:1px solid var(--border);border-radius:var(--radius-lg) var(--radius-lg) 0 0;font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.board-lane__toggle{appearance:none;display:flex;align-items:center;gap:var(--space-2);border:0;background:none;padding:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer}
.board-lane__toggle:hover{color:var(--accent)}
.board-lane__toggle::after{content:"▾";margin-left:2px;font-size:var(--fs-sm);color:var(--muted)}
.board-lane__toggle:hover::after{color:var(--accent)}
.board-lane__toggle[aria-expanded="false"]::after{content:"▸"}
.board-lane__count{font-variant-numeric:tabular-nums;color:var(--muted);background:var(--canvas);border-radius:var(--radius-pill);padding:0 var(--space-2);font-size:var(--fs-xs);letter-spacing:0}
.board-lane__dot{width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
.board-lane[data-status="doing"] .board-lane__dot{background:var(--accent)}
.board-lane[data-status="blocked"] .board-lane__dot{background:var(--danger)}
.board-lane[data-status="done"]{background:var(--canvas)}
.board-lane[data-status="done"] .board-lane__dot{background:var(--success)}
.board-lane__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
.board-lane__empty{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--dim)}

/* A card: the title, then the facts a reader needs to act on it. Its lane says
   which state it is in, so the card itself carries no second colour bar. */
.board-card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);transition:border-color var(--motion-fast) var(--motion-ease),transform var(--motion-fast) var(--motion-ease)}
.board-card:hover{border-color:var(--border-strong);transform:translateY(-1px)}
.board-card[hidden]{display:none}
.board-card__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-card__id{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.board-card__title{margin:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;font:var(--fw-semibold) var(--fs-base)/var(--lh-snug) var(--font-ui);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.board-card__title:hover{color:var(--accent)}
/* Finished work recedes: it is history, and the live lanes should not compete with it. */
.board-card[data-status="done"] .board-card__title{color:var(--muted)}
.board-card[data-status="done"] .board-card__title:hover{color:var(--accent)}
.board-card[data-status="done"] .bf-chip--accent{color:var(--muted);border-color:var(--border)}
.board-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-card__paths{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:0;padding:0;list-style:none}
.board-card__reason{margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.board-card__reason--blocked{color:var(--danger)}
.board-card__reason--unplanned{color:var(--warn)}
.board-card__actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}

/* The Team tab: a queue and a roster side by side, then one quiet strip. */
.board-team{display:grid;gap:var(--space-5);min-width:0}
.board-team__grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(18rem,1fr);gap:var(--space-6);align-items:start;min-width:0}
/* Each panel is its own grid, so both captions land on one line and both lists start on the next. */
.board-team__group{display:grid;grid-template-rows:auto 1fr;gap:var(--space-3);align-content:start;min-width:0}
.board-team__caption{margin:0;padding-bottom:var(--space-2);border-bottom:1px solid var(--border);font:var(--fw-semibold) var(--fs-md) var(--font-ui);color:var(--text);display:flex;align-items:center;gap:var(--space-2)}
.board-team__caption .bf-chip{margin-left:auto;font-variant-numeric:tabular-nums}
/* The queue: one row per card, its kind as an edge, its way out in the foot. */
.board-team__queue{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
/* The queue is the tallest thing here and it can be unbounded; capping it keeps the two
   panels on one screen. Stacked below 1180px there is no second column to balance, and a
   nested scroll on a phone is worse than the page's own. */
@media (min-width:1181px){
  /* A row cut at the edge reads as a bug unless something says the list continues, and a
     mac's scrollbars are hidden until it moves: an inset shade in the page's own colour
     marks the edge without a literal. */
  /* A floor, because a short window must not turn three rows into a scroll box. */
  .board-team__queue{max-height:max(18rem,calc(100dvh - 16rem));overflow:auto;overscroll-behavior:contain;padding-right:var(--space-1);box-shadow:inset 0 calc(-1 * var(--space-6)) var(--space-6) calc(-1 * var(--space-6)) var(--canvas)}
}
.board-team__decision{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"open foot" "why why";align-items:center;gap:var(--space-1) var(--space-3);padding:var(--space-2) var(--space-3);background:var(--raised);border:1px solid var(--border);border-left:3px solid var(--dim);border-radius:var(--radius-md);transition:border-color var(--motion-base) var(--motion-ease),transform var(--motion-base) var(--motion-ease)}
.board-team__decision:hover{border-color:var(--border-strong);transform:translateY(-1px)}
.board-team__decision[data-kind="blocked"]{border-left-color:var(--danger)}
.board-team__decision[data-kind="idle"]{border-left-color:var(--warn)}
/* Nobody holds it, so the edge is drawn but not filled: a shape, not a claim. */
.board-team__decision[data-kind="unassigned"]{border-left-style:dashed}
.board-team__open{grid-area:open;display:flex;align-items:baseline;gap:var(--space-2);appearance:none;border:0;background:none;padding:0;margin:0;text-align:left;cursor:pointer;color:var(--text);font:var(--fw-medium) var(--fs-md) var(--font-ui);min-width:0}
.board-team__open:hover .board-team__title{color:var(--accent)}
.board-team__ref{font:var(--fs-xs) var(--font-mono);color:var(--muted);flex:0 0 auto}
.board-team__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
/* Two lines, then a tooltip: the "why" is the reason the row is on this tab. */
.board-team__why{grid-area:why;margin:0;color:var(--muted);font:var(--fs-sm)/var(--lh-snug) var(--font-ui);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.board-team__why--blocked{color:var(--danger)}
.board-team__foot{grid-area:foot;display:flex;align-items:center;justify-content:flex-end;gap:var(--space-2)}
/* A row with no owner chip still puts its one action on the row's edge. */
.board-team__foot>.bf-btn:only-child{margin-left:auto}
/* The roster: who is here and what they hold. No hover fill — nothing to open. */
.board-team__roster{display:flex;flex-direction:column;gap:var(--space-1);margin:0;padding:0;list-style:none;min-width:0}
/* No row rule: the caption already delimits the list, and a second hairline beside it
   was the same pen drawn twice. */
.board-team__mate{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-2);padding:var(--space-2) 0;min-width:0}
.board-team__dot{width:8px;height:8px;border-radius:var(--radius-pill);background:var(--muted);flex:0 0 auto;align-self:center}
.board-team__mate[data-state="live"] .board-team__dot{background:var(--success)}
.board-team__mate[data-state="quiet"] .board-team__dot{background:var(--warn)}
/* A dead session is the one state the page states outright: solid, and in the refusal colour. */
.board-team__mate[data-state="gone"] .board-team__dot{background:var(--danger)}
/* A record that is not there is a hollow ring, never a colour that claims it is. */
.board-team__mate[data-state="absent"] .board-team__dot,.board-team__mate[data-state="unknown"] .board-team__dot{background:transparent;box-shadow:inset 0 0 0 1px var(--border-strong)}
.board-team__name{font:var(--fw-medium) var(--fs-md) var(--font-ui);color:var(--text)}
.board-team__mets{flex:1 0 100%;margin:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
.board-team__empty{margin:0;color:var(--muted);font:var(--fs-sm) var(--font-ui)}
/* Done stays quiet; its ids are buttons only because they open their card. */
.board-team__done,.board-done{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted);display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2)}
/* An id in the Done strip is a button, so it wears the only affordance it has: a
   dotted line, visible before the pointer arrives. */
.board-team__id{appearance:none;border:0;background:none;padding:0;margin:0;cursor:pointer;font:var(--fs-sm) var(--font-mono);color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}
.board-team__id:hover{color:var(--accent);text-decoration:underline}

/* The card dialog: a meta line, the notes as a timeline, and the actions at its foot. */
.board-dialog__meta,.board-dialog__owner{margin:0 0 var(--space-2);font:var(--fs-sm) var(--font-ui);color:var(--muted)}
.board-dialog__plan{margin:0 0 var(--space-2);font:var(--fs-xs) var(--font-mono);color:var(--dim);word-break:break-all}
/* What the card waits for is a fact about its place in the work, not a record of it. */
.board-dialog__depends{margin:0 0 var(--space-2);font:var(--fs-xs) var(--font-mono);color:var(--muted);word-break:break-all}
.board-dialog__notes{display:flex;flex-direction:column;gap:var(--space-3);margin:0 0 var(--space-3);padding:0;list-style:none;max-height:16rem;overflow:auto}
/* A rule between notes: wrapped prose used to run one note into the next. */
.board-dialog__note{padding-top:var(--space-3);border-top:1px solid var(--border)}
.board-dialog__note:first-child{padding-top:0;border-top:0}
.board-dialog__note-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-2);margin:0 0 2px}
.board-dialog__note-by{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--text)}
.board-dialog__note-at{font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.board-dialog__note-text{margin:0;font:var(--fs-sm)/var(--lh-normal) var(--font-ui);color:var(--text);overflow-wrap:anywhere}
.board-dialog__state{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.board-dialog__state::before{content:"";width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
.board-dialog__state[data-status="doing"]::before{background:var(--accent)}
.board-dialog__state[data-status="blocked"]::before{background:var(--danger)}
.board-dialog__state[data-status="done"]::before{background:var(--success)}
.board-skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--surface)}

@media (max-width:1180px){
  .board-lanes{flex-wrap:wrap}
  .board-lane{flex:1 1 calc(50% - var(--space-4))}
  .board-progress{display:none}
  /* Two panels need a wide window; below this the queue comes first, the roster after. */
  .board-team__grid{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:860px){
  .board-lanes{flex-direction:column;align-items:stretch}
  .board-lane{flex:1 1 auto}
  /* One lane at a time, so a rail buys nothing: the shown lane takes the column. */
  .board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:1 1 auto}
  .board-lane[hidden]{display:none}
  .board-picker{display:flex}
  .board-toolbar{gap:var(--space-2)}
  .board-toolbar .bf-spacer{display:none}
  /* The icons stay with the tabs and the filter takes the last row whole, so the
     toolbar wraps once, on purpose, instead of leaving two buttons stranded. */
  .board-controls{width:100%;justify-content:flex-start}
  .board-filter{order:9;width:100%}
  .board-team__foot{flex-wrap:wrap}
}
@media (prefers-reduced-motion: reduce){
  .board-card,.board-team__decision{transition:none}
  .board-card:hover,.board-team__decision:hover{transform:none}
}
@media print{
  .board-lanes,.board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-card{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-filter,.board-picker,.board-done{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
