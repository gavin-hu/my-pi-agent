/**
 * The board page's stylesheet: the shared Bytefly shell and components, then the
 * page-only `board-*` layout rules.
 *
 * Layout only — every colour, size step, and radius is a kit token, so the page
 * follows the theme and `lib/web/web.test.ts`'s "draws every colour through a token"
 * rule holds without an exception here. Colour is a role: the card's status edge,
 * the lane dot, and a status chip read `--muted`, `--accent`, `--danger`, and
 * `--success` through `data-status`, never a literal.
 *
 * The sheet is in three parts, in the order the page stacks: the toolbar, the
 * composer, then the board (lanes, cards, the Team tables, and the two dialogs).
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
.board-filter{width:13rem}
.board-progress{margin:0}
.board-picker{display:none;margin-bottom:var(--space-3)}

/* Composer: one box, two fields, and the action on its own row. */
.board-composer{margin-bottom:var(--space-5)}
.board-composer__fields{display:grid;grid-template-columns:minmax(14rem,2fr) minmax(10rem,1fr);gap:var(--space-2)}
.board-composer__fields .bf-field{min-width:0}
.board-composer__hint{margin:0;padding:0}
.board-composer .bf-composer__row{align-items:center;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-2)}

/* The main pane is this page's only child of the shell, so it grows to fill the
   column and the footer stays at the bottom however short the board is. */
.board-main{flex:1 1 auto}
/* One panel per tab; the shell's main pane is the only scroll box. */
.board-panel{display:flex;flex-direction:column;min-width:0}
.board-panel[hidden]{display:none}
.board-banner{margin:0 0 var(--space-4)}
.board-no-cards{max-width:32rem;margin:auto;padding:var(--space-8) var(--space-6)}

/* Lanes: four columns of cards, with a head that sticks while the pane scrolls. */
.board-lanes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--space-4);align-items:start}
.board-lane{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.board-lane__head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:var(--space-2);margin:0;padding:var(--space-2) 0;background:var(--canvas);font:var(--fw-semibold) var(--fs-sm) var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.board-lane__toggle{appearance:none;display:flex;align-items:center;gap:var(--space-2);border:0;background:none;padding:0;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer}
.board-lane__toggle:hover{color:var(--accent)}
.board-lane__toggle::after{content:"▾";margin-left:2px;font-size:var(--fs-sm);color:var(--muted)}
.board-lane__toggle[aria-expanded="false"]::after{content:"▸"}
.board-lane__count{font-variant-numeric:tabular-nums;color:var(--dim)}
.board-lane__dot{width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
.board-lane[data-status="doing"] .board-lane__dot{background:var(--accent)}
.board-lane[data-status="blocked"] .board-lane__dot{background:var(--danger)}
.board-lane[data-status="done"] .board-lane__dot{background:var(--success)}
.board-lane__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
.board-lane__empty{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--dim)}

/* A card: a status edge, the title, then the facts a reader needs to act on it. */
.board-card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-left-width:3px;border-left-style:solid;border-radius:var(--radius-md);background:var(--surface);transition:border-color var(--motion-fast) var(--motion-ease)}
.board-card:hover{border-color:var(--border-strong)}
.board-card[data-status="todo"]{border-left-color:var(--muted)}
.board-card[data-status="doing"]{border-left-color:var(--accent)}
.board-card[data-status="blocked"]{border-left-color:var(--danger)}
.board-card[data-status="done"]{border-left-color:var(--success)}
.board-card[hidden]{display:none}
.board-card__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-card__id{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.board-card__title{margin:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;font:var(--fw-semibold) var(--fs-md)/var(--lh-snug) var(--font-ui);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.board-card__title:hover{color:var(--accent)}
.board-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-card__paths{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:0;padding:0;list-style:none}
.board-card__reason{margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.board-card__reason--blocked{color:var(--danger)}
.board-card__reason--unplanned{color:var(--warn)}
.board-card__actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}

/* The Team tab: two tables and one muted line, not five equal panels. */
.board-team{display:flex;flex-direction:column;gap:var(--space-6);min-width:0}
.board-team__group{display:flex;flex-direction:column;min-width:0}
.board-team__caption{margin:0 0 var(--space-2);font:var(--fw-semibold) var(--fs-sm) var(--font-ui);color:var(--muted);display:flex;align-items:center;gap:var(--space-2)}
.board-team__caption .bf-chip{margin-left:var(--space-2)}
.board-team__oldest,.board-team__why{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.board-team__why{color:var(--muted);font-size:var(--fs-sm)}
.board-team__why--blocked{color:var(--danger)}
.board-team__action{text-align:right}
.board-done{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--dim)}

/* The card dialog: a meta line, the notes as a timeline, and the actions at its foot. */
.board-dialog__meta,.board-dialog__owner{margin:0 0 var(--space-2);font:var(--fs-sm) var(--font-ui);color:var(--muted)}
.board-dialog__plan{margin:0 0 var(--space-2);font:var(--fs-xs) var(--font-mono);color:var(--dim);word-break:break-all}
.board-dialog__notes{display:flex;flex-direction:column;gap:var(--space-2);margin:0 0 var(--space-3);padding:0;list-style:none;max-height:14rem;overflow:auto}
.board-dialog__note{font:var(--fs-sm)/var(--lh-normal) var(--font-ui);color:var(--text)}
.board-dialog__note-by{color:var(--muted)}
.board-dialog__lanes{margin-right:auto}
.board-dialog__note-composer .bf-field{margin:0}
.board-team__owners th:nth-child(1){width:50%}
.board-team__owners th:nth-child(2){width:20%}
.board-team__owners th:nth-child(3){width:30%}
.board-team__needs{table-layout:fixed}
.board-team__needs th:nth-child(1){width:44%}
.board-team__needs th:nth-child(2){width:32%}
.board-team__needs th:nth-child(3){width:16%}
.board-team__needs th:nth-child(4){width:8%}
.board-confirm__body{margin:0}
.board-skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--surface)}

@media (max-width:1180px){
  .board-lanes{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:860px){
  .board-lanes{grid-template-columns:minmax(0,1fr)}
  .board-lane[hidden]{display:none}
  .board-picker{display:flex}
  .board-toolbar{gap:var(--space-2)}
  .board-toolbar .bf-spacer{display:none}
  /* The icons stay with the tabs and the filter takes the last row whole, so the
     toolbar wraps once, on purpose, instead of leaving two buttons stranded. */
  .board-filter{order:9;width:100%}
  .board-composer__fields{grid-template-columns:minmax(0,1fr)}
}
@media print{
  .board-lanes{grid-template-columns:minmax(0,1fr)}
  .board-card{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-card__actions,.board-composer,.board-filter,.board-picker,.board-done{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
