/**
 * The board page's stylesheet: the shared Bytefly shell and components, then the
 * page-only `board-*` layout rules.
 *
 * Layout only — every colour, size step, and radius is a kit token, so the page
 * follows the theme and `lib/web/web.test.ts`'s "draws every colour through a token"
 * rule holds without an exception here. Colour is a role: a lane states it once in
 * `--lane-role`, and the kit's row mark, lane head and lane dot read that property
 * rather than a rule per shape. The board draws no tray and no card: a lane is a head
 * with rows under it, and the only box on the page is the record in its dialog.
 */

import { LANE_RULES, LANES } from "../../../lib/board/lanes.ts";
import { BOARD_TONES } from "../../../lib/board/tone.ts";
import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";

/**
 * The width below which the board shows one lane at a time, with the lane tab rail.
 *
 * Exported, because the CSS media query and the client's two `matchMedia` calls are one
 * question: at 1180 five lanes stop fitting beside each other, and the lanes below the
 * first would be pushed under an 11,000px column.
 */
export const PICKER_MQ = 1180;

/**
 * A lane's colour, from the lane table: one role per lane, held in one custom property
 * and read by the kit's `.bf-row__mark`, `.bf-lane__head`, `.bf-lane__dot`, the Team
 * tab's swimlane, and the card dialog's state dot.
 */
const LANE_ROLE_CSS = LANES.map((lane) => {
	const role = LANE_RULES[lane].role;
	return `.board-lane[data-lane="${lane}"],.bf-row[data-lane="${lane}"],.board-dialog__state[data-lane="${lane}"],.board-dot[data-lane="${lane}"]{--lane-role:var(--${role})}`;
}).join("\n");

/**
 * A decision row's mark, one rule per tone the table names.
 *
 * Generated from the same table the terminal reads, so `gone` — ranked above `unwritten` — wears
 * the refusal colour by being classified, not by a rule somebody remembered to add.
 */
const DECISION_TONE_CSS = BOARD_TONES.map(
	(tone) => `.board-decision[data-tone="${tone}"] .bf-row__mark{color:var(--${tone})}`,
).join("\n");

/**
 * The one tone whose sentence is coloured too.
 *
 * A danger row is a refusal or a loss, and that is the row's whole point; a warn row is
 * somebody to ask, and colouring its sentence as well would spend the reader's attention on
 * the words rather than on the mark that says "look here".
 */
const DECISION_WHY_CSS = `.board-decision[data-tone="danger"] .board-decision__why{color:var(--danger)}`;

/**
 * A dialog line's colour, one rule per tone the tone table names.
 *
 * The reason line takes its tone from the reason's kind, the way the card face's does, and the
 * signature takes the tone the table gives an approval: a sign is the card's, not the page's,
 * so it is coloured by the same table rather than by a word chosen here.
 */
const DIALOG_TONE_CSS = BOARD_TONES.map(
	(tone) => `.board-dialog__reason[data-tone="${tone}"],.board-dialog__sign[data-tone="${tone}"]{color:var(--${tone})}`,
).join("\n");

/** The shared shell, the components, and the board's own layout. */
export const BOARD_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}

/* The control row: the view switch, the done meter and the filter, on the kit's rhythm. */
.board-bar{gap:var(--space-3)}
.board-filter{width:15rem}
.board-progress{margin:0}
.board-picker{display:none}

/* The main pane is this page's only child of the shell, so it grows to fill the
   column and the footer stays at the bottom however short the board is. */
.board-main{flex:1 1 auto;padding-top:0}
/* One panel per tab; the shell's main pane is the only scroll box. */
.board-panel{display:flex;flex-direction:column;min-width:0;padding-top:var(--space-5)}
.board-panel[hidden]{display:none}
.board-no-cards{max-width:32rem;margin:auto;padding:var(--space-8) var(--space-6)}
/* One way back out of a filter that matched nothing, under the sentence that says so. */
.board-no-cards .bf-btn{margin-top:var(--space-2)}

/* Lanes: a head with a tone rule and rows under it. A lane is sized by the work it holds
   rather than by its share of the row, so one holding nothing narrows to a rail and hands
   the width to the lanes carrying rows. */
.board-lanes{display:flex;flex-wrap:nowrap;gap:var(--space-4);align-items:start}
.board-lane{--lane-count:0;display:flex;flex:1 1 0;flex-grow:calc(1 + min(3, var(--lane-count)));flex-direction:column;min-width:0}
/* The lane count is a count, not a design token: the client sets it from the snapshot and
   declares its default here, so a lane whose count never arrived is an ordinary lane
   rather than a variable nobody defines. */
