/**
 * The review page's own stylesheet, appended after the kit's four layers.
 *
 * The diff body is `lib/diff`'s markup, so its rules live here: a page that
 * draws `renderDiffLines` supplies the `.bf-diff-line*` and `.browse-diff-*`
 * rules, exactly as `file-browse` does. Everything else is `rv-` — this page's
 * sidebar, file section, thread and composer placement — or a kit class the kit
 * already rules.
 */

import { collapsedShell } from "../../../lib/web/index.ts";

/**
 * The breakpoint the rail folds at, in px.
 *
 * Read by the sheet and by the page's own capture, so a shot at the fold and a
 * rule in the CSS cannot disagree about where it is.
 */
export const REVIEW_NARROW_PX = 900;

export const REVIEW_CSS = `
/* The sidebar is the kit's: a <details> that folds into a band at this page's own width, and a
   panel that scrolls on its own box rather than as a flex child of it (lib/web/README.md). */
.rv-sidebar{position:relative;overflow:hidden}
.rv-side{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
/* The panel's head: the search, the view switch, and the line saying what the switch hides.
   Three stacked pieces, and no borrowed control-row rule — the kit's plain field spans the
   panel, so it sits flush on both edges. */
.rv-side-top{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border)}
.rv-count{align-self:flex-start}
.rv-side-scroll{overflow:auto;min-height:0;padding:var(--space-2)}
.rv-side__back{margin:0 0 var(--space-2)}
.rv-side-head{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-2) var(--space-2);color:var(--dim);font:var(--fw-medium) var(--fs-xs) var(--font-ui);text-transform:uppercase;letter-spacing:.06em}
.rv-side-head span:last-child{margin-left:auto;font-family:var(--font-mono);text-transform:none;letter-spacing:0}
/* How far the review has got, beside the totals and before them in the row: the same case the
   totals use, because it is a count and not a label. */
.rv-side-head .rv-progress{font-family:var(--font-mono);text-transform:none;letter-spacing:0}
.rv-files{display:flex;flex-direction:column;gap:var(--space-1)}
/* A rail row wears its state's paper: the board's rule, in a list. The paper and the mark's colour
   are the two marks the state gets — the left rule that used to be the third is gone (#817): one
   fact, one mark, and the row is a card rather than a tab. */
.rv-rail{--paper:var(--raised);--role:var(--muted);display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:var(--space-2);align-items:start;padding:var(--space-2) var(--space-3);border:1px solid transparent;border-radius:var(--radius-md);background:var(--paper);color:var(--text);text-decoration:none}
.rv-rail:hover{border-color:var(--border-strong);text-decoration:none}
.rv-rail[aria-current="true"]{background:var(--accent-soft);border-color:var(--accent)}
.rv-rail[data-state="commented"]{--paper:var(--search-soft);--role:var(--warn)}
.rv-rail[data-state="reviewed"]{--paper:var(--success-soft);--role:var(--success)}
.rv-rail__mark{font:var(--fw-semibold) var(--fs-xs)/1.7 var(--font-mono);color:var(--role)}
/* The name and its count share one line: the name takes what is left and ellipsizes, the count never
   wraps and never shrinks. Before #817 the count had a line of its own, and a row spent three. */
.rv-rail__line{display:flex;align-items:baseline;gap:var(--space-2);min-width:0}
.rv-rail__name{flex:1;min-width:0;font:var(--fw-semibold) var(--fs-sm)/1.4 var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The directory keeps its leaf in view: an rtl line box puts the ellipsis at the start, and
   the bdi isolates the path as the LTR text it is, so its own slashes stay where they were. */
.rv-rail__dir{display:block;direction:rtl;text-align:left;font:var(--fs-xs)/1.5 var(--font-mono);color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Font and colour only: a display here would beat the hidden attribute a zero count sets, and the
   empty box would keep the line the count was supposed to stop costing. */
.rv-rail__notes{flex:none;white-space:nowrap;font:var(--fs-xs)/1.5 var(--font-ui);color:var(--role)}
.rv-rail__meta{display:flex;gap:5px;font:var(--fs-xs)/1.5 var(--font-mono);font-variant-numeric:tabular-nums}
.rv-add{color:var(--success)}
.rv-del{color:var(--danger)}
.rv-main{padding:0;gap:0}
.rv-files-scroll{min-height:0}
/* The bar floats over the diff's bottom edge, so the last section carries the bar's height as room.
   Not the scrolling box itself: it is a flex child whose height is the line's, and padding-bottom
   on a flex child is spent inside that height, so the box would give back nothing to scroll. On
   the content it is room the diff can move through, and its last row clears the bar (#930). */
.rv-file:last-child{padding-bottom:var(--rv-bar-inset,0)}
.rv-banner{display:flex;align-items:center;gap:var(--space-2);margin:var(--space-3) var(--space-5) 0;padding:var(--space-2) var(--space-3);border-left:2px solid var(--warn);background:var(--search-soft);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-sm)}
.rv-banner b{color:var(--text)}
/* A comment this render has no row for: the diff moved under the line it named, so its thread
   cannot be drawn. The list is the only way to read it and the only way to delete it — and an
   undeletable draft is what keeps the page from closing. */
.rv-orphans{margin:var(--space-3) var(--space-5) 0;padding:var(--space-2) var(--space-3);border-left:2px solid var(--warn);background:var(--search-soft);border-radius:var(--radius-sm);font-size:var(--fs-sm)}
.rv-orphans__head{margin:0;color:var(--muted)}
.rv-orphans__list{display:flex;flex-direction:column;gap:var(--space-1);margin:var(--space-1) 0 0}
.rv-orphans__item{display:flex;align-items:baseline;gap:var(--space-2)}
.rv-orphans__ref{font-family:var(--font-mono);color:var(--muted)}
.rv-orphans__body{min-width:0;overflow-wrap:anywhere;color:var(--text)}
.rv-orphans__item .bf-btn{margin-left:auto}
.rv-file{margin-top:var(--space-4)}
/* The head is outside the diff's own scroll box, so the page is its scrollport: it pins while
   the reader scrolls the file, and a hunk jump lands below it (scroll-margin-top, measured). */
.rv-file__head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-5);background:var(--paper,var(--raised));border-bottom:1px solid var(--border)}
.rv-file[data-state="commented"] .rv-file__head{--paper:var(--search-soft);--role:var(--warn)}
.rv-file[data-state="reviewed"] .rv-file__head{--paper:var(--success-soft);--role:var(--success)}
.rv-file__mark{font:var(--fw-semibold) var(--fs-xs)/1.6 var(--font-mono);color:var(--role,var(--accent));border:1px solid currentColor;border-radius:var(--radius-sm);padding:0 4px}
.rv-file__path{font:var(--fw-semibold) var(--fs-sm)/1.5 var(--font-mono);min-width:0;overflow:hidden;text-overflow:ellipsis}
.rv-file__dir{color:var(--dim);font-weight:var(--fw-normal)}
.rv-file__stats{display:flex;gap:6px;font:var(--fs-xs)/1.5 var(--font-mono);font-variant-numeric:tabular-nums}
.rv-file__acts{display:flex;align-items:center;gap:var(--space-2);margin-left:auto;flex-wrap:wrap}
.rv-file__check{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:var(--fs-xs);cursor:pointer;white-space:nowrap}
.rv-file__note{margin:0;padding:var(--space-2) var(--space-5);color:var(--muted);font-size:var(--fs-sm);border-bottom:1px solid var(--border)}
.bf-diff{display:block;tab-size:4}
.bf-tag--mono{font-family:var(--font-mono);font-size:var(--fs-xs)}
.rv-diff{--rv-no:46px;--rv-gutter:108px;margin:0;padding:0;background:var(--canvas)}
/* A whole file's gutter: one number column and no sign, so the text starts one column in and the
   numbers stop offering a pick this page never wired. */
.rv-diff--file{--rv-gutter:calc(var(--rv-no) + var(--space-2))}
.rv-diff .bf-diff-hunk{display:block}
/* A line owns the gutter as a positioned column, so its text starts past it and a wrapped line
   hangs under the code it continues rather than at the left edge. A hunk head, a meta line, and a
   note have no gutter and take the whole row. */
.rv-diff .bf-diff-line{position:relative;display:block;white-space:pre;padding:0 var(--space-4) 0 var(--rv-gutter);min-height:1.55em}
.rv-diff .bf-diff-line--hunk,.rv-diff .bf-diff-line--meta,.rv-diff .bf-diff-line--note{padding-left:var(--space-4)}
.rv-diff .browse-diff-no{position:absolute;top:0;display:inline-block;width:var(--rv-no);padding-right:var(--space-2);text-align:right;color:var(--dim);user-select:none;cursor:pointer}
.rv-diff .browse-diff-no:nth-of-type(1){left:0}
.rv-diff .browse-diff-no:nth-of-type(2){left:var(--rv-no)}
.rv-diff--file .browse-diff-no{cursor:default}
.rv-diff .browse-diff-no:hover{color:var(--text);background:var(--accent-soft)}
/* The number the bar names is the one marked: a row that survives anchors to its new number, so a
   click on the old column still selects the row and the ref names the column the comment will use. */
.rv-diff .browse-diff-no[data-anchor="true"]{color:var(--accent);font-weight:var(--fw-semibold);background:var(--accent-soft)}
.rv-diff .browse-diff-sign{position:absolute;top:0;left:calc(var(--rv-no) * 2);display:inline-block;width:16px;text-align:center;color:var(--muted);user-select:none}
.rv-diff .bf-diff-line--add{background:var(--success-soft)}
.rv-diff .bf-diff-line--add .browse-diff-sign{color:var(--success)}
.rv-diff .bf-diff-line--del{background:var(--danger-soft)}
.rv-diff .bf-diff-line--del .browse-diff-sign{color:var(--danger)}
.rv-diff .bf-diff-line--hunk{color:var(--accent);background:var(--surface);scroll-margin-top:var(--rv-head-h,0px)}
.rv-diff .bf-diff-line--meta{color:var(--muted)}
.rv-diff .bf-diff-line--note{color:var(--muted);font-style:italic}
.rv-diff[data-wrap="true"] .bf-diff-line{white-space:pre-wrap;overflow-wrap:anywhere}
.rv-diff .bf-diff-line[data-picked="true"]{box-shadow:inset 2px 0 0 var(--accent);background:var(--accent-soft);z-index:1}
/* A thread is the page's width, not the diff's: it ends the row it follows. It names its own face
   because it sits inside that row's <code>, whose browser rule is a generic monospace — prose in a
   thread has to read like the composer it was typed in. */
.rv-thread{display:block;margin:0 var(--space-4) var(--space-1) 132px;max-width:820px;background:var(--raised);border-left:2px solid var(--accent);border-radius:var(--radius-md);font-family:var(--font-ui)}
.rv-thread .bf-comment{display:block;border:0;background:none;padding:var(--space-2) var(--space-3)}
.rv-thread .bf-comment__label{display:block;margin-bottom:2px}
.rv-thread .bf-comment__quote,.rv-thread .bf-comment__body{display:block}
/* The one thing in a thread that is code: the lines it quotes, in the face a diff line wears. */
.rv-thread .bf-comment__quote{font-family:var(--font-mono)}
.rv-thread[data-state="sent"]{border-left-color:var(--success);opacity:.86}
.rv-thread[data-parent]{margin-left:calc(132px + var(--space-5))}
.rv-compose{display:block;margin:0 var(--space-4) var(--space-1) 132px;max-width:820px;background:var(--raised);border:1px solid var(--accent);border-radius:var(--radius-md);overflow:hidden}
.rv-compose__area{display:block;width:100%;min-height:74px;resize:vertical;border:0;outline:0;background:transparent;color:var(--text);padding:var(--space-3);font:var(--fs-sm)/1.6 var(--font-ui);box-sizing:border-box}
.rv-compose__head{display:flex;align-items:baseline;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border);color:var(--muted);font-size:var(--fs-xs)}
.rv-compose__acts{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-top:1px solid var(--border)}
/* A draft carried across a moved diff says so on the composer it lands in. */
.rv-compose__note{margin-left:auto;color:var(--warn);font:var(--fs-xs)/1.4 var(--font-ui)}
.rv-selbar{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);display:none;align-items:center;gap:var(--space-2);padding:var(--space-2);background:var(--raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-2);z-index:60}
.rv-selbar[data-open="true"]{display:flex}
.rv-selbar__ref{font:var(--fs-sm)/1.5 var(--font-mono);color:var(--text);padding:0 var(--space-2);max-width:48vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:var(--space-2) var(--space-4);background:var(--raised);border:1px solid var(--border-strong);border-left:2px solid var(--success);border-radius:var(--radius-md);box-shadow:var(--shadow-2);z-index:70;font-size:var(--fs-sm);opacity:0;pointer-events:none;transition:opacity var(--motion-base) var(--motion-ease)}
.rv-toast[data-open="true"]{opacity:1}
/* The rail's own empty state and the pane's filter line: both say what a narrowed view hides. */
.rv-filter-note{margin:var(--space-3) var(--space-5) 0;padding:var(--space-2) var(--space-3);border-left:2px solid var(--accent);background:var(--accent-soft);border-radius:var(--radius-sm);color:var(--muted);font:var(--fs-sm)/1.5 var(--font-ui)}
.rv-filter-note .bf-btn{margin-left:var(--space-2)}
.rv-dialog-list{display:flex;flex-direction:column;gap:var(--space-2);max-height:52vh;overflow:auto}
.rv-dialog-item{border-top:1px solid var(--border);padding-top:var(--space-2)}
.rv-dialog-item:first-child{border-top:0;padding-top:0}
.rv-dialog-path{margin:0 0 2px;font:var(--fs-xs)/1.5 var(--font-mono);color:var(--dim)}
.rv-dialog-line{margin:0;font-size:var(--fs-sm);white-space:pre-wrap;overflow-wrap:anywhere}
/* The page rules the diff's line as one row, which is more specific than the kit's narrow
   wrap; below the fold a line wraps here too, because a path or a call is a fact the reader
   came for and an overlay scrollbar is no way to reach it. The attribute is the only owner of
   the fact (#814): absent or true wraps here, and only a reader's own "no" unwraps. */
${collapsedShell(
	REVIEW_NARROW_PX,
	`/* The band: the kit's summary row over a panel that scrolls under it. The panel is static
   here, so the sticky summary is not covered by the desk's absolutely positioned one. */
.rv-sidebar{display:flex;flex-direction:column;position:relative;max-height:50vh;overflow:hidden}
.rv-sidebar .bf-panel__summary{position:sticky;top:0;z-index:1;background:var(--raised);border-bottom:1px solid var(--border)}
.rv-side{position:static;flex:1 1 auto;min-height:0}
.rv-thread,.rv-compose{margin-left:var(--space-4);max-width:100%}
/* A reply sits one step in from the comment it answers. It is the only mark of depth, because one
   level is all the store holds: a reply to a reply is refused, not drawn deeper. */
.rv-thread[data-parent]{margin-left:calc(var(--space-4) + var(--space-5))}
.rv-diff:not([data-wrap="false"]) .bf-diff-line{white-space:pre-wrap;overflow-wrap:anywhere}`,
)}
`;
