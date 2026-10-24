/**
 * The browse pages' stylesheet: the shared Bytefly shell and components, then
 * the page-only `browse-*` rules layered on top.
 *
 * Kept apart from `html.ts` so the renderers stay a renderer and the CSS stays
 * findable as one block; the `bf-*` kit itself lives in `lib/web`.
 */

import {
	SIDEBAR_COLLAPSE_MAX,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../lib/web/index.ts";

/** The shared shell, components, and the page-only `browse-*` rules. */
export const BROWSE_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}
.browse-side{padding:var(--space-3)}
.browse-root{flex:1 1 auto;direction:rtl;text-align:left}
.browse-git{font-family:var(--font-mono)}
.browse-quick-open{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);width:100%;margin-bottom:var(--space-2);padding:6px var(--space-2);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);color:var(--muted);font:var(--fs-sm) var(--font-ui);cursor:pointer}
.browse-quick-open:hover{border-color:var(--accent);color:var(--accent)}
.browse-quick-open kbd{font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--dim)}
.browse-side__filters{display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)}
.browse-side__filters .bf-field{flex:1 1 auto;min-width:0}
.browse-side__filters .bf-btn{flex:0 0 auto;white-space:nowrap}
.browse-cat{width:16px;height:16px;flex:0 0 16px;color:var(--accent)}
.browse-cat.doc{color:var(--muted)}.browse-cat.img{color:var(--success)}.browse-cat.cfg{color:var(--warn)}.browse-cat.arc{color:var(--warn)}
.browse-heading{margin:0 0 var(--space-3);font-size:var(--fs-lg)}
.browse-listing th.bf-table__size,.browse-listing th.bf-table__when{text-align:right}
.browse-listing th.bf-table__size{width:96px}
.browse-listing th.bf-table__when{width:140px}
.browse-dotfile .bf-table__name a{opacity:.72}
.browse-broken{color:var(--muted);text-decoration:line-through}
.browse-link-mark{color:var(--muted);font-size:var(--fs-xs)}
body.palette-open{overflow:hidden}
.browse-diff{font-family:var(--font-mono);gap:5px}
.browse-diff:hover{color:var(--accent);text-decoration:none}
.browse-diff__dot{color:var(--warn);font-size:9px;line-height:1}
.browse-change{color:var(--warn);font-size:9px;line-height:1;flex:0 0 auto}
/* Live status: the connection chip keeps its own border and padding so a tone
   swap only changes the colour, and the footer line reads as one muted clause. */
.browse-live{font-family:var(--font-mono);border:1px solid currentColor;border-radius:var(--radius-pill);padding:2px 10px}
.browse-live__glyph{font-size:9px;line-height:1}
.browse-reload{border:1px solid currentColor;border-radius:var(--radius-pill);padding:2px 10px;cursor:pointer;font-family:var(--font-mono)}
.browse-reload:hover{text-decoration:underline}
.browse-live-line{color:var(--muted);font-variant-numeric:tabular-nums}
.browse-live-line::after{content:" · "}
.browse-diff-totals{font-family:var(--font-mono)}
.browse-diff-add{color:var(--success)}
.browse-diff-del{color:var(--danger)}
.browse-diff-scope{color:var(--muted);font-size:var(--fs-sm);font-weight:var(--fw-medium)}
.browse-diff-toolbar{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-3);flex-wrap:wrap}
.browse-diff-stat{margin:0 0 var(--space-3);font:var(--fs-xs)/1.5 var(--font-mono);color:var(--muted);white-space:pre-wrap;overflow-x:auto}
.browse-diff th.browse-diff-status{width:72px}
.browse-diff th.browse-diff-word{width:130px}
.browse-diff-badge{display:inline-block;min-width:16px;text-align:center;font:var(--fw-semibold) var(--fs-xs) var(--font-mono);border-radius:var(--radius-sm);padding:1px 5px;border:1px solid var(--border)}
.browse-diff-badge--M{color:var(--warn);border-color:currentColor}
.browse-diff-badge--A,.browse-diff-badge--Q{color:var(--success);border-color:currentColor}
.browse-diff-badge--D{color:var(--danger);border-color:currentColor}
.browse-diff-badge--R,.browse-diff-badge--C{color:var(--accent);border-color:currentColor}
.browse-diff-orig{color:var(--muted);font-size:var(--fs-xs)}
.browse-diff-word{color:var(--muted);font-size:var(--fs-sm)}
.browse-diff-no{display:inline-block;width:46px;padding-right:var(--space-2);text-align:right;color:var(--dim);user-select:none}
.browse-diff-sign{display:inline-block;width:16px;text-align:center;color:var(--muted);user-select:none}
.bf-diff-line--add{background:var(--success-soft)}
.bf-diff-line--add .browse-diff-sign{color:var(--success)}
.bf-diff-line--del{background:var(--danger-soft)}
.bf-diff-line--del .browse-diff-sign{color:var(--danger)}
.bf-diff-line--hunk{color:var(--accent);background:var(--canvas)}
.bf-diff-line--meta{color:var(--muted)}
.bf-diff-line--note{color:var(--muted);font-style:italic}
/* A hunk header pins to the top of the diff viewport while its body scrolls.
   Each hunk is a section so the pinned header is bounded by its own body and
   cannot stack on the next one. */