.board-lane[data-empty="false"][data-folded="false"]{min-width:14rem}
/* The rail: a dot, a word, and a count — the fact that the lane is showing nothing, not a
   tray. A lane is a rail when it holds no rows and when it is folded, because both say the
   same thing: there is nothing here to read. */
.board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:0 0 8.5rem}
/* The fold control is the only thing in the head that acts, and a 16px line is a poor target:
   the padding gives it 24px without growing the row it sits in. */
.board-lane__toggle{appearance:none;display:flex;align-items:center;gap:var(--space-2);border:0;background:none;padding:0;margin:0;min-height:24px;font:inherit;color:inherit;cursor:pointer}
.board-lane__toggle:hover{color:var(--accent)}
.board-lane__toggle::after{content:"▾";margin-left:2px;font-size:var(--fs-sm);color:var(--muted)}
.board-lane__toggle:hover::after{color:var(--accent)}
.board-lane__toggle[aria-expanded="false"]::after{content:"▸"}

/* A row: the kit's list shape, with the card's own body. The title is the page's one
   focusable thing inside a row; the row around it is the larger target for a pointer. */
.board-row__body{min-width:0}
.board-row__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-row__head .bf-row__title{appearance:none;border:0;background:none;padding:0;text-align:left;cursor:pointer}
.board-row__head .bf-row__title:hover{color:var(--accent)}
.board-row[data-lane="done"] .bf-row__title{color:var(--muted)}
.board-row[data-visited="true"] .bf-row__title{color:var(--muted)}
.board-row[data-current="true"] .bf-row__title{color:var(--text)}
/* How much history the row carries and how recent it is: a count and a stamp, in the
   meta line's own voice, so a row with ten notes cannot look like one with none. */
.board-row__notes{display:inline-flex;align-items:baseline;gap:var(--space-1);font-variant-numeric:tabular-nums}
/* An order is a word beside the name rather than a second tag, so who holds a row and
   how urgent it is are two shapes a reader tells apart at a glance. */
.board-row__priority{font:var(--fw-semibold) var(--fs-xs) var(--font-mono)}
.board-row__priority--high{color:var(--warn)}
.board-row__priority--low{color:var(--dim)}
.board-row__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:2px 0 0;padding:0;list-style:none}
/* A tag is one line and nowrap by design, so an owner label or a path longer than the row
   would spill past it: clipped to the row instead, with the whole of it on the hover title. */
.board-row__paths li{min-width:0;max-width:100%}
.board-row__paths .bf-tag{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-mono)}
/* The +N marker is the row's trailing element, not another hint: pushed to the end, so a
   wrap never leaves it alone under the paths it counts. */
.board-row__more{margin-left:auto}

/* One lane role per lane, set once and read by the kit's mark, head and dot. */
${LANE_ROLE_CSS}
/* A decision row's mark wears the queue's tone, from the table the terminal reads. */
${DECISION_TONE_CSS}
${DECISION_WHY_CSS}

/* The Team tab: three columns — who is here, what is moving, what arrived — each counting
   itself in a caption. There is no nested scroll here on purpose: a column of agents beside
   a short middle column is one page, and three scrollbars inside a dashboard is the thing
   this tab exists not to be. */
.board-team{min-width:0}
.board-team__grid{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr) minmax(0,20rem);gap:var(--space-5);align-items:start;min-width:0}
.board-team__column{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.board-team__empty{margin:0;font:var(--fs-sm)/var(--lh-relaxed) var(--font-ui);color:var(--muted)}
.board-team__skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-sm);background:var(--surface)}

/* Left: the agents. A row per session, the lead's wearing the accent mark. */
.board-team__agents{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.board-agent{grid-template-columns:auto minmax(0,1fr)}
.board-agent[data-lead="1"] .bf-row__mark{color:var(--accent)}
/* A dead session is drawn, not coloured: the dashed edge says "nobody is behind this". */
.board-agent[data-state="gone"]{border-bottom-style:dashed}
.board-agent__body{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.board-agent__head{display:flex;align-items:center;gap:var(--space-2);min-width:0}
/* Two letters, in the mono face: a monogram is an identifier, and a label long enough to be
   elided still has these two to be recognised by. */
.board-agent__monogram{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-width:1.5rem;height:1.5rem;padding:0 var(--space-1);background:var(--accent-soft);color:var(--accent);font:var(--fw-semibold) var(--fs-xs) var(--font-mono);text-transform:uppercase}
.board-agent__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font:var(--fw-semibold) var(--fs-sm) var(--font-ui)}
/* The state sits at the row's right edge, on the name's own line, where the eye compares one
   row with the next. */
.board-agent__head .board-agent__state{margin-left:auto;flex:0 0 auto}
.board-agent__chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);font:var(--fs-xs) var(--font-mono)}
/* The state is a word beside a dot, never a colour alone: quiet is the state a lead acts
   on and the one a reader must be able to say out loud. */
