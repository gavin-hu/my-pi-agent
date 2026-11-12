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
import { BOARD_TONES } from "../../../lib/board/tone.ts";
import { WEB_BASE_CSS, WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS, WEB_THEME_CSS } from "../../../lib/web/index.ts";

/**
 * The width below which the board shows one lane at a time, with the picker that switches it.
 *
 * Exported, because the CSS media query and the client's two `matchMedia` calls are one
 * question: at 860 the picker arrived 320px after the lanes had started wrapping, and the
 * lanes below the first were pushed under an 11,000px column. A wrapped flex row is as tall as
 * its tallest child, so nothing but one lane at a time can keep them all above the fold.
 */
export const PICKER_MQ = 1180;

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
		`.board-card[data-lane="${lane}"] .board-card__id{color:var(--${role})}`,
		// The Team tab wears a lane the same way, on three different shapes: a mission line's
		// bar in an agent card, a swimlane's head dot, and a mission card's edge. Generated
		// from the table, so a lane added to `LANES` arrives coloured everywhere.
		`.board-team__mission[data-lane="${lane}"] .board-team__bar{background:var(--${role})}`,
		`.board-team__lane[data-lane="${lane}"] .board-team__lane-dot{background:var(--${role})}`,
		`.board-team__card[data-lane="${lane}"]{border-left-color:var(--${role})}`,
		`.board-team__dot[data-lane="${lane}"]{background:var(--${role})}`,
	];
}).join("\n");

/**
 * A reason line's colour, one rule per tone the tone table names.
 *
 * The card face picks a tone from the reason's kind; it never picks a class named after the
 * kind, so a card owing a spot-check is not drawn with a rule that says "unplanned".
 */
const REASON_TONE_CSS = BOARD_TONES.map((tone) => `.board-card__reason--${tone}{color:var(--${tone})}`).join("\n");

/**
 * A decision row's edge, one rule per tone the table names.
 *
 * Generated from the same table the terminal reads, so `gone` — ranked above `unwritten` — wears
 * the refusal colour by being classified, not by a rule somebody remembered to add.
 */
const DECISION_TONE_CSS = BOARD_TONES.map(
	(tone) => `.board-team__decision[data-tone="${tone}"]{border-left-color:var(--${tone})}`,
).join("\n");

/**
 * The one tone whose sentence is coloured too.
 *
 * A danger row is a refusal or a loss, and that is the row's whole point; a warn row is
 * somebody to ask, and colouring its sentence as well would spend the reader's attention on
 * the words rather than on the edge that says "look here".
 */
const DECISION_WHY_CSS = `.board-team__decision[data-tone="danger"] .board-team__why{color:var(--danger)}`;

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

/* Toolbar: identity, state, and the app's chrome; the bar under it carries the controls. */
.board-toolbar{gap:var(--space-3);flex-wrap:wrap}
/* The bar is the board's own control row: the view switch, the done meter, and the filter,
   with the filter pushed to the end of whatever room the row has. */
