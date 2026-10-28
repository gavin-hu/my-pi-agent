/**
 * The board page's stylesheet: the shared Bytefly shell and components, then the
 * page-only `board-*` layout rules.
 *
 * Layout only — every colour, size step, and radius is a kit token, so the page
 * follows the theme and `lib/web/web.test.ts`'s "draws every colour through a token"
 * rule holds without an exception here. Colour is a role: a lane's dot, its head,
 * and the reason line read `--muted`, `--accent`, `--danger`, and `--success`
 * through `data-lane`, never a literal.
 *
 * The sheet is in three parts, in the order the page stacks: the toolbar, the
 * board (lanes, cards, and the Team tables), then its dialogs.
 */

import { LANE_RULES, LANES } from "../../../lib/board/lanes.ts";
import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";

/**
 * A lane's colour, from the lane table: one role per lane, worn by the dot on its head and
 * by the same dot in a card's dialog.
 *
 * Generated rather than written five times, so a lane added to `LANES` arrives with its
 * colour and the two rules cannot drift from the table's `role`.
 */
const LANE_ROLE_CSS = LANES.flatMap((lane) => {
	const role = LANE_RULES[lane].role;
	return [
		`.board-lane[data-lane="${lane}"] .board-lane__dot{background:var(--${role})}`,
		`.board-dialog__state[data-lane="${lane}"]::before{background:var(--${role})}`,
	];
}).join("\n");

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
   column and the footer stays at the bottom however short the board is. Its top
   padding moves to the panels: a sticky head pins to the scroll box's padding
   edge, so a gutter above it is a strip a card scrolls through unheaded. */
.board-main{flex:1 1 auto;padding-top:0}
/* One panel per tab; the shell's main pane is the only scroll box. */
.board-panel{display:flex;flex-direction:column;min-width:0;padding-top:var(--space-5)}
.board-panel[hidden]{display:none}
.board-no-cards{max-width:32rem;margin:auto;padding:var(--space-8) var(--space-6)}
/* One way back out of a filter that matched nothing, under the sentence that says so. */
.board-no-cards .bf-btn{margin-top:var(--space-2)}

/* Lanes: trays of cards, each with a head that sticks while the pane scrolls. A lane is
   sized by the work it holds rather than by its share of the row, so one holding nothing
   narrows to a rail and hands the width to the lanes carrying cards. */
.board-lanes{display:flex;flex-wrap:nowrap;gap:var(--space-4);align-items:start}
.board-lane{--lane-count:0;display:flex;flex:1 1 0;flex-grow:calc(1 + var(--lane-count));flex-direction:column;gap:var(--space-2);min-width:0;padding:0 var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
/* The lane count is a count, not a design token: the client sets it from the snapshot and
   declares its default here, so a lane whose count never arrived is an ordinary lane
   rather than a variable nobody defines. */
/* A lane's share of the row follows the work it holds — two cards earn more width than
   one — and the floor is the narrowest a tray is still a tray at. It is set on the two
   states that draw one, so a rail keeps its own width, and both breakpoints below
   replace the basis, so the floor only ever applies to the row it was chosen for:
   five lanes at 1180px are 60rem, which is inside the row before the wrap. */
.board-lane[data-empty="false"][data-folded="false"]{min-width:12rem}
/* Except finished work: it is history, and a lane of five finished cards used to take
   half the row while the one card still being worked sat on the floor and elided its
   own title. A done lane draws as if it held three cards, however many it holds. */
.board-lane[data-lane="done"]{flex-grow:calc(1 + min(3, var(--lane-count)))}
/* The rail: a dot, a word, and a count — the fact that the lane is showing nothing, not a
   tray. A lane is a rail when it holds no cards and when it is folded, because both say
   the same thing: there is nothing here to read. */
.board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:0 0 8.5rem}
.board-lane__head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:var(--space-2);margin:0 calc(-1 * var(--space-2)) var(--space-1);padding:var(--space-2) var(--space-2);background:var(--surface);border-bottom:1px solid var(--border);border-radius:var(--radius-lg) var(--radius-lg) 0 0;font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
/* The fold control is the only thing in the head that acts, and a 16px line is a poor target:
   the padding gives it 24px without growing the row it sits in. */