.board-agent__state{display:inline-flex;align-items:center;gap:var(--space-1);color:var(--muted);font-variant-numeric:tabular-nums}
.board-agent__mail{color:var(--accent);font-variant-numeric:tabular-nums}
/* What the session is holding: one line per card, the lane as a mark beside it. */
.board-team__missions{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.board-team__mission,.board-team__none{display:flex;align-items:center;gap:var(--space-2);min-width:0;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
.board-team__bar{flex:0 0 auto;align-self:stretch;width:2px;background:var(--muted)}
.board-team__mission-ref{color:var(--text)}
.board-team__mission-lane{text-transform:lowercase}
.board-team__mission-age{margin-left:auto;color:var(--dim);font-variant-numeric:tabular-nums}
/* An age is a duration, not a phrase: tabular figures, so two rows' minutes line up. */
.board-stamp{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
/* An agent holding nothing still draws a mission row, without its bar: the column keeps its
   rhythm, and the words sit where the mission lines do. */
.board-team__none{padding-left:calc(2px + var(--space-2));color:var(--dim)}
/* The one "there is more" control: the folded history row, a lane's remainder, a queue's tail. */
.board-fold{appearance:none;display:inline-flex;align-items:center;gap:var(--space-2);width:auto;margin:0;padding:0;min-height:24px;border:0;background:none;color:var(--muted);font:var(--fs-xs) var(--font-mono);text-align:left;cursor:pointer}
.board-fold:hover{color:var(--text)}

/* One dot for one state, wherever it is drawn: an agent's pill, a waiting row's recipient, a
   mission row's owner. A record that is not there is a hollow ring, never a colour. */
.board-dot{flex:0 0 auto;width:8px;height:8px;background:var(--muted)}
.board-owner{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0;color:var(--muted)}
.board-dot[data-state="live"]{background:var(--success)}
.board-dot[data-state="quiet"]{background:var(--warn)}
.board-dot[data-state="gone"]{background:var(--danger)}
.board-dot[data-state="absent"],.board-dot[data-state="unknown"]{background:transparent;box-shadow:inset 0 0 0 1px var(--border-strong)}
/* A lane dot is a glyph in the lane's role, not a filled square. */
.board-dot[data-lane]{background:none;color:var(--lane-role,var(--muted))}

/* Middle: the decisions strip, then the three lanes that move. */
.board-team__decisions{display:flex;flex-direction:column;min-width:0}
.board-decision{grid-template-columns:auto minmax(0,1fr);cursor:pointer}
.board-decision__body{min-width:0}
.board-decision__open{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);min-width:0;appearance:none;border:0;background:none;padding:0;color:var(--text);font:var(--fw-medium) var(--fs-sm) var(--font-ui);text-align:left;cursor:pointer}
.board-decision__open:hover .bf-row__title{color:var(--accent)}
.board-decision__ref{flex:0 0 auto;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
.board-decision__why{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);margin:2px 0 0;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
/* The lanes: a kit lane head, then the rows that fit. */
.board-team__lanes{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
/* One mission row per lane: the column is narrow enough that two abreast elide both titles. */
.board-mission{grid-template-columns:auto minmax(0,1fr);cursor:pointer}
.board-mission__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-mission__ref{flex:0 0 auto;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
.board-mission__title{appearance:none;border:0;background:none;padding:0;cursor:pointer;text-align:left}
.board-mission__title:hover{color:var(--accent)}
.board-mission__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);margin:2px 0 0;color:var(--muted);font:var(--fs-xs) var(--font-mono)}

/* Right: what nobody has read, then what the cards say happened. */
.board-team__pane-body{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.board-team__waiting,.board-team__recent{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.board-mail__body{min-width:0}
/* A row is a queue entry, not a sentence: six short facts on one line, the age pushed to the
   edge where the eye compares them. */
.board-mail,.board-event{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);min-width:0;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
/* Mail nobody has read is the one thing on this page somebody owes an answer to, so it is
   drawn as a row with an accent mark: a mark, not a box. */
.board-mail[data-kind] .bf-row__mark{color:var(--accent)}
.board-glyph{flex:0 0 auto;color:var(--muted)}
.board-mail__from{max-width:9ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.board-mail__arrow{color:var(--dim)}
.board-mail__to{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0}
.board-event__ref{color:var(--muted);font-family:var(--font-mono)}
.board-event__what{min-width:0;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* The card dialog: the record of one card, as the questions a reader asks of it — what it
   promises, where to start, what it is tied to, what has happened, and what was said.
   Nothing here scrolls on its own — the kit's body is the one scrollbar. */
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
.board-dialog__heading{display:flex;align-items:baseline;gap:var(--space-1);margin:0;padding-bottom:var(--space-1);border-bottom:1px solid var(--border);font:var(--fw-medium) var(--fs-xs) var(--font-mono);text-transform:lowercase;color:var(--muted)}
.board-dialog__count{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
/* The ladder: labels size to the longest one in the section they belong to, values take the
   width that is left, and every row starts at the same column. */
.board-dialog__facts{display:grid;grid-template-columns:minmax(6.5rem,max-content) minmax(0,1fr);gap:var(--space-1) var(--space-3);margin:0;align-items:baseline}
.board-dialog__facts dt{font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.board-dialog__facts dd{margin:0;min-width:0;font:var(--fs-sm) var(--font-ui);color:var(--text)}
/* A path is a value like any other, but a long one elides on its single line and keeps the
   whole of itself on the hover title. */
.board-dialog__value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The card face's reason sentence, whole: the one fact that says what happens next. */
.board-dialog__reason{margin:0;max-width:68ch;font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);color:var(--text);overflow-wrap:anywhere}
/* The contract is the promise, so its three lines read at body size and wrap inside their
   column: a promise clipped to one line is a promise a reader cannot check. */
.board-dialog__contract dd{font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);overflow-wrap:anywhere}
/* Who signed it, under what they signed: quiet until a tone says otherwise. */
.board-dialog__sign{margin:0;max-width:68ch;font:var(--fw-medium) var(--fs-sm) var(--font-mono);color:var(--muted)}
/* The tone rules come after the base rules, which is what makes them win. */
${DIALOG_TONE_CSS}
/* A plan path and the ids a card waits for are code, and a reader copies them. */
.board-dialog__plan{font-family:var(--font-mono)}
.board-dialog__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:0;padding:0;list-style:none;min-width:0}
.board-dialog__paths li{min-width:0;max-width:100%}
/* A path is code, not a label: the owner is a tag of prose, a path is something you type. */
.board-dialog__path{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-family:var(--font-mono)}
.board-dialog__notes{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
/* A rule between notes: wrapped prose used to run one note into the next. */
.board-dialog__note{padding-top:var(--space-3);border-top:1px solid var(--border)}
.board-dialog__note:first-child{padding-top:0;border-top:0}
/* The sentence is the record, so it reads at body size on a measure, not the full 720px. */
.board-dialog__note-text{margin:0 0 var(--space-1);max-width:68ch;font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}
/* Who and when is the footnote of the note above it. */
.board-dialog__note-foot{display:flex;align-items:baseline;gap:var(--space-2);margin:0;max-width:68ch}
.board-dialog__note-by{font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--muted)}
.board-dialog__note-at{font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.board-dialog__state{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--fs-xs) var(--font-mono);text-transform:lowercase;color:var(--muted)}
.board-dialog__state::before{content:"";width:var(--space-2);height:var(--space-2);background:var(--lane-role,var(--muted))}
/* The age beside the lane word is a duration, not a label: the lane is lowercase, its age is
   a number in the face the rest of the page's ages wear. */
.board-dialog__age{font-variant-numeric:tabular-nums;color:var(--muted)}

.board-skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-sm);background:var(--surface)}

/* One lane at a time, from the width where five lanes stop fitting beside each other. */
@media (max-width:${PICKER_MQ}px){
  .board-lanes{flex-direction:column;align-items:stretch}
  .board-lane{flex:1 1 auto}
  /* One lane at a time, so a rail buys nothing: the shown lane takes the column. */
  .board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:1 1 auto}
  .board-lane[hidden]{display:none}
  .board-picker{display:flex}
  /* Three columns need a wide window: below this the agents and the moving work share the
     row, and the activity rail drops beneath both. */
  .board-team__grid{grid-template-columns:minmax(0,18rem) minmax(0,1fr)}
  .board-team__column[data-column="activity"]{grid-column:1 / -1}
}
@media (max-width:860px){
  .board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-team__column[data-column="activity"]{grid-column:auto}
  /* A state can no longer sit on the row's line on a phone, so it wraps under the name. */
  .board-agent__head{flex-wrap:wrap}
}
/* Five lane names do not fit a phone: the tab rail wraps rather than a horizontal scroller
   that can hide the lane a reader is on. */
@media (max-width:420px){
  .board-picker{flex-wrap:wrap;gap:var(--space-1)}
  .board-picker .bf-tabs__item{border:1px solid var(--border);padding:5px 10px}
  .board-picker .bf-tabs__item[aria-pressed="true"]{border-color:var(--accent)}
}
@media (prefers-reduced-motion: reduce){
  .board-row,.board-decision{transition:none}
}
@media print{
  .board-lanes,.board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-row,.board-decision{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-picker{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