.board-bar{gap:var(--space-3)}
.board-filter{width:19rem}
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
.board-lane{--lane-count:0;display:flex;flex:1 1 0;flex-grow:calc(1 + min(3, var(--lane-count)));flex-direction:column;gap:var(--space-2);min-width:0;padding:0 var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
/* The lane count is a count, not a design token: the client sets it from the snapshot and
   declares its default here, so a lane whose count never arrived is an ordinary lane
   rather than a variable nobody defines. */
/* A lane's share of the row follows the work it holds — two cards earn more width than
   one — but only up to three shares: uncapped, a 64-card pool earned 65 of them, five
   lanes of work shared what was left, and Plan fell to its floor with every path in it
   elided. The floor is the narrowest a tray is still a tray at, and it is set on the two
   states that draw one, so a rail keeps its own width; both breakpoints above replace the
   basis, so the floor only ever applies to the row it was chosen for. */
.board-lane[data-empty="false"][data-folded="false"]{min-width:14rem}
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
${DECISION_TONE_CSS}
${DECISION_WHY_CSS}
.board-lane__list{display:flex;flex-direction:column;gap:var(--space-3);margin:0;padding:0;list-style:none}
.board-lane__empty{margin:0;font:var(--fs-sm) var(--font-ui);color:var(--muted)}

/* A card: the title, then the facts a reader needs to act on it. Its lane says which
   state it is in, and the id wears that lane's colour, so the card needs no second bar.
   The hover lifts nothing: the page cannot move a card, and a card that rises on the
   pointer reads as one you can pick up. */
.board-card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);cursor:pointer;transition:border-color var(--motion-fast) var(--motion-ease)}
.board-card:hover{border-color:var(--border-strong)}
.board-card[hidden]{display:none}
.board-card__head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-card__id{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.board-card__title{margin:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;font:var(--fw-semibold) var(--fs-base)/var(--lh-snug) var(--font-ui);color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.board-card__title:hover{color:var(--accent)}
/* Finished work recedes: it is history, and the live lanes should not compete with it. */
.board-card[data-lane="done"] .board-card__title{color:var(--muted)}
.board-card[data-lane="done"] .board-card__title:hover{color:var(--accent)}
.board-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
/* How much history the card carries and how recent it is: a count and a stamp, in the
   meta line's own voice, so a card with ten notes cannot look like one with none. */
.board-card__notes{display:inline-flex;align-items:baseline;gap:var(--space-1);font-variant-numeric:tabular-nums}
/* An order is a word beside the name rather than a second pill, so who holds a card and
   how urgent it is are two shapes a reader tells apart at a glance. */
.board-card__priority{font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.02em}
.board-card__priority--high{color:var(--warn)}
.board-card__priority--low{color:var(--dim)}
/* A kind is a label the card carries, not a state it is in: a quiet uppercase word, so the
   lane's dot, the priority's colour, and the reason's tone stay the only colour on the face,
   and the one pill on a row is still the person. The breaking marker rides inside the label,
   because feature · breaking is one statement about the kind. */
.board-kind{font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
/* The half a release must say out loud: the one word about a kind that earns a colour. */
.board-kind__breaking{color:var(--warn)}
.board-card__paths{display:flex;flex-wrap:wrap;gap:var(--space-1) var(--space-2);margin:0;padding:0;list-style:none}
/* A chip is one line and nowrap by design, so an owner label or a path longer than the card
   would spill past its border and across the lane beside it: clipped to the card instead,
   with the whole of it on the hover title the renderer sets. The list item has to be the one
   that shrinks, because a flex item's automatic minimum is its chip's width. */
.board-card__paths li{min-width:0;max-width:100%}
/* The +N marker is the row's trailing element, not another hint: pushed to the end, so a
   wrap never leaves it alone under the paths it counts. */
.board-card__more{margin-left:auto}
.board-card .bf-chip{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis}
/* A path is something a reader types, so it wears the mono face the dialog's ladder uses. */
.board-card__paths .bf-chip{font-family:var(--font-mono)}
/* The other half of a link — what leaving this card undone holds up — is drawn in this
   same paragraph after a middot: it is the same edge read from the other end, so it takes
   the reason's tone and no second row of its own. */
.board-card__reason{margin:0;font:var(--fs-sm)/var(--lh-snug) var(--font-ui);color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
/* The tone rules come *after* the base rule, and that is load-bearing: a tone class is one
   class and so is the base, so the later of two equal selectors wins. Generated before it,
   every tone was inert and a blocked card's reason drew muted — the one thing this table
   exists to stop. The pages suite pins the order, not just the rule's presence. */
${REASON_TONE_CSS}

/* Where the reader has been: j/k walks the drawn cards and wraps, so a lane walked and
   come back to looked exactly like a lane arriving for the first time. A read card keeps
   a quiet edge and the one the reader is on wears the accent one — after the hover rule,
   so the mark outlives the pointer that made it. */
.board-card[data-visited="true"]{box-shadow:inset 3px 0 0 var(--border-strong)}
.board-card[data-current="true"]{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}

/* The Team tab: three columns — who is here, what is moving, what arrived — each counting
   itself in a caption that sticks to the page's one scroll box. There is no nested scroll
   here on purpose: a column of agents beside a short middle column is one page, and three
   scrollbars inside a dashboard is the thing this tab exists not to be. */
.board-team{min-width:0}
.board-team__grid{display:grid;grid-template-columns:minmax(0,16rem) minmax(0,1fr) minmax(0,20rem);gap:var(--space-5);align-items:start;min-width:0}
.board-team__column{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
/* Sticky, because the agents list is the one that grows: the word a reader is scanning for
   must be over the rows wherever the page has been scrolled to. Offset by a hair so the
   hairline under it does not disappear into the shell's own border. */
.board-team__caption{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:var(--space-2);margin:0;padding:var(--space-2) 0;background:var(--canvas);border-bottom:1px solid var(--border);font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.board-team__count{margin-left:auto;padding:0 var(--space-2);border-radius:var(--radius-pill);background:var(--raised);color:var(--text);font-size:var(--fs-xs);font-variant-numeric:tabular-nums;letter-spacing:0}
.board-team__empty{margin:0;font:var(--fs-sm)/var(--lh-relaxed) var(--font-ui);color:var(--muted)}
.board-team__skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--surface)}

/* Left: the agents. A card per session, the lead's wearing the accent edge so the pinned row
   is also the one that looks pinned. */
.board-team__agents{display:flex;flex-direction:column;gap:var(--space-2);margin:0;padding:0;list-style:none}
.board-team__agent{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--raised);border:1px solid var(--border);border-radius:var(--radius-md);min-width:0}
.board-team__agent[data-lead="1"]{border-color:var(--accent)}
/* A dead session is drawn, not coloured: the dashed edge says "nobody is behind this". */
.board-team__agent[data-state="gone"]{border-style:dashed}
.board-team__agent-head{display:flex;align-items:center;gap:var(--space-2);min-width:0}
/* Two letters, in the mono face: a monogram is an identifier, and a label long enough to be
   elided still has these two to be recognised by. */
.board-team__monogram{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-width:1.5rem;height:1.5rem;padding:0 var(--space-1);border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent);font:var(--fw-semibold) var(--fs-xs) var(--font-mono);text-transform:uppercase}
.board-team__agent-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font:var(--fw-semibold) var(--fs-sm) var(--font-ui)}
.board-team__agent-chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);font:var(--fs-xs) var(--font-ui)}
/* The state pill is a word beside a dot, never a colour alone: quiet is the state a lead acts
   on and the one a reader must be able to say out loud. */