.bf-diff-hunk{display:block}
.bf-diff .bf-diff-line--hunk{position:sticky;top:0;z-index:1}
/* Reading progress, pinned to the sticky header's bottom edge. */
.browse-progress{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden}
.browse-progress__fill{display:block;height:100%;width:0;background:var(--accent);transition:width var(--motion-fast) linear}
/* File and diff pages: a measured reading column inside the card. */
/* The Markdown body fills the card, so the scroll box is the card's width: its
   scrollbar sits at the card edge. The measure lives on the blocks themselves:
   on .bf-md it would be a flex item with auto inline margins, which is
   shrink-to-fit, so a short document collapsed to its widest line. */
.browse-measure{--browse-measure:1012px}
.browse-measure .bf-md{--browse-gutter:max(0px,calc((100% - var(--browse-measure)) / 2));max-width:none;margin-inline:0;padding-inline:var(--space-5);padding-block:var(--space-4) var(--space-6)}
.browse-measure .bf-md>*{max-width:var(--browse-measure);margin-inline:auto}
/* Tables start at the prose column and take only the gutter to its right, so a
   wide window widens them without a dead band on their left. Code stays inside
   the measure with the rest of the prose. The frame is also the container a
   squeezed table asks about: it is the pane, not the window, that narrows one. */
.browse-measure .bf-md>.md-table-frame{max-width:none;padding-left:var(--browse-gutter);container-type:inline-size}
/* A table spans the reading column rather than stopping at its own content: a
   shrink-wrapped table leaves a ragged band beside itself — 254px on a 2560px
   screen, and 300px beside the three-column tables at 1440 — which the reader
   cannot tell from a column that failed to draw. The card is wider than the text
   it holds, so the measure is the ceiling: a table ends where the prose does, and
   below the floor's threshold the minimum still wins and the wrapper scrolls. */
.browse-measure .bf-md .md-table-frame table{width:100%;max-width:var(--browse-measure)}
/* In a pane this narrow, auto layout gives the prose cell whatever an unbreakable
   code span leaves — one word per line, and a four-column table read as a
   300px-tall row. A floor on the cells makes the table wider than the pane
   instead, so every column keeps a readable width and the wrapper scrolls them;
   a table that still fits is left as it was. */
@container (max-width:600px){
.browse-measure .bf-md .md-table-frame td{min-width:14em}
}
/* A table wider than the pane scrolls, but an overlay scrollbar is invisible
   until it moves; a gradient on the frame marks the columns still out of view.
   It has to be the frame: the scroller clips its own content, so a pseudo-element
   inside it would scroll away with the table. */
.browse-measure .bf-md>.md-table-frame.browse-table-more::after{content:"";position:absolute;top:0;right:0;bottom:0;width:40px;pointer-events:none;background:linear-gradient(to left,var(--surface) 12%,transparent)}
.bf-card__meta{font-variant-numeric:tabular-nums}
.browse-diff-summary{font-family:var(--font-mono);white-space:nowrap}
.browse-diff-summary .browse-diff-add{color:var(--success)}
.browse-diff-summary .browse-diff-del{color:var(--danger)}
.browse-hunks{color:var(--muted)}
/* Wide screens: pin quick open and the filter, and scroll the tree on its own
   box. The sidebar is a details element, whose content sits in an anonymous
   wrapper with no definite height, so the panel fills the sidebar by absolute
   positioning; below the sidebar breakpoint the disclosure keeps normal page
   scroll. */
@media not (max-width:${SIDEBAR_COLLAPSE_MAX}px){
.browse-sidebar{position:relative;overflow:hidden}
.browse-side{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
.browse-side .bf-tree{flex:1 1 auto;min-height:0;overflow:auto}
}
@media (max-width:820px){
.browse-root{order:9;flex:1 1 100%}
}
@media (max-width:520px){
.bf-toolbar .bf-theme-toggle{margin-left:auto}
/* A phone has no room for four button rows above the file: the actions keep one
   line and scroll instead, so the document starts where it should. A control
   keeps its own width — shrunk, a label wraps and a segmented control clips. */
.bf-card__actions{max-width:100%;flex-wrap:nowrap;overflow-x:auto}
.bf-card__actions>*{flex:0 0 auto}
/* A trailing date or one-word change state costs the column a reader is choosing
   between: at 390px the listing gave the name 106px and every entry truncated,
   and the diff gave a path 140px while "modified" held 130. */
.browse-listing .bf-table__when,.browse-diff .browse-diff-word{display:none}
}
/* A printed page scrolls nothing: the card and its body open up, the pinned hunk
   header stops pinning, and the progress hairline belongs to the screen. */
@media print{
.bf-card{border:0}
.bf-card,.bf-app__main,.bf-code,.bf-md,.bf-diff,.browse-listing{height:auto!important;max-height:none!important;overflow:visible!important}
.bf-diff .bf-diff-line--hunk{position:static}
.browse-progress{display:none}
}`;
