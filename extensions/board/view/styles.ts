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

import { LANE_RULES, LANES, type LaneRole } from "../../../lib/board/lanes.ts";
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
 * and read by the kit's `.bf-lane__head`, `.bf-lane__dot`, the Team tab's swimlane and its
 * rows' marks, and the card dialog's state dot.
 *
 * The lane also owns the card's paper — the soft tone its role names — so a note's colour is
 * the lane it is in and never a decoration of its own: five lanes, five papers, and a card
 * that moves changes colour with the column it lands in. `muted` has no soft tone of its own,
 * and the pool is the quietest lane, so it keeps the raised plane for paper.
 */
const LANE_PAPER: Record<LaneRole, string> = {
	muted: "--raised",
	warn: "--search-soft",
	accent: "--accent-soft",
	danger: "--danger-soft",
	success: "--success-soft",
};

const LANE_ROLE_CSS = LANES.map((lane) => {
	const role = LANE_RULES[lane].role;
	return (
		`.bf-lane[data-lane="${lane}"],.bf-row[data-lane="${lane}"],.board-dialog__state[data-lane="${lane}"],.board-dot[data-lane="${lane}"]{--lane-role:var(--${role})}` +
		`.bf-row[data-lane="${lane}"]{--note-paper:var(${LANE_PAPER[role]})}`
	);
}).join("\n");

/**
 * The one tone whose sentence is coloured too.
 *
 * A danger row is a refusal or a loss, and that is the row's whole point; a warn row is
 * somebody to ask, where the pill already carries the colour and colouring the sentence as well
 * would spend the reader's attention on the words.
 */
const DECISION_WHY_CSS = `.board-queue__row[data-tone="danger"] .board-queue__why{color:var(--danger)}`;

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

/* Lanes: a head with a tone rule and boxes under it, spaced rather than ruled. A lane is
   sized by the work it holds rather than by its share of the row, so one holding nothing
   narrows to a rail and hands the width to the lanes carrying rows. The row stretches its
   lanes rather than starting them: a head pins inside its own lane's box, so a lane holding
   two cards would otherwise carry its head off the top of the screen while the reader walks
   a long one — the four quiet lanes' names and counts gone with it. */
.board-lanes{display:flex;flex-wrap:nowrap;gap:var(--space-4);align-items:stretch}
/* The face is the note's index, not its record: what it is, what it says, where it is, what it
   owes, and whose it is. A card is as tall as it draws — a one-line title makes a shorter note
   than a two-line one — and the line every card shares is the state row. */
.board-lane{--lane-count:0}
/* The face's boxes are the lane's: every lane that holds a card draws the note from them. The status
   box is the one that is not optional — the row is on every card, blank when the card owes nothing —
   while the others follow the content. The face height variable is the skeleton's estimate now, not
   a height: the row is as tall as the boxes it draws. */
.board-lane,.board-team .bf-lane{--face-top:calc(var(--fs-xs) * var(--lh-normal));--face-title:calc(var(--fs-base) * var(--lh-snug) * 2);--face-hints:calc(var(--fs-xs) * var(--lh-normal));--face-status:calc(var(--fs-xs) * var(--lh-normal));--face-meta:calc(var(--fs-xs) * var(--lh-normal));--face-h:calc(var(--face-top) + var(--face-title) + var(--face-hints) + var(--face-status) + var(--face-meta) + var(--space-1) * 4);display:flex;flex:1 1 0;flex-grow:calc(1 + min(3, var(--lane-count)));flex-direction:column;min-width:0;transition:flex-grow 200ms ease}
/* A lane head pins to the pane: one scroll box, and every lane is as tall as the board, so
   its heads are the landmarks in it for the whole scroll. */
.board-lane .bf-lane__head{position:sticky;top:0;z-index:1;background:var(--canvas)}
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

/* A card is a note: a tinted rectangle with no edge drawn round it, set off from its
   neighbours by the gap alone, so the lane shows paper and space rather than a grid of lines.
   Its height is its content's — the boxes it draws plus the padding — so a lane of notes is as
   ragged as the cards are, and the state row is the line they all share. */