.board-lane__toggle{appearance:none;display:flex;align-items:center;gap:var(--space-2);border:0;background:none;padding:4px 0;margin:-4px 0;min-height:24px;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;cursor:pointer}
.board-lane__toggle:hover{color:var(--accent)}
.board-lane__toggle::after{content:"▾";margin-left:2px;font-size:var(--fs-sm);color:var(--muted)}
.board-lane__toggle:hover::after{color:var(--accent)}
.board-lane__toggle[aria-expanded="false"]::after{content:"▸"}
.board-lane__count{font-variant-numeric:tabular-nums;color:var(--muted);background:var(--canvas);border-radius:var(--radius-pill);padding:0 var(--space-2);font-size:var(--fs-xs);letter-spacing:0}
.board-lane__dot{width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
${LANE_ROLE_CSS}
.board-lane__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
.board-lane__empty{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}

/* A card: the title, then the facts a reader needs to act on it. Its lane says
   which state it is in, so the card itself carries no second colour bar. */
.board-card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);cursor:pointer;transition:border-color var(--motion-fast) var(--motion-ease),transform var(--motion-fast) var(--motion-ease)}
.board-card:hover{border-color:var(--border-strong);transform:translateY(-1px)}
.board-card[hidden]{display:none}
.board-card__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-card__id{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.board-card__title{margin:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;font:var(--fw-semibold) var(--fs-base)/var(--lh-snug) var(--font-ui);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.board-card__title:hover{color:var(--accent)}
/* Finished work recedes: it is history, and the live lanes should not compete with it. */
.board-card[data-lane="done"] .board-card__title{color:var(--muted)}
.board-card[data-lane="done"] .board-card__title:hover{color:var(--accent)}
.board-card[data-lane="done"] .bf-chip--accent{color:var(--muted);border-color:var(--border)}
.board-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-card__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:0;padding:0;list-style:none}
/* A chip is one line and nowrap by design, so an owner label or a path longer than the card
   would spill past its border and across the lane beside it: clipped to the card instead,
   with the whole of it on the hover title the renderer sets. The list item has to be the one
   that shrinks, because a flex item's automatic minimum is its chip's width. */
.board-card__paths li{min-width:0;max-width:100%}
.board-card .bf-chip{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis}
/* A path is something a reader types, so it wears the mono face the dialog's ladder uses. */
.board-card__paths .bf-chip{font-family:var(--font-mono)}
.board-card__reason{margin:0;font:var(--fs-sm)/var(--lh-snug) var(--font-ui);color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.board-card__reason--blocked{color:var(--danger)}
.board-card__reason--unplanned{color:var(--warn)}

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
.board-team__decision[data-kind="approval"]{border-left-color:var(--warn)}
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
.board-team__done{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted);display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2)}
/* An id in the Done strip is a button, so it wears the only affordance it has: a
   dotted line, visible before the pointer arrives. */
.board-team__id{appearance:none;border:0;background:none;padding:5px 8px;margin:-5px -8px;min-height:24px;cursor:pointer;font:var(--fs-sm) var(--font-mono);color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}
.board-team__id:hover{color:var(--accent);text-decoration:underline}

/* The card dialog: the record of one card, in two named sections. Nothing here scrolls on
   its own — the kit's body is the one scrollbar, so a reader is never inside a scroll
   inside a scroll. */
/* A little taller than the kit's default: this dialog is the only place a whole card —
   its facts, its plan, and every note it kept — can be read. */
.board-dialog__panel{width:min(720px,100%);max-height:84vh}
/* A long title wraps beside its id instead of pushing the close button off the head. */
.board-dialog__head{flex-wrap:wrap;align-items:baseline;row-gap:var(--space-1)}
.board-dialog__head h2{flex:1 1 12ch;min-width:0;font-size:var(--fs-lg);line-height:var(--lh-tight);overflow-wrap:anywhere}
.board-dialog__id{font:var(--fs-sm) var(--font-mono);color:var(--muted)}
.board-dialog__body{display:flex;flex-direction:column;gap:var(--space-4);padding-bottom:var(--space-4)}
.board-dialog__section{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
/* The heading is a label, not a headline: the title above it is the only headline here. */
.board-dialog__heading{display:flex;align-items:baseline;gap:var(--space-1);margin:0;padding-bottom:var(--space-1);border-bottom:1px solid var(--border);font:var(--fw-medium) var(--fs-xs) var(--font-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.board-dialog__count{font:var(--fs-xs) var(--font-mono);letter-spacing:0;text-transform:none;color:var(--dim)}
/* The ladder: labels size to the longest one, values take the width that is left, and
   every row starts at the same column so the eye can run down the facts. */
.board-dialog__facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:var(--space-1) var(--space-3);margin:0;align-items:baseline}
.board-dialog__facts dt{font:var(--fs-xs) var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.board-dialog__facts dd{margin:0;min-width:0;font:var(--fs-sm) var(--font-ui);color:var(--text)}
/* A path is a value like any other, but a long one elides on its single line and keeps the
   whole of itself on the hover title, so a 90-character plan cannot shred the ladder. */
.board-dialog__value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* A plan path and the ids a card waits for are code, and a reader copies them. */
.board-dialog__plan{font-family:var(--font-mono)}
.board-dialog__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:0;padding:0;list-style:none;min-width:0}
.board-dialog__paths li{min-width:0;max-width:100%}
/* A path is code, not a label: the owner is a chip of prose, a path is something you type. */
.board-dialog__path{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-family:var(--font-mono)}
.board-dialog__notes{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
/* A rule between notes: wrapped prose used to run one note into the next. */
.board-dialog__note{padding-top:var(--space-3);border-top:1px solid var(--border)}
.board-dialog__note:first-child{padding-top:0;border-top:0}
/* The sentence is the record, so it reads at body size on a measure, not the full 720px. */
.board-dialog__note-text{margin:0 0 var(--space-1);max-width:68ch;font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}
/* Who and when is the footnote of the note above it. */
.board-dialog__note-foot{display:flex;align-items:baseline;gap:var(--space-2);margin:0;max-width:68ch}
.board-dialog__note-by{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-dialog__note-at{font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.board-dialog__state{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.board-dialog__state::before{content:"";width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}

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
/* Five lane names do not fit a phone: the strip becomes wrapped pills rather than a
   horizontal scroller that can hide the lane a reader is on. */
@media (max-width:420px){
  .board-picker{flex-wrap:wrap;border:0;background:none;gap:var(--space-1)}
  .board-picker .bf-segmented__item{border:1px solid var(--border);border-radius:var(--radius-pill);padding:5px 10px}
  .board-picker .bf-segmented__item[aria-pressed="true"]{border-color:var(--accent)}
}
@media (prefers-reduced-motion: reduce){
  .board-card,.board-team__decision{transition:none}
  .board-card:hover,.board-team__decision:hover{transform:none}
}
@media print{
  .board-lanes,.board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-card{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-filter,.board-picker{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