.board-team__state{display:inline-flex;align-items:center;gap:var(--space-1);color:var(--muted);font-variant-numeric:tabular-nums}
.board-team__mail{color:var(--accent);font-variant-numeric:tabular-nums}
/* What the session is holding: one line per card, the lane as a bar beside it. */
.board-team__missions{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.board-team__mission,.board-team__none{display:flex;align-items:center;gap:var(--space-2);min-width:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
.board-team__bar{flex:0 0 auto;align-self:stretch;width:2px;border-radius:var(--radius-pill);background:var(--muted)}
.board-team__mission-ref{color:var(--text);font-family:var(--font-mono)}
.board-team__mission-lane{text-transform:lowercase}
.board-team__mission-age{margin-left:auto;color:var(--dim);font-variant-numeric:tabular-nums}
/* An age is a duration, not a phrase: tabular figures, so two rows' minutes line up, and it
   sits at the row's edge where the eye compares them. */
.board-team__stamp{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
/* An agent holding nothing still draws a mission row, without its bar: the column keeps its
   rhythm, and the words sit where the mission lines do. */
.board-team__none{padding-left:calc(2px + var(--space-2));color:var(--dim)}
.board-team__agent-fold{display:flex;align-items:center;gap:var(--space-2);width:100%;margin:0;padding:0;min-height:24px;appearance:none;border:0;background:none;color:var(--muted);font:var(--fs-xs) var(--font-ui);text-align:left;text-decoration:underline dotted;text-underline-offset:3px;cursor:pointer}
.board-team__agent-fold:hover{color:var(--text)}

/* One dot for one state, wherever it is drawn: an agent's pill, a waiting row's recipient, a
   mission card's owner. A record that is not there is a hollow ring, never a colour. */
.board-team__dot{flex:0 0 auto;width:8px;height:8px;border-radius:var(--radius-pill);background:var(--muted)}
.board-team__dot[data-state="live"]{background:var(--success)}
.board-team__dot[data-state="quiet"]{background:var(--warn)}
.board-team__dot[data-state="gone"]{background:var(--danger)}
.board-team__dot[data-state="absent"],.board-team__dot[data-state="unknown"]{background:transparent;box-shadow:inset 0 0 0 1px var(--border-strong)}

/* Middle: the decisions strip, then the three lanes that move. */
.board-team__decisions{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
/* One card shape in this column: a decision row and a mission card are the same box — the fill
   one step off the page, a hairline, a 3px left edge, the same padding and radius — and differ
   only in what they have to say. Two fills and two title steps in one column was the page
   disagreeing with itself. */
.board-team__decision,.board-team__card{display:flex;flex-direction:column;gap:var(--space-1);padding:var(--space-2) var(--space-3);background:var(--raised);border:1px solid var(--border);border-left:3px solid var(--dim);border-radius:var(--radius-md);min-width:0}
.board-team__decision{transition:border-color var(--motion-base) var(--motion-ease)}
.board-team__decision:hover{border-color:var(--border-strong)}
/* Nobody holds it, so the edge is drawn but not filled: a shape, not a claim. */
.board-team__decision[data-kind="unassigned"]{border-left-style:dashed}
.board-team__open{display:flex;align-items:center;gap:var(--space-2);min-width:0;appearance:none;border:0;background:none;padding:0;color:var(--text);font:var(--fw-medium) var(--fs-sm) var(--font-ui);text-align:left;cursor:pointer}
.board-team__open:hover .board-team__title{color:var(--accent)}
.board-team__ref{flex:0 0 auto;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
/* Two lines, then the hover: a title is the one thing a reader must be able to read at both
   sizes, and one clamped line beside an id and a pill elided to two words. */
.board-team__title,.board-team__card-title{min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font:var(--fw-medium) var(--fs-sm)/var(--lh-snug) var(--font-ui);color:var(--text);text-align:left}
.board-team__why{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);margin:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
/* The lanes: a head that sticks under the column's caption, then the cards that fit. */
.board-team__lanes{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.board-team__lane{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.board-team__lane-head{display:flex;align-items:center;gap:var(--space-2);margin:0;padding-bottom:var(--space-1);border-bottom:1px solid var(--border);color:var(--muted);font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase}
.board-team__lane-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.board-team__lane-dot{width:var(--space-2);height:var(--space-2);border-radius:var(--radius-pill);background:var(--muted)}
.board-team__lane-count{padding:0 var(--space-2);border-radius:var(--radius-pill);background:var(--raised);color:var(--text);font-size:var(--fs-xs);font-variant-numeric:tabular-nums;letter-spacing:0}
.board-team__lane-empty{margin:0;color:var(--dim);font:var(--fs-xs) var(--font-ui)}
.board-team__lane-fold{appearance:none;border:0;background:none;padding:0;margin:0;min-height:24px;color:var(--muted);font:var(--fs-xs) var(--font-ui);text-align:left;text-decoration:underline dotted;text-underline-offset:3px;cursor:pointer}
.board-team__lane-fold:hover{color:var(--accent)}
/* One mission card per row: the column is narrow enough that two abreast elide both titles to
   a few words, and the card is where a reader decides who to ask. */
.board-team__swim{display:flex;flex-direction:column;gap:var(--space-2)}
.board-team__card-head{display:flex;align-items:baseline;gap:var(--space-2);margin:0;min-width:0}
.board-team__card-ref{flex:0 0 auto;color:var(--muted);font:var(--fs-xs) var(--font-mono)}
.board-team__card-title{appearance:none;border:0;background:none;padding:0;cursor:pointer}
.board-team__card-title:hover{color:var(--accent)}
.board-team__card-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);margin:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}

/* Right: what nobody has read, then what the cards say happened. */
.board-team__pane-body{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
.board-team__pane{display:flex;align-items:center;gap:var(--space-2);margin:0;color:var(--muted);font:var(--fw-semibold) var(--fs-xs) var(--font-ui);letter-spacing:.06em;text-transform:uppercase}
.board-team__pane-count{margin-left:auto;padding:0 var(--space-2);border-radius:var(--radius-pill);background:var(--raised);color:var(--text);font-size:var(--fs-xs);font-variant-numeric:tabular-nums;letter-spacing:0}
.board-team__waiting,.board-team__recent{display:flex;flex-direction:column;gap:var(--space-1);margin:0;padding:0;list-style:none}
/* A row is a queue entry, not a sentence: six short facts on one line, the age pushed to the
   edge where the eye compares them. */
.board-team__mail-row,.board-team__event{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1) var(--space-2);min-width:0;color:var(--muted);font:var(--fs-xs) var(--font-ui)}
.board-team__glyph{flex:0 0 auto;color:var(--muted)}
.board-team__mail-from{max-width:9ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.board-team__mail-arrow{color:var(--dim)}
.board-team__mail-to{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0}
.board-team__event-ref{color:var(--muted);font-family:var(--font-mono)}
.board-team__event-what{min-width:0;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* The card dialog: the record of one card, as the questions a reader asks of it — what it
   promises, where to start, what it is tied to, what has happened, and what was said.
   Nothing here scrolls on its own — the kit's body is the one scrollbar, so a reader is
   never inside a scroll inside a scroll. */
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
/* The ladder: labels size to the longest one in the section they belong to, values take the
   width that is left, and every row starts at the same column so the eye can run down the
   facts of one question at a time. The floor is the ladder's longest label, so a section of
   short ones still starts its values where the sections above it do. */
.board-dialog__facts{display:grid;grid-template-columns:minmax(6.5rem,max-content) minmax(0,1fr);gap:var(--space-1) var(--space-3);margin:0;align-items:baseline}
.board-dialog__facts dt{font:var(--fs-xs) var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.board-dialog__facts dd{margin:0;min-width:0;font:var(--fs-sm) var(--font-ui);color:var(--text)}
/* A path is a value like any other, but a long one elides on its single line and keeps the
   whole of itself on the hover title, so a 90-character plan cannot shred the ladder. */
.board-dialog__value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The card face's reason sentence, whole: the one fact that says what happens next, which a
   reader opens the card to act on. It wraps where the face clamps at two lines, and it reads
   at body size on the same measure as a note, because it is the same kind of sentence. */
.board-dialog__reason{margin:0;max-width:68ch;font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);color:var(--text);overflow-wrap:anywhere}
/* The contract is the promise, so its three lines read at body size and wrap inside their
   column: a promise clipped to one line is a promise a reader cannot check. The block keeps
   the ladder's own grid, so its labels sit in the same column as the facts beside them. */
.board-dialog__contract dd{font:var(--fs-base)/var(--lh-relaxed) var(--font-ui);overflow-wrap:anywhere}
/* Who signed it, under what they signed: quiet until a tone says otherwise. */
.board-dialog__sign{margin:0;max-width:68ch;font:var(--fw-medium) var(--fs-sm) var(--font-ui);color:var(--muted)}
/* The tone rules come after the base rules, which is what makes them win: a base class and a
   data-tone rule are one class each, so source order decides between them. */
${DIALOG_TONE_CSS}
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
/* The age beside the lane word is a duration, not a label: the lane is uppercase, its age is
   not, and a number is read in the face the rest of the page's ages wear. */
.board-dialog__age{font-variant-numeric:tabular-nums;letter-spacing:0;text-transform:none;color:var(--muted)}

.board-skeleton{height:4.5rem;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--surface)}

/* One lane at a time, from the width where five lanes stop fitting beside each other: the
   picker moves the board between them, and a wrapped row of traps is what buried three of them
   under the first. */
@media (max-width:${PICKER_MQ}px){
  .board-lanes{flex-direction:column;align-items:stretch}
  .board-lane{flex:1 1 auto}
  /* One lane at a time, so a rail buys nothing: the shown lane takes the column. */
  .board-lane[data-empty="true"],.board-lane[data-folded="true"]{flex:1 1 auto}
  .board-lane[hidden]{display:none}
  .board-picker{display:flex}
  /* Three columns need a wide window: below this the agents and the moving work share the
     row, and the activity rail drops beneath both. The caption stays sticky — it belongs to
     the page's one scroll box, wherever the column has been placed. */
  .board-team__grid{grid-template-columns:minmax(0,15rem) minmax(0,1fr)}
  .board-team__column[data-column="activity"]{grid-column:1 / -1}
}
@media (max-width:860px){
  .board-toolbar{gap:var(--space-2)}
  /* The filter takes the bar's last row whole, so the bar wraps once, on purpose, rather
     than leaving a search field stranded beside the switch. */
  .board-bar{gap:var(--space-2);padding:var(--space-2) var(--space-4)}
  .board-bar .bf-spacer{display:none}
  .board-filter{order:9;width:100%}
  /* One column: the tab is read top to bottom — who is here, what is moving, what arrived. */
  .board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-team__column[data-column="activity"]{grid-column:auto}
  /* A state can no longer sit on the card's line on a phone, so it wraps under the name. */
  .board-team__agent-head{flex-wrap:wrap}
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
}
@media print{
  .board-lanes,.board-team__grid{grid-template-columns:minmax(0,1fr)}
  .board-card{break-inside:avoid}
  /* The disclosure affordance goes; the lane's name stays with its count. */
  .board-filter,.board-picker{display:none!important}
  .board-lane__toggle::after{content:""}
}
`;