.bf-lane .bf-lane__list{gap:var(--space-2)}
.bf-lane .board-row{grid-template-columns:minmax(0,1fr);overflow:hidden;padding:var(--space-2) var(--space-3);background:var(--note-paper);border:0;border-radius:var(--radius-md)}
/* The card the reader walked to wears the accent outside its edge; a card a peer's write just
   moved wears it inside, so the two never read as one state. */
.bf-lane .board-row[data-current="true"]{outline:2px solid var(--accent)}
/* A card whose file moved since the last frame is marked for a breath: a peer's write is news,
   and where it landed is the whole of what a live board owes a reader. A ring rather than a
   fill, because the face is now the lane's paper — a fill would repaint the paper this card is
   identified by, and on Execute's own accent-soft paper it would paint nothing at all. A ring
   also cannot be swallowed by a background rule at equal specificity, whatever order the two
   land in. The mark leaves with its attribute, so the rule states a colour and no timing. */
.bf-lane .board-row[data-changed="true"]{outline:2px solid var(--accent);outline-offset:-2px}
/* A card's body is the note's column: what it is, what it says, where it is, what it owes, whose
   it is — in that order, and the card ends where the last line ends. */
.board-row__body{display:flex;flex-direction:column;gap:var(--space-1);min-width:0}
/* The note's head: what it is, in the order a reader sorts a lane by — its number, the kind of
   work with its breaking marker, and the order it is in. */
.board-row__top{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0;font:var(--fs-xs) var(--font-ui);white-space:nowrap;overflow:hidden}
/* The number is never dropped; the kind and the order are what give way in a narrow lane. */
.board-row__top > :not(.bf-row__id){flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.board-row__top > .bf-row__id{flex:0 0 auto}
.board-row__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
/* The title is the one line a note is about, so it takes the largest and heaviest ink on the
   face: the rank beside the number is an index, and a card read by its order tells a lane of
   twenty-five nothing about what any of them says. */
.board-row__head .bf-row__title{appearance:none;border:0;background:none;padding:0;text-align:left;cursor:pointer;font-size:var(--fs-base);font-weight:var(--fw-medium)}
.board-row__head .bf-row__title:hover{color:var(--accent)}
.board-row[data-lane="done"] .bf-row__title{color:var(--muted)}
.board-row[data-visited="true"] .bf-row__title{color:var(--muted)}
.board-row[data-current="true"] .bf-row__title{color:var(--text)}
/* How much history the row carries and how recent it is: a count and a stamp, in the
   meta line's own voice, so a row with ten notes cannot look like one with none. */
.board-row__notes{display:inline-flex;align-items:baseline;gap:var(--space-1);font-variant-numeric:tabular-nums}
/* An order is a word beside the name rather than a second tag, so who holds a row and
   how urgent it is are two shapes a reader tells apart at a glance. It wears its colour and
   keeps the number's weight: the title carries the face, and a rank at the title's own heft
   would be the loudest ink on a card that is about what the card says. */
.board-row__priority{font:var(--fw-normal) var(--fs-xs) var(--font-ui)}
.board-row__priority--high{color:var(--warn)}
.board-row__priority--low{color:var(--dim)}
/* A path has no spaces to break at, so the title breaks inside a word rather than overflowing. */
.board-row__head .bf-row__title{overflow-wrap:anywhere}
/* A hint line is one line: a lane narrower than its paths clips them rather than growing the
   face, and each hint's whole path is on its own hover and in the plus-N list beside it. */
.board-row__paths{display:flex;flex-wrap:nowrap;gap:var(--space-1) var(--space-2);margin:2px 0 0;padding:0;list-style:none;max-height:var(--face-hints);overflow:hidden}
/* A tag is one line and nowrap by design, so an owner label or a path longer than the row
   would spill past it: clipped to the row instead, with the whole of it on the hover title. */
.board-row__paths li{min-width:0;max-width:100%}
.board-row__paths .bf-tag{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-mono)}
/* The +N marker is the row's trailing element, not another hint: pushed to the end, so a
   wrap never leaves it alone under the paths it counts. */
.board-row__more{margin-left:auto}
/* The meta line is the note's footer: whose it is at one end, when it was last written with the
   history beside it at the other. One line, clipped rather than wrapped, so a narrow lane never
   grows the note. The holder wears no chip: a leading bar is what a path wears. */
