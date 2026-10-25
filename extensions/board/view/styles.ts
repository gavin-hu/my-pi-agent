/**
 * The board page's stylesheet: the shared Bytefly shell and components, then the
 * page-only `board-*` layout rules.
 *
 * Layout only — every colour, size step, and radius is a kit token, so the page
 * follows the theme and `lib/web/web.test.ts`'s "draws every colour through a
 * token" rule holds without an exception here. The four breakpoints live here too,
 * because a layout decision that only exists in JavaScript cannot be inspected.
 */

import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";

/** The shared shell, the components, and the board's own layout. */
export const BOARD_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}
/* The toolbar: mark, identity, state, tabs, counts — wrapping before it crowds. */
.board-toolbar{gap:var(--space-3);flex-wrap:wrap}
.board-status{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}
.board-status[data-state="live"]{color:var(--success)}
.board-status[data-state="connecting"],.board-status[data-state="reconnecting"]{color:var(--warn)}
.board-counts{display:flex;gap:var(--space-3);margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}
.board-counts div{display:inline-flex;align-items:baseline;gap:var(--space-1)}
.board-counts dt{font:var(--fs-xs) var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
.board-counts dd{margin:0;font:var(--fw-semibold) var(--fs-sm) var(--font-ui);color:var(--text)}

/* A dialog the page has not opened is not drawn: the kit block styles the open one. */
dialog.bf-dialog:not([open]){display:none}

/* The two tabs: one panel visible, the other hidden, and the picker only at a narrow width. */
.board-panel{display:flex;flex-direction:column;gap:var(--space-4);padding:var(--space-4);min-width:0}
.board-panel[hidden]{display:none}
.board-lane-picker{display:none;gap:var(--space-2);flex-wrap:wrap}

/* The composer: one row above the lanes, collapsing to a single column when narrow. */
.board-composer{display:grid;grid-template-columns:minmax(14rem,2fr) minmax(9rem,1fr) minmax(12rem,1fr) auto;gap:var(--space-3);align-items:end}
.board-composer .bf-field{margin:0;min-width:0}
.board-composer .bf-textarea{height:2.6rem;min-height:0}

/* Four lanes of scrolling cards, with a pinned heading. */
.board-lanes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--space-4);align-items:start}
.board-lane{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.board-lane__head{display:flex;align-items:center;gap:var(--space-2);margin:0;font:var(--fw-semibold) var(--fs-sm) var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.board-lane__dot{width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
.board-lane[data-status="doing"] .board-lane__dot{background:var(--accent)}
.board-lane[data-status="blocked"] .board-lane__dot{background:var(--danger)}
.board-lane[data-status="done"] .board-lane__dot{background:var(--success)}
/* One scroll for the whole board: the toolbar stays pinned above it, and a lane
   is never a nested scroll area a wheel has to guess at. */
.board-lane__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}

/* One card: id, title, owner, hints, state, note, actions. */
.board-card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);transition:border-color var(--motion-fast) var(--motion-ease)}
.board-card:hover{border-color:var(--border-strong)}
.board-card__id{margin:0;font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.board-card__title{margin:0;font:var(--fw-semibold) var(--fs-md)/var(--lh-snug) var(--font-ui);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;background:none;border:0;padding:0;text-align:left;cursor:pointer}
.board-card__title:hover{color:var(--accent)}
.board-card__row{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:0;padding:0;list-style:none}
.board-card__owner{margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-card__note{margin:0;font:var(--fs-xs) var(--font-ui);color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.board-card__flagged{color:var(--warn)}
.board-card__actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}
.board-card--stale{border-color:var(--danger)}

/* The Team tab: one panel per owner, then the groups that need a decision. */
.board-team{display:grid;grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));gap:var(--space-4);align-items:start}
/* The kit's .bf-panel is a bare container, so the Team tab's surface is here. */
.board-team .bf-panel{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);overflow:visible}
.board-owner__head{display:flex;align-items:center;gap:var(--space-2);margin:0;font:var(--fw-semibold) var(--fs-sm) var(--font-ui);color:var(--text)}
.board-owner__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
.board-owner__row{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-2);font:var(--fs-sm) var(--font-ui);color:var(--text)}
.board-owner__row .board-card__title{flex:1 1 100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--fs-sm)}
.board-owner__meta{display:flex;align-items:center;gap:var(--space-2);flex:1 1 auto;min-width:0}
.board-owner__row .bf-btn{margin-left:auto}
.board-done{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--dim)}
.board-panel .bf-empty{padding:var(--space-3);text-align:left;font:var(--fs-sm) var(--font-ui);color:var(--dim)}

/* A refused write, and the states a reader can act on. */
.board-banner{margin:0 var(--space-4) var(--space-4)}
.board-banner[hidden]{display:none}
.board-skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--surface)}

/* The card dialog's own rows; the dialog chrome itself is the bf-dialog kit block. */
.board-dialog__meta,.board-dialog__owner,.board-dialog__plan{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}
.board-dialog__plan{font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--dim);word-break:break-all}
.board-dialog__notes{display:flex;flex-direction:column;gap:var(--space-2);margin:0;padding:0;list-style:none;max-height:16rem;overflow:auto}
.board-dialog__note{font:var(--fs-sm)/var(--lh-normal) var(--font-ui);color:var(--text)}
.board-dialog__note-by{color:var(--muted)}

@media (max-width:1180px){.board-lanes{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){
  .board-lanes{grid-template-columns:minmax(0,1fr)}
  .board-lane[hidden]{display:none}
  .board-lane-picker{display:flex}
  .board-composer{grid-template-columns:minmax(0,1fr)}
}
@media print{.board-composer,.board-card__actions,.board-tabs{display:none}}
`;
