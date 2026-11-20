/**
 * The review page's own stylesheet, appended after the kit's four layers.
 *
 * The diff body is `lib/diff`'s markup, so its rules live here: a page that
 * draws `renderDiffLines` supplies the `.bf-diff-line*` and `.browse-diff-*`
 * rules, exactly as `file-browse` does. Everything else is `rv-` — this page's
 * rail, file section, thread and composer placement — or a kit class the kit
 * already rules.
 */

/**
 * The breakpoint the rail folds at, in px.
 *
 * Read by the sheet and by the page's own capture, so a shot at the fold and a
 * rule in the CSS cannot disagree about where it is.
 */
export const REVIEW_NARROW_PX = 900;

export const REVIEW_CSS = `
/* The body is the rail and the diff. The kit's own body is a fixed 260px sidebar,
   which is the browse tree's width, not a review's. */
.rv-body{display:grid;grid-template-columns:300px minmax(0,1fr);flex:1 1 auto;min-height:0}
@media (max-width:${REVIEW_NARROW_PX}px){
  .rv-body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .rv-side{max-height:38vh;border-right:0;border-bottom:1px solid var(--border)}
  .rv-thread,.rv-compose{margin-left:var(--space-4);max-width:100%}
}
.rv-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--border);background:var(--surface)}
.rv-side-top{padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border)}
.rv-side-row{display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-2);flex-wrap:wrap}
.rv-side-scroll{overflow:auto;min-height:0;padding:var(--space-2)}
.rv-side-head{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-2) var(--space-2);color:var(--dim);font:var(--fw-medium) var(--fs-xs) var(--font-ui);text-transform:uppercase;letter-spacing:.06em}
.rv-side-head span:last-child{margin-left:auto;font-family:var(--font-mono);text-transform:none;letter-spacing:0}
.rv-files{display:flex;flex-direction:column;gap:var(--space-1)}
/* A rail row wears its state's paper: the board's rule, in a list. */
.rv-rail{--paper:var(--raised);--role:var(--muted);display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:var(--space-2);align-items:start;padding:var(--space-2) var(--space-3);border:1px solid transparent;border-left:2px solid var(--role);border-radius:var(--radius-md);background:var(--paper);color:var(--text);text-decoration:none}
.rv-rail:hover{border-color:var(--border-strong);border-left-color:var(--role);text-decoration:none}
.rv-rail[aria-current="true"]{background:var(--accent-soft);border-color:var(--accent);border-left-color:var(--accent)}
.rv-rail[data-state="commented"]{--paper:var(--search-soft);--role:var(--warn)}
.rv-rail[data-state="reviewed"]{--paper:var(--success-soft);--role:var(--success)}
.rv-rail__mark{font:var(--fw-semibold) var(--fs-xs)/1.7 var(--font-mono);color:var(--role)}
.rv-rail__name{font:var(--fw-semibold) var(--fs-sm)/1.4 var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-rail__dir{display:block;font:var(--fs-xs)/1.5 var(--font-mono);color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-rail__notes{display:block;margin-top:2px;font:var(--fs-xs)/1.5 var(--font-ui);color:var(--role)}
.rv-rail__meta{display:flex;gap:5px;font:var(--fs-xs)/1.5 var(--font-mono);font-variant-numeric:tabular-nums}
.rv-add{color:var(--success)}
.rv-del{color:var(--danger)}
.rv-main{padding:0;gap:0}
.rv-files-scroll{min-height:0}
.rv-banner{display:flex;align-items:center;gap:var(--space-2);margin:var(--space-3) var(--space-5) 0;padding:var(--space-2) var(--space-3);border-left:2px solid var(--warn);background:var(--search-soft);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-sm)}
.rv-banner b{color:var(--text)}
.rv-file{margin-top:var(--space-4)}
.rv-file__head{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-5);background:var(--paper,var(--raised));border-left:2px solid var(--role,var(--muted));border-bottom:1px solid var(--border)}
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
.rv-diff{margin:0;padding:0;background:var(--canvas)}
.rv-diff .bf-diff-hunk{display:block}
/* A line owns the two gutters as positioned columns, so its text starts past them and a
   wrapped line hangs under the code it continues rather than at the left edge. A hunk head,
   a meta line, and a note have no gutters and take the whole row. */
.rv-diff .bf-diff-line{position:relative;display:block;white-space:pre;padding:0 var(--space-4) 0 108px;min-height:1.55em}
.rv-diff .bf-diff-line--hunk,.rv-diff .bf-diff-line--meta,.rv-diff .bf-diff-line--note{padding-left:var(--space-4)}
.rv-diff .browse-diff-no{position:absolute;top:0;display:inline-block;width:46px;padding-right:var(--space-2);text-align:right;color:var(--dim);user-select:none;cursor:pointer}
.rv-diff .browse-diff-no:nth-of-type(1){left:0}
.rv-diff .browse-diff-no:nth-of-type(2){left:46px}
.rv-diff .browse-diff-no:hover{color:var(--text);background:var(--accent-soft)}
.rv-diff .browse-diff-sign{position:absolute;top:0;left:92px;display:inline-block;width:16px;text-align:center;color:var(--muted);user-select:none}
.rv-diff .bf-diff-line--add{background:var(--success-soft)}
.rv-diff .bf-diff-line--add .browse-diff-sign{color:var(--success)}
.rv-diff .bf-diff-line--del{background:var(--danger-soft)}
.rv-diff .bf-diff-line--del .browse-diff-sign{color:var(--danger)}
.rv-diff .bf-diff-line--hunk{color:var(--accent);background:var(--surface)}
.rv-diff .bf-diff-line--meta{color:var(--muted)}
.rv-diff .bf-diff-line--note{color:var(--muted);font-style:italic}
.rv-diff[data-wrap="true"] .bf-diff-line{white-space:pre-wrap;overflow-wrap:anywhere}
.rv-diff .bf-diff-line[data-picked="true"]{box-shadow:inset 2px 0 0 var(--accent);background:var(--accent-soft)}
/* A thread is the page's width, not the diff's: it ends the row it follows. */
.rv-thread{display:block;margin:0 var(--space-4) var(--space-1) 132px;max-width:820px;background:var(--raised);border-left:2px solid var(--accent);border-radius:var(--radius-md)}
.rv-thread .bf-comment{display:block;border:0;background:none;padding:var(--space-2) var(--space-3)}
.rv-thread .bf-comment__label{display:block;margin-bottom:2px}
.rv-thread .bf-comment__quote,.rv-thread .bf-comment__body{display:block}
.rv-thread[data-state="sent"]{border-left-color:var(--success);opacity:.86}
.rv-compose{display:block;margin:0 var(--space-4) var(--space-1) 132px;max-width:820px;background:var(--raised);border:1px solid var(--accent);border-radius:var(--radius-md);overflow:hidden}
.rv-compose__area{display:block;width:100%;min-height:74px;resize:vertical;border:0;outline:0;background:transparent;color:var(--text);padding:var(--space-3);font:var(--fs-sm)/1.6 var(--font-ui);box-sizing:border-box}
.rv-compose__head{display:flex;align-items:baseline;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border);color:var(--muted);font-size:var(--fs-xs)}
.rv-compose__acts{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-top:1px solid var(--border)}
.rv-selbar{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);display:none;align-items:center;gap:var(--space-2);padding:var(--space-2);background:var(--raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-2);z-index:60}
.rv-selbar[data-open="true"]{display:flex}
.rv-selbar__ref{font:var(--fs-sm)/1.5 var(--font-mono);color:var(--text);padding:0 var(--space-2);max-width:48vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rv-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:var(--space-2) var(--space-4);background:var(--raised);border:1px solid var(--border-strong);border-left:2px solid var(--success);border-radius:var(--radius-md);box-shadow:var(--shadow-2);z-index:70;font-size:var(--fs-sm);opacity:0;pointer-events:none;transition:opacity var(--motion-base) var(--motion-ease)}
.rv-toast[data-open="true"]{opacity:1}
.rv-empty{margin:var(--space-6) var(--space-5);padding:var(--space-5);border:1px dashed var(--border);border-radius:var(--radius-md);color:var(--muted)}
.rv-empty__title{margin:0;color:var(--text);font-weight:var(--fw-semibold)}
.rv-empty__sub{margin:var(--space-1) 0 0;font-size:var(--fs-sm)}
.rv-dialog-list{display:flex;flex-direction:column;gap:var(--space-2);max-height:52vh;overflow:auto}
.rv-dialog-item{border-top:1px solid var(--border);padding-top:var(--space-2)}
.rv-dialog-item:first-child{border-top:0;padding-top:0}
.rv-dialog-path{margin:0 0 2px;font:var(--fs-xs)/1.5 var(--font-mono);color:var(--dim)}
.rv-dialog-line{margin:0;font-size:var(--fs-sm);white-space:pre-wrap;overflow-wrap:anywhere}
/* The page rules the diff's line as one row, which is more specific than the kit's narrow
   wrap; below the fold a line wraps here too, because a path or a call is a fact the reader
   came for and an overlay scrollbar is no way to reach it. This sits after the diff rules so
   it wins at equal specificity. */
@media (max-width:${REVIEW_NARROW_PX}px){
  .rv-diff .bf-diff-line{white-space:pre-wrap;overflow-wrap:anywhere}
}
`;