.bf-lane .bf-row__meta{display:flex;flex-wrap:nowrap;align-items:baseline;gap:var(--space-2);margin:0;line-height:var(--lh-normal);max-height:var(--face-meta);overflow:hidden;white-space:nowrap}
.board-lane .bf-row__meta > .board-row__owner{flex:0 0 auto;color:var(--text)}
.board-lane .bf-row__meta > [data-at]{margin-left:auto}
.board-lane .bf-row__meta .board-row__notes{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
/* The state row is on every card, one line tall: what the card owes somebody, or the blank line
   where it would go. A note is prose, so a note-kind reason lives in this row for the description
   and is never drawn. Layout only — the kit's data-tone rules are one class less specific than this
   rule, so a colour stated here would mute every warn and danger line without a test failing. */
.bf-lane .bf-row__reason{display:block;height:var(--face-status);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* One lane role per lane, set once and read by the kit's mark, head and dot. */
${LANE_ROLE_CSS}
/* A danger row's sentence wears the tone the table gives its kind. */
${DECISION_WHY_CSS}

/* The Team tab: the board's columns seen from the other side.
   One card, five papers, one head. A card is the board's lane block — a tinted ground with no
   edge, told from the next by the gap alone, its facts in the same order: what it is, what it
   says, whose it is and when. The only line the page draws is a deck's head, and it is drawn
   as the board's lane head: a role dot, the word, the count, and the role's rule. */
.board-team{--paper:var(--raised);--team-pad:var(--space-2) var(--space-3);--team-row-h:calc(var(--fs-xs) * var(--lh-normal) + var(--space-2) * 2);min-width:0}
/* Each column's role, which its head and its cards read: people are the quiet plane, the queue
   is the warning colour, and what arrived is the accent. A pane inherits its own tone. */
.board-team__column[data-column="agents"]{--lane-role:var(--muted)}
.board-team__column[data-column="active"]{--lane-role:var(--warn)}
.board-team__column[data-column="activity"]{--lane-role:var(--accent)}
.board-team .bf-section[data-tone="warn"]{--lane-role:var(--warn)}
.board-team .bf-section[data-tone="accent"]{--lane-role:var(--accent)}
.board-team .bf-section[data-tone="danger"]{--lane-role:var(--danger)}
/* A deck's head is the board's lane head, at the board's one weight. It pins to the page's
   scroll box, because these are the tab's landmarks. */
.board-team .bf-section__cap{position:sticky;top:0;z-index:1;align-items:center;gap:var(--space-2);padding-bottom:var(--space-1);border-bottom:2px solid var(--lane-role,var(--border));background:var(--canvas);color:var(--text)}
/* A head's dot: the lane's own glyph, in the lane's role — the one mark on the page. */
.board-team .bf-section__cap .bf-lane__dot{font-size:9px;line-height:1;color:var(--lane-role,var(--muted))}
/* A card. Not the board's note — that one is a lane's, below — but the same block: paper,
   corners, padding, and the gap as the only thing between two of them. */
.board-team .bf-row:not(.board-row):not(.board-agent){display:flex;flex-wrap:wrap;align-content:center;align-items:center;gap:var(--space-1) var(--space-2);min-width:0;padding:var(--team-pad);background:var(--paper);border:0;border-radius:var(--radius-md);cursor:pointer}
.board-team .bf-row:not(.board-row):focus-visible{outline:2px solid var(--accent)}
/* A person is two columns — the monogram, then everything else — so it keeps its own grid. */
.board-team .bf-row.board-agent{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start}
/* A lane head inside a swimlane is a deck head one level down: the same dot, no rule of its
   own, because the deck above it already carries the line. */
.board-team .bf-lane__head{border-bottom:0;margin:0;font:var(--fw-semibold) var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-team__grid{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr) minmax(0,20rem);gap:var(--space-5);align-items:start;min-width:0}
.board-team__column{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.board-team__empty{margin:0;font:var(--fs-sm)/var(--lh-relaxed) var(--font-ui);color:var(--muted)}
.board-team__skeleton{height:4.5rem;border-radius:var(--radius-md);background:var(--raised)}

/* PEOPLE — one card per session: who it is, what it holds, and what it owes. The paper is the
   session's state, so a column of people reads before a word is: the quiet plane for a free
   session, the accent for one mid-turn, the refusal for one that is gone. */
.board-team__agents{display:flex;flex-direction:column;gap:var(--space-2);margin:0;padding:0;list-style:none}
.board-agent{--paper:var(--raised);display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;border:0;border-radius:var(--radius-md);padding:var(--team-pad);background:var(--paper)}
.board-agent[data-state="working"]{--paper:var(--accent-soft)}
.board-agent[data-state="gone"]{--paper:var(--danger-soft)}
.board-agent[data-state="quiet"] .board-agent__name{color:var(--muted)}
.board-agent[data-lead="1"] .board-agent__monogram{background:var(--accent);color:var(--on-accent)}
.board-agent__body{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.board-agent__head{display:flex;align-items:center;gap:var(--space-2);min-width:0}
/* Two letters, in the mono face: a monogram is identity, the note's number in the place a
   name lives, so it stays where the board's card keeps its id. */
.board-agent__monogram{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-width:1.5rem;height:1.5rem;padding:0 var(--space-1);background:var(--accent-soft);color:var(--accent);font:var(--fw-semibold) var(--fs-xs) var(--font-ui);text-transform:uppercase}
.board-agent__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font:var(--fw-semibold) var(--fs-sm) var(--font-ui)}
/* The state is the card's foot's opposite end: a word beside a dot, never a colour alone. */
.board-agent__head .board-agent__state{margin-left:auto;flex:0 0 auto}
.board-agent__chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);font:var(--fs-xs) var(--font-ui)}
.board-agent__state{display:inline-flex;align-items:center;gap:var(--space-1);color:var(--muted);font-variant-numeric:tabular-nums}
.board-agent__mail{color:var(--accent);font-variant-numeric:tabular-nums}
/* What the session holds is the card's body: one line per card, the lane as a mark beside it. */
.board-team__missions{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.board-team__mission,.board-team__none{display:flex;align-items:center;gap:var(--space-2);min-width:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
.board-team__mission-ref{color:var(--text)}
.board-team__mission-age{margin-left:auto;color:var(--dim);font-variant-numeric:tabular-nums}
/* An age is a duration, not a phrase: tabular figures, so two rows' minutes line up. */
.board-stamp{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
/* A session holding nothing still draws the line its cards would — the same first-child edge a
   mission line's number sits on, since no bar stands in front of one now. */
.board-team__none{color:var(--dim)}
/* The one "there is more" control: the folded history card, a deck's tail, a queue's end. */
.board-fold{appearance:none;display:inline-flex;align-items:center;gap:var(--space-2);width:auto;margin:0;padding:0;min-height:24px;border:0;background:none;color:var(--muted);font:var(--fs-xs) var(--font-ui);text-align:left;cursor:pointer}
.board-fold:hover{color:var(--text)}

/* One dot for one state, wherever it is drawn: an agent's pill, a recipient, an owner. A record
   that is not there is a hollow ring, never a colour. */
.board-dot{flex:0 0 auto;width:8px;height:8px;background:var(--muted)}
.board-owner{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0;color:var(--muted)}
.board-dot[data-state="live"]{background:var(--success)}
.board-dot[data-state="quiet"]{background:var(--warn)}
.board-dot[data-state="gone"]{background:var(--danger)}
.board-dot[data-state="absent"],.board-dot[data-state="unknown"]{background:transparent;box-shadow:inset 0 0 0 1px var(--border-strong)}
/* A lane dot is a glyph in the lane's role, not a filled square. */
.board-dot[data-lane]{background:none;color:var(--lane-role,var(--muted))}

/* NEEDS YOU — the lead's queue as one column of asks: a band per addressee, a line per card, its
   reason printed underneath. An ask is not a card and no longer wears one: the row sits on the
   column's own ground and space is what separates it from the next, so the tone is left to the
   pill and a danger row's sentence, and a card drawn in the queue cannot read as a card drawn
   twice. An h4.bf-lane__head and a bf-lane__list are the kit's lane shapes one level down, and
   the queue's own indent is what says so: a band sits inside the queue, and the lane heads under
   it are the column's sections. */
.board-queue{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,32rem),1fr));align-items:start;column-gap:var(--space-4);row-gap:var(--space-3);min-width:0;padding-inline:var(--space-3)}
/* A wide window takes a band per column rather than one row a metre wide: a row is a line of
   facts read as one, and past about 32rem its title and its age are a screen apart. A band is
   what flows, never a row, so no band is left with its head in one column and its rows in the
   next. */
.board-queue__band{display:flex;flex-direction:column;min-width:0}
.board-queue__band .bf-lane__list{gap:var(--space-2)}
/* A band's tally sits beside the word it counts. A lane head pushes its count to the far edge,
   which is right for a lane that fills its column; two bands side by side would then put one
   band's count against the next band's name. */
.board-queue .bf-lane__head .bf-lane__count{margin-left:0}
/* Nothing to say still says it across the whole pane, whatever the window is: the sentence is the
   queue's own paragraph, not one band's row. */
.board-queue > .board-team__empty{grid-column:1 / -1}
/* One line, six cells, and the reason under the title: the grid is what makes two rows' facts
   line up, so a column of ids and a column of ages are columns. The pill's track is a minimum
   rather than a maximum so that every row's title starts at the same place — a row is its own
   grid, so a track that followed its content would move the title row by row. */
.board-queue__row{display:grid;grid-template-columns:2ch 4.5ch minmax(6rem,max-content) minmax(0,1fr) max-content 4.5ch;align-items:baseline;gap:var(--space-1) var(--space-2);min-width:0}
.board-queue__row > .board-stamp{justify-self:end;margin-left:0}
.board-queue__rank{color:var(--dim);font:var(--fs-xs) var(--font-mono);font-variant-numeric:tabular-nums}
.board-queue__ref{color:var(--muted);font:var(--fs-xs) var(--font-mono)}
/* The title is the row's one control, and one line of it: the whole of it is on the hover and in
   the dialog, and a queue whose rows are two titles tall is a queue a reader scrolls. */
.board-queue__row .bf-row__title{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;appearance:none;border:0;background:none;padding:0;text-align:left;cursor:pointer}
.board-queue__row .bf-row__title:hover{color:var(--accent)}
/* The sentence is the row's foot, under the title it belongs to and running to the row's edge: the
   id is a column of its own, and a sentence that stopped at the title's width would wrap where the
   facts beside it have nothing to say. */
.board-queue__why{grid-column:4 / -1;display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-2);margin:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
/* MOVING — the board's own card, in a lane one column narrower: the shape, the paper and the
   order come from the lane rules above, so this column is the board at a glance. */
.board-team__lanes{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}

/* MAIL and WHAT HAPPENED — one line each, one height, the age at the foot's edge. */
.board-team__pane-body{display:flex;flex-direction:column;gap:var(--space-1);min-width:0}
.board-team__waiting,.board-team__recent{display:flex;flex-direction:column;gap:var(--space-2);margin:0;padding:0;list-style:none}
.board-mail__body{min-width:0}
.board-mail,.board-event{flex-wrap:nowrap;align-items:baseline;min-height:var(--team-row-h);color:var(--muted);font:var(--fs-xs) var(--font-ui)}
.board-mail{--paper:var(--accent-soft)}
.board-event{--paper:var(--raised)}
.board-mail__from{max-width:9ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.board-mail__arrow{color:var(--dim)}
.board-mail__to{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0}
.board-event__ref{color:var(--muted);font-family:var(--font-mono)}
.board-event__what{min-width:0;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The row's own line is the fact: an event or a message is one line, so it never wraps. */
.board-mail > .bf-row__meta,.board-event > .bf-row__meta{display:flex;flex-wrap:nowrap;align-items:baseline;gap:var(--space-2);min-width:0}

/* The card dialog: the record of one card, as the questions a reader asks of it — what it
   promises, where to start, what it is tied to, what has happened, and what was said.
   Nothing here scrolls on its own — the kit's body is the one scrollbar. */
/* A little taller than the kit's default: this dialog is the only place a whole card —
   its facts, its plan, and every note it kept — can be read. */
.board-dialog__panel{width:min(720px,100%);max-height:84vh;background:var(--raised);box-shadow:var(--shadow-2)}
/* A long title wraps beside its id instead of pushing the close button off the head. */
.board-dialog__head{flex-wrap:wrap;align-items:baseline;row-gap:var(--space-1)}
.board-dialog__head h2{flex:1 1 12ch;min-width:0;font-size:var(--fs-lg);line-height:var(--lh-tight);overflow-wrap:anywhere}
.board-dialog__id{font:var(--fs-sm) var(--font-mono);color:var(--muted)}
.board-dialog__body{display:flex;flex-direction:column;gap:var(--space-4);padding-bottom:var(--space-4)}
.board-dialog__section{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
/* The heading is a label, not a headline: the title above it is the only headline here. */
.board-dialog__heading{display:flex;align-items:baseline;gap:var(--space-1);margin:0;padding-bottom:var(--space-1);border-bottom:1px solid var(--border);font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-dialog__count{font:var(--fs-xs) var(--font-ui);color:var(--dim)}
/* The ladder: labels size to the longest one in the section they belong to, values take the
   width that is left, and every row starts at the same column. */
.board-dialog__facts{display:grid;grid-template-columns:minmax(6.5rem,max-content) minmax(0,1fr);gap:var(--space-1) var(--space-3);margin:0;align-items:baseline}
.board-dialog__facts dt{font:var(--fs-xs) var(--font-ui);color:var(--muted)}
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
.board-dialog__sign{margin:0;max-width:68ch;font:var(--fw-medium) var(--fs-sm) var(--font-ui);color:var(--muted)}
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
.board-dialog__note-by{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-dialog__note-at{font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.board-dialog__state{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--fs-xs) var(--font-ui);color:var(--muted)}
/* A mission's lane is the one quiet word in its line: the label is the sentence's own case now,
   so the rule keeps only the colour that sets it back from the mission's text. */
.board-team__mission-lane{color:var(--dim)}
.board-dialog__state::before{content:"";width:var(--space-2);height:var(--space-2);background:var(--lane-role,var(--muted))}
/* The age beside the lane word is a duration, not a label: the lane is lowercase, its age is
   a number in the face the rest of the page's ages wear. */
.board-dialog__age{font-variant-numeric:tabular-nums;color:var(--muted)}

.board-skeleton{height:calc(var(--face-h) + var(--space-2) * 2);margin-bottom:var(--space-2);border-radius:var(--radius-md);background:var(--surface)}

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
  /* A phone keeps the title's width, and the rank is the one fact a narrow row can spare: the
     order is still the document's. */
  .board-queue__row{grid-template-columns:4.5ch minmax(6rem,max-content) minmax(0,1fr) max-content 4.5ch}
  .board-queue__rank{display:none}
  .board-queue__why{grid-column:3 / -1}
}
/* A phone has no room for six columns and no use for an elided title, so the row stops being a
   grid: the id, the pill and the age keep a line, the title takes the whole of the next one and
   wraps, and the reason follows it. The holder's dot is the one fact this width drops — the Agents
   column above names who holds what, and a reason names the owner whenever the name is the point
   ("bob is not running — the card is free"). */
@media (max-width:560px){
  .board-queue__row{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-2)}
  .board-queue__row .board-queue__ref{order:0}
  .board-queue__row > .bf-tag{order:1}
  .board-queue__row > .board-stamp{order:2;margin-left:auto}
  .board-queue__row .bf-row__title{order:3;flex:1 1 100%;white-space:normal}
  .board-queue__row > .board-owner{display:none}
  .board-queue__why{order:4;flex:1 1 100%}
}
/* Five lane names do not fit a phone: the tab rail wraps rather than a horizontal scroller
   that can hide the lane a reader is on. */
@media (max-width:420px){
  .board-picker{flex-wrap:wrap;gap:var(--space-1)}
  .board-picker .bf-tabs__item{border:1px solid var(--border);padding:5px 10px}
  .board-picker .bf-tabs__item[aria-pressed="true"]{border-color:var(--accent)}
}
@media (prefers-reduced-motion: reduce){
  .board-row,.board-queue__row,.board-lane{transition:none}
}
@media print{
  .board-lanes,.board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-row,.board-queue__row{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-picker{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
