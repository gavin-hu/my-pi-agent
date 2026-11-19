/**
 * HTML shell for the browser plan review (pure string building).
 *
 * The page is intentionally inert: it carries no plan text in its markup and
 * no inline script. Everything the review needs travels in one JSON data
 * island (`<script type="application/json">`), and `/client.js` renders it
 * with DOM text nodes, so plan- and comment-authored text is never parsed as
 * HTML. `<` is escaped in the island so a plan containing `</script>` cannot
 * close the tag.
 *
 * It shares the Bytefly shell, components, and syntax colours with
 * `file-browse` through `lib/web`; the server sets the CSP header, and the
 * page loads only same-origin scripts.
 */

import {
	appHead,
	baseAttribute,
	collapsedShell,
	docHead,
	type KeyHint,
	keysSheet,
	liveChip,
	pageFooter,
	pageSheet,
	reloadChip,
	SIDEBAR_COLLAPSE_MAX,
	tabTitle,
} from "../../lib/web/index.ts";
import { keyRows, type KeySurface } from "./web-keys.ts";
import type { ReviewRole } from "./types.ts";
import type { ReviewPageData } from "./web-payload.ts";

// The island's two types live with the code that builds it (`web-payload.ts`); they are
// re-exported here because a page's data and the page's markup are read from the same
// imports in every caller, and two declarations of one island is how its halves drift.
export type { ReviewOutlineItem, ReviewPageData } from "./web-payload.ts";

/**
 * Viewport width, at and below which the review's outline collapses above the review.
 *
 * The review keeps the shell's collapse at its own width: its outline is long and its document
 * needs the height, so the band arrives earlier than the shell's sidebar does on browse.
 */
export const PLAN_COLLAPSE_MAX = 1180;

/**
 * Viewport width, at and below which the control row folds sharing and closing behind one
 * control.
 *
 * The row holds four actions and a phone holds none of them comfortably: two are what a reader
 * came to do, and the other two can wait behind a menu that opens over the document rather than
 * growing a header that already owns 174px of the screen.
 */
export const MORE_ACTIONS_MAX = 640;

/** Page styles: the kit's four layers, then the review's own rules. */
export const REVIEW_CSS = pageSheet(
	`.review-share__list{list-style:none;margin:0 0 var(--space-3);padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.review-share__row{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md)}
.review-share__url{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--fs-sm) var(--font-mono);color:var(--text)}
.review-share__who{flex:0 0 auto;font:var(--fs-xs) var(--font-ui);color:var(--muted)}
.review-share__who--bound{color:var(--accent)}
.review-share__actions{display:flex;flex:0 0 auto;gap:4px}
.review-share__qr{display:flex;justify-content:center;margin:0 0 var(--space-3)}
.review-share__qr svg{width:168px;height:168px;background:#fff;border-radius:var(--radius-md);padding:var(--space-1)}
.bf-review{--review-measure:1012px;--review-rail:26px;--review-gutter:34px;flex:1 1 auto;padding:var(--space-5) var(--space-6) 120px}
/* The document is the kit's Markdown body: one prose vocabulary for every page that renders a
   file. Only its box is this page's — the measure comes from the blocks, which keep the comment
   rail in their gutter, and the scroll box stays the shell's main pane. */
.bf-review.bf-md{max-width:none;overflow-x:hidden;overflow-y:auto}
/* Sticky header: the kit's toolbar says who the page is of and how it is doing, and the
   control row under it holds the page's own actions (the kit's shape; see lib/web/README.md). */
/* The subject is the plan's title, so it is read from its head — the kit cuts a path's head
   because a path ends in the folder being read, and a title ends in nothing. */
.review-bar .bf-context--subject{direction:ltr;text-align:left}
/* The review's state sentence is longer than a stream's, so the pill may shrink inside the
   toolbar instead of overflowing it. */
.review-bar .bf-live{max-width:100%}
/* A status sentence shares the facts zone with the chips: it holds one line, keeps the head,
   and disappears when there is nothing to say. paintStatus replaces the class, so the page
   styles it through the toolbar rather than wearing a class of its own. */
.review-bar .bf-status{max-width:42ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-bar .bf-status:empty{display:none}
/* The page's own actions: the bar is the kit's, and the group sits under the header's chrome. */
.review-actions{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end;min-width:0}
/* The finish block: what this page's own decisions do, in the reader's role. One or two
   button names in the text colour, and the sentence around them quiet. */
.review-finish{margin:0;padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--muted);font-size:var(--fs-xs);line-height:var(--lh-snug)}
.review-finish strong{color:var(--text);font-weight:var(--fw-semibold)}
/* A reviewer's identity is a fact about them, not one of the page's actions: the name control
   wears the quiet chrome the toolbar gives a control that is not the page's own. */
.review-identity{display:flex;align-items:center;gap:var(--space-2)}
.review-identity .bf-btn--ghost{font-size:var(--fs-xs);color:var(--muted)}
.review-identity .bf-btn--ghost:disabled{opacity:1;color:var(--text)}
/* Review panel: the facts that role is owed, the view switch with its caption and count, the
   reader's finish block, the section outline, then the keys. */
.bf-app__body--single{grid-template-columns:minmax(0,1fr)}
.review-panel{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4) var(--space-4) var(--space-2)}
/* The rail is two parts: what a reader can still reach with the outline shut — the facts, the
   switch and its count, the finish block — and then the sections list they fold away. The shell
   collapses the sidebar into a band at 1180, so while the list owned the switch a folded list
   took the filter with it: the count then read as a shorter plan rather than a filtered one.
   The seam between the two is a real line: --border on the rail measures 1.05:1, which is the
   gap of nothing that let the heading read as a fourth segment of the switch. */
.review-outline{display:flex;flex-direction:column;min-width:0}
.review-panel--head{padding-bottom:var(--space-3);border-bottom:1px solid var(--border-strong)}
.review-outline .review-sections{display:flex;flex-direction:column;min-height:0}
.review-outline .review-sections>.review-panel+.review-panel{padding-top:var(--space-3)}
/* The kit's open glyph reads the sidebar's own open attribute; here the disclosure is the nested
   list, and above the collapse the summary is hidden either way. */
.review-outline .review-sections[open]>.bf-panel__summary::before{content:"\\25BE"}
/* The facts are the rail's state, so they lead it: the progress a reader is here to read is the
   first thing in the column, not a muted line under three lines of help. Both rows share one
   geometry — a whole label, a value flush right, and never a second line: the step group used
   to wrap alone at 260px, which drew a 51px row beside the comment's 20px one. */
.review-facts{display:flex;flex-direction:column;gap:var(--space-2)}
.review-fact{display:flex;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:var(--space-2);min-width:0;font-size:var(--fs-sm);color:var(--muted)}
/* The label is one word or two, never a column: squeezed by the value beside it, it broke
   "Plan steps" over two lines. It holds its line, and the value stays beside it. */
.review-fact>span:first-child{flex:0 0 auto;white-space:nowrap}
.review-steps{display:inline-flex;flex:0 0 auto;align-items:center;gap:var(--space-2);color:var(--text)}
/* Eight 6px pips, 2px apart (8 × 6 + 7 × 2 = 62px), instead of one 96px trough: the empty half is
   the part a reader could not see, so an unearned pip is drawn in --dim (4.69:1 on the rail) where
   the accent wash it replaced measured 1.08:1. The fill crosses a pip at the count's own width. */
.review-steps__track{display:inline-block;flex:0 0 auto;width:62px;height:6px;border-radius:var(--radius-badge);background-image:repeating-linear-gradient(90deg,var(--dim) 0 6px,transparent 6px 8px);overflow:hidden}
.review-steps__fill{display:block;height:100%;width:0;background-image:repeating-linear-gradient(90deg,var(--accent) 0 6px,transparent 6px 8px);transition:width var(--motion-fast) linear}
.review-fact__value{color:var(--text);font-family:var(--font-ui);font-variant-numeric:tabular-nums}
/* The switch is a filter over the plan, not a fourth segment of the outline: its caption names the
   document it redraws, the way the outline's own title names the sections. */
.review-view__label{margin:0;font:var(--fw-semibold) var(--fs-sm) var(--font-ui);color:var(--muted)}
.review-view{display:flex}
.review-view .bf-tabs__item{flex:1 1 auto;justify-content:center}
/* The page's switch fills its segment when pressed. The kit's tabs say it in colour and
   weight alone, which is the right quiet for three links; this control redraws the whole
   document, so the segment the reader pressed has to be findable at a glance. The label takes the
   token's own pair for an accent fill, --on-accent on --accent (5.19:1 light, 7.49:1 dark); the
   accent on the accent wash it replaced measured 4.27:1 under a 13px semibold word. */
.review-view .bf-tabs__item[aria-pressed="true"]{background:var(--accent);color:var(--on-accent)}
/* The count of what the view hid, beside the switch that hid it: a filtered plan that reads
   as a short one is the defect, and this is the fact that undoes it. */
.review-note{margin:0;color:var(--muted);font-size:var(--fs-xs);line-height:var(--lh-relaxed)}
.review-note:empty{display:none}
.review-nav{min-width:0}
.review-nav__title{margin:0;font:var(--fw-semibold) var(--fs-sm) var(--font-ui);color:var(--muted)}
.review-nav ul{list-style:none;margin:0;padding:0}
.review-nav a{display:flex;align-items:baseline;gap:var(--space-2);padding:4px 8px;border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-sm);line-height:var(--lh-snug)}
/* A hover is a wash beside the current row, not the current row's own paper: the accent wash marks
   what is selected, and the accent on it was the same 4.27:1 the pressed segment wore. */
.review-nav a:hover{background:var(--surface);color:var(--text);text-decoration:none}
.review-nav a[aria-current="true"]{background:var(--accent-soft);color:var(--text);font-weight:var(--fw-semibold)}
.review-nav__link{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-nav__count{flex:0 0 auto;min-width:18px;padding:0 5px;border-radius:var(--radius-badge);background:var(--accent-soft);color:var(--text);font:var(--fs-xs)/18px var(--font-ui);text-align:center}
/* A section that shrank since the last review: how many blocks it no longer holds. Same badge
   as the comment count, quieter, because it is a fact about the document rather than something
   to read. */
.review-nav__removed{flex:0 0 auto;min-width:18px;padding:0 5px;border-radius:var(--radius-badge);background:var(--accent-soft);color:var(--muted);font:var(--fs-xs)/18px var(--font-ui);text-align:center}
.review-changed{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.review-nav .lvl-2 a{padding-left:18px}
.review-nav .lvl-3 a{padding-left:30px}
.review-nav .lvl-4 a,.review-nav .lvl-5 a,.review-nav .lvl-6 a{padding-left:42px}
.review-hints{margin:auto 0 0;padding-top:var(--space-3);color:var(--muted);font-size:var(--fs-xs);line-height:var(--lh-relaxed)}
.review-hints .bf-kbd{margin:0 1px}
/* A comment field under 16px makes iOS zoom the whole page on focus. The kit's textarea inherits
   the document's body size, so this page names the one size a field on a phone needs. */
.bf-composer .bf-textarea,.bf-comment .bf-textarea{font-size:16px}
/* Sharing and closing are the two actions a narrow page can afford to put away — a comment in a
   served sheet is shipped text, so it names the role rather than a button's words. Above 640 the
   details is transparent, so the row is still every action it was; at and below it, the panel
   opens over the document rather than growing a header that already owns 174px of a phone. */
/* An open details is what makes its children laid out at all: a closed one hides them whatever
   their display, so the wide row keeps it open and the client shuts it on a phone. The pair inside
   it is a group of its own, so it carries the row's gap: as one display:contents child of the flex
   row the two buttons were a single anonymous item, and the gap landed beside the pair rather than
   between them. */
.review-more[open]{display:contents}
.review-more__summary{display:none}
.review-more__panel{display:flex;gap:var(--space-2)}
@media (max-width:${MORE_ACTIONS_MAX}px){
.review-more[open]{display:block;position:relative}
.review-more__summary{display:inline-flex;align-items:center;gap:var(--space-2)}
.review-more__summary::after{content:"\\25BE"}
.review-more>.review-more__panel{display:none}
.review-more[open]>.review-more__panel{display:flex;flex-direction:column;gap:var(--space-2);position:absolute;right:0;top:calc(100% + var(--space-2));z-index:2;min-width:190px;padding:var(--space-2);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--raised);box-shadow:var(--shadow-2)}
.review-more[open]>.review-more__panel .bf-btn{justify-content:flex-start}
}
/* The reader's shortcut switch: the sheet documents the keys, so its off state is a row
   under them rather than a setting elsewhere. The list dims; the buttons still act. */
.bf-keys__toggle{display:flex;align-items:center;gap:var(--space-2);margin:var(--space-2) 0 0;padding:var(--space-2) 0 0;border-top:1px solid var(--border);color:var(--muted);font:var(--fs-sm) var(--font-ui);cursor:pointer}
.bf-keys__toggle input{accent-color:var(--accent);margin:0}
.bf-keys--off{opacity:.55}
/* The document: one measure, centred, with a comment rail in its left margin. */
.bf-review>.bf-block{position:relative;width:100%;max-width:var(--review-measure);margin:0 auto;padding:3px 8px 3px var(--review-gutter);border-radius:var(--radius-md);overflow-wrap:break-word}
/* The kit gaps one list from the next, which would put a blank line between every two steps: a
   run is drawn item by block, so its items sit flush and the gap belongs to the item that ends
   the run. */
.bf-review>.bf-block[data-kind="list"]>ul,.bf-review>.bf-block[data-kind="list"]>ol{margin:0}
.bf-review>.bf-block[data-run-end]>ul,.bf-review>.bf-block[data-run-end]>ol{margin:0 0 1em}
.bf-block[id]{scroll-margin-top:88px}
.bf-block__rail{position:absolute;left:0;top:6px;display:flex;flex-direction:column;align-items:center;gap:6px;width:var(--review-rail)}
.bf-block__add{appearance:none;width:24px;height:24px;min-width:24px;padding:0;border:1px solid var(--border);border-radius:var(--radius-badge);background:var(--surface);color:var(--muted);font:var(--fs-md)/1 var(--font-ui);cursor:pointer;opacity:0;transition:opacity var(--motion-fast) var(--motion-ease)}
.bf-block__add:hover{border-color:var(--accent);color:var(--accent)}
.bf-block:hover .bf-block__add,.bf-block:focus-within .bf-block__add,.bf-block--active .bf-block__add,.bf-block--commented .bf-block__add{opacity:1}
.bf-block__count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:var(--radius-badge);background:var(--accent-soft);color:var(--accent);font:var(--fw-semibold) var(--fs-xs)/1 var(--font-ui)}
/* A block the last review did not hold: the one mark that says "read this line again". The
   rule sits at the text edge, inside the gutter the rail already reserves, so it cannot
   reflow the measure or collide with a comment badge. */
.bf-block[data-changed]{box-shadow:inset 2px 0 0 var(--accent)}
.bf-block:hover,.bf-block--active{background:var(--surface)}
.bf-block--active{box-shadow:inset 0 0 0 1px var(--border)}
/* Comment threads sit in the document flow, aligned with the block's text. */
.bf-comments{display:flex;flex-direction:column;gap:8px;width:100%;max-width:var(--review-measure);margin:0 auto 14px;padding-left:var(--review-gutter)}
.bf-comments:empty{display:none}
.bf-comments--orphans{margin-top:26px;padding:var(--space-3) 0 0 var(--review-gutter);border-top:1px dashed var(--border)}
.bf-comments--orphans>p{margin:0 0 8px;color:var(--muted);font-size:var(--fs-sm)}
/* The comment is the kit's record: its body, rail, label and quote are the kit's, and this page
   adds only what its own card carries — the head row its controls sit in, the badge a moved note
   wears, and the quiet plane a settled one takes. */
.bf-comment__head{display:flex;align-items:center;gap:var(--space-2);margin-bottom:6px}
/* A reviewer's name is a name, not a label: keep its own capitalisation. */
/* A note a refinement carried off its own block: muted, because the complaint is the guess, not the text. */
.bf-comment__moved{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--muted);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 6px}
.bf-comment__spacer{flex:1 1 auto}
/* A settled note dims its head and quote but keeps its body: the text is the record, and a
   quote is not stored, so fading the whole card would leave a reloaded note unreadable. */
.bf-comment--resolved .bf-comment__label,
.bf-comment--resolved .bf-comment__quote{opacity:.72}
.bf-comment--resolved .bf-comment__body{color:var(--muted)}
.bf-comment__resolved{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--success)}
.bf-comment__actions{display:flex;gap:4px}
/* A quote is read at the record's own line height, not the document's: it is one line of context. */
.bf-comment__body{line-height:var(--lh-snug)}
.bf-composer{margin:0}
.bf-block--composing .bf-block__add{opacity:0}
${collapsedShell(
	PLAN_COLLAPSE_MAX,
	`/* The band is one row shut: the fold owns the whole rail now, so its summary carries the state
   the rail showed above it — the pressed view and both counts — and one tap brings the head panel
   and the outline back. Sticky, because a long outline would otherwise scroll the only way to shut
   it off the top of the band. 44px is the touch target; the desk keeps its own rhythm because
   this rule lives in the collapse. */
.bf-app__sidebar .bf-panel__summary{min-height:44px;padding:0 var(--space-4);gap:var(--space-2);position:sticky;top:0;z-index:1;background:var(--raised);border-bottom:0}
.review-sections__name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-weight:var(--fw-medium)}
.review-band{display:flex;flex:0 0 auto;align-items:center;gap:var(--space-1)}
.review-band__chip{padding:0 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:var(--fs-xs)/20px var(--font-ui);font-variant-numeric:tabular-nums}
.review-band__chip:empty{display:none}
/* The view is the one chip that is a state rather than a count, so it wears the selected row's
   own paper: --text on --accent-soft, the pairing #731 moved the rail's labels onto. */
.review-band__chip--view{background:var(--accent-soft);font-weight:var(--fw-semibold)}
.review-panel{padding:var(--space-2) var(--space-4) var(--space-3)}
.review-facts{flex-direction:row;flex-wrap:wrap;gap:var(--space-3) var(--space-5)}
/* The disclosure names the outline, so the panel's own title would be the same word twice. */
.review-nav__title{display:none}
/* One section per row, indented by level: the flat wrap it replaces was a cloud of eight equal
   words with no hierarchy, and the desk's indents are the hierarchy the band was throwing away.
   The fold's own order is #731's — state, then the outline — under one sticky row, so opening it
   shows the state block and as much list as the capped band leaves, and scrolling the band moves
   the list up under the row that shuts it. */
.review-nav ul{display:block;margin:0}
.review-nav a{min-height:44px;padding-top:0;padding-bottom:0;align-items:center}
.review-hints{display:none}`,
)}
/* A tablet in landscape keeps the column at 1024 but not the mouse: the rows are the target a
   thumb needs whether the shell has collapsed or not. One rule, written where the desk's 26px
   rhythm is not — the base link row sets no min-height, so this only raises. */
@media (pointer:coarse){
.review-nav a{min-height:44px;padding-top:0;padding-bottom:0;align-items:center}
}
@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){
.bf-review{padding:var(--space-4) 18px 80px}
}
/* The toolbar keeps the kit's row at every width: the subject takes a row of its own when
   the line cannot hold it, and the page's actions stay in their own bar. */
@media (prefers-reduced-motion:no-preference){.bf-block{transition:background var(--motion-fast) var(--motion-ease)}}
@media (hover:none){.bf-block__add{opacity:1}}
/* On paper the document is the whole page: no comment rail to hover, no composer,
   no reading progress, and the comments stay with the blocks they belong to. */
@media print{
.bf-review{padding:0}
.bf-review>.bf-block{max-width:none;padding:0 0 6px}
.bf-block__rail,.bf-composer,.bf-block__add,.review-view,.review-note{display:none}
/* A printed review is the whole plan, never the view the reader had on screen: the
   base layer's hidden rule is !important, so the un-hide has to be too, and a thread
   the filter hid on screen goes back under its block. */
.bf-block[hidden]{display:block!important}
.bf-comments[hidden]{display:flex!important}
.bf-block:hover,.bf-block--active{background:none;box-shadow:none}
.bf-comments{padding-left:0}
.bf-comment{break-inside:avoid}
}`.trim(),
);

/**
 * The sidebar's one-line keyboard reminder. It names the keys a reviewer reaches
 * for first and defers to the shortcut sheet (`?`) for the rest, so the line does
 * not have to grow every time a binding is added.
 */
function reviewHints(role: ReviewRole, canApprove: boolean): string {
	const surface: KeySurface = { role, canApprove, hasCommentWalk: true, hasViewCycle: true };
	const parts = keyRows(surface)
		.filter((row) => row.hint !== undefined)
		.map(
			(row) => `${row.keys.map((key) => `<kbd class="bf-kbd">${key}</kbd>`).join("/")} ${row.hint?.(surface) ?? ""}`,
		);
	return `<p class="review-hints">Press ${parts.join(", ")}.</p>`;
}

/** The shortcut sheet's rows: the same table the handler dispatches through. */
function reviewKeys(role: ReviewRole, canApprove: boolean): KeyHint[] {
	const surface: KeySurface = { role, canApprove, hasCommentWalk: true, hasViewCycle: true };
	return keyRows(surface).map((row) => ({ keys: [...row.keys], label: row.label(surface) }));
}

/**
 * The approval confirmation. Approving leaves plan mode and runs the plan, which
 * cannot be undone from the page, so it is one deliberate dialog rather than the
 * header button's single click. The shared `bf-dialog` styles and the shared
 * dialog runtime supply the backdrop, the Tab trap, and `Esc`.
 */
function approveDialog(): string {
	return `<div class="bf-dialog" id="approve-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="approve-title">
<div class="bf-dialog__head"><h2 id="approve-title">Approve and run the plan?</h2></div>
<div class="bf-dialog__body"><p>Pi leaves plan mode and starts the work. The comments you added are saved with the plan.</p><p class="bf-dialog__hint">Choose <strong>Approve &amp; run</strong> to go ahead, or <strong>Cancel</strong> to keep reviewing.</p></div>
<div class="bf-dialog__actions"><button type="button" class="bf-btn" id="approve-cancel">Cancel</button><button type="button" class="bf-btn bf-btn--primary" id="approve-confirm">Approve &amp; run</button></div>
</div>
</div>`;
}

/**
 * The one confirmation the page's own actions share: Save, Post and Back to Pi open it while
 * the review has comments the file does not have. The client sets the title, sentence and
 * accept label per action; the cancel button is also the dialog's close, so Keep reviewing is
 * the safe default the runtime focuses.
 */
function confirmDialog(): string {
	return `<div class="bf-dialog" id="confirm-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
<div class="bf-dialog__head"><h2 id="confirm-title">Save and return?</h2></div>
<div class="bf-dialog__body"><p id="confirm-body"></p></div>
<div class="bf-dialog__actions"><button type="button" class="bf-btn" id="confirm-cancel">Keep reviewing</button><button type="button" class="bf-btn bf-btn--primary" id="confirm-accept">Save and return</button></div>
</div>
</div>`;
}

/**
 * The owner's Share dialog: one row per reviewer link, the QR of the link just
 * minted, and the two actions that change the set. The list is empty on purpose —
 * the client fills it after the server mints a token, so a link never travels in
 * the page source.
 */
function shareDialog(): string {
	return `<div class="bf-dialog" id="share-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="share-title">
<div class="bf-dialog__head"><h2 id="share-title">Share this review</h2><span class="bf-spacer"></span><button type="button" class="bf-btn" id="share-close">Close</button></div>
<div class="bf-dialog__body"><ul class="review-share__list" id="share-links"></ul><div class="review-share__qr" id="share-qr"></div><p class="bf-dialog__hint" id="share-note"></p></div>
<div class="bf-dialog__actions"><button type="button" class="bf-btn" id="share-stop">Stop sharing</button><button type="button" class="bf-btn bf-btn--primary" id="share-new">New link</button></div>
</div>
</div>`;
}

/** The reviewer's name dialog: one line, which the link keeps after the first post. */
function nameDialog(): string {
	return `<div class="bf-dialog" id="name-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="name-title">
<div class="bf-dialog__head"><h2 id="name-title">Your name</h2></div>
<div class="bf-dialog__body"><p>Your comments are signed with this name, and this link keeps it after your first post.</p><p class="bf-field"><input class="bf-input" id="name-input" maxlength="40" placeholder="alice" aria-labelledby="name-title"></p></div>
<div class="bf-dialog__actions"><button type="button" class="bf-btn" id="name-cancel">Cancel</button><button type="button" class="bf-btn bf-btn--primary" id="name-save">Save name</button></div>
</div>
</div>`;
}

/**
 * The finish block: one sentence naming the decisions this reader's role has, because the
 * buttons are the same weight and the difference was only ever in the docs. It sits in the
 * panel, not the sticky header: a taller header would hide the section an outline link just
 * jumped to.
 */
function finishBlock(role: ReviewRole, canApprove: boolean): string {
	// A viewer has no decision at all, so the sentence is about the page rather than about a
	// button: there is nothing to press, and saying what is absent is the only useful fact.
	if (role === "viewer")
		return `<p class="review-finish"><strong>View only</strong> — reading the plan in the browser. Open it again to keep up as the plan changes.</p>`;
	if (role === "reviewer")
		return `<p class="review-finish"><strong>Post comments</strong> signs them with your name and returns them to the plan.</p>`;
	if (canApprove)
		return `<p class="review-finish"><strong>Approve &amp; run</strong> runs the plan and returns these comments; <strong>Save feedback</strong> keeps planning.</p>`;
	return `<p class="review-finish"><strong>Save feedback</strong> returns these comments to the plan and keeps planning.</p>`;
}

/**
 * Render the review page for `data`. The markup is a fixed shell; the client
 * fills every dynamic field, so this function is the only place that needs the
 * JSON-island escaping.
 */
export function renderReviewPage(data: ReviewPageData): string {
	const island = JSON.stringify(data).replace(/</g, "\\u003c");
	const hasOutline = data.outline.length > 0;
	const bodyClass = hasOutline ? "bf-app__body" : "bf-app__body bf-app__body--single";
	// The panel is the reader's own. A reviewer is named there, sees what their comments are
	// signed with, and the comment count; the plan's step progress is the owner's and a
	// viewer's, because approval seeds it and a reader is reading the same steps. The switch
	// and the outline are the plan's, so every role gets them. A reviewer's name is a fact
	// about them, not one of the page's actions, so it lives here rather than in the control
	// bar.
	const identity =
		data.role === "reviewer"
			? `
<div class="review-identity"><button type="button" class="bf-btn bf-btn--ghost" id="reviewer-name" hidden></button></div>`
			: "";
	// The rail is one fold, not a head above a fold: a 1180-wide window used to spend 170px of its
	// band on chrome no reader could put away, so the head joined the outline inside the details.
	// The summary carries what the rail showed above it — the pressed view and both counts — which
	// is the row a shut band costs, and the chips are painted from `web-client.ts` beside the
	// rail's own facts. At the desk the summary is the kit's hidden element and the details is
	// open, so the rail is unchanged there.
	const outlinePanel = hasOutline
		? `<div class="bf-app__sidebar review-outline">
<details class="review-sections" id="review-sections" open>
<summary class="bf-panel__summary"><span class="review-sections__name">Sections</span><span class="review-band"><span class="review-band__chip review-band__chip--view" id="band-view">All</span><span class="review-band__chip" id="band-steps"></span><span class="review-band__chip" id="band-comments">0</span></span></summary>
<div class="bf-panel review-panel review-panel--head">
${reviewFacts(data.role)}
<p class="review-view__label" id="review-view-label">Show in the plan</p>
<div class="bf-tabs review-view" role="group" aria-labelledby="review-view-label" id="review-view">
<button type="button" class="bf-tabs__item" data-view="all" aria-pressed="true">All</button>
<button type="button" class="bf-tabs__item" data-view="changed" aria-pressed="false">Changed</button>
<button type="button" class="bf-tabs__item" data-view="comments" aria-pressed="false">Comments</button>
</div>
<p class="review-note" id="review-note" aria-live="polite"></p>
${finishBlock(data.role, data.canApprove)}${identity}
</div>
<div class="bf-panel review-panel">
<nav class="review-nav" aria-labelledby="outline-title"><p class="review-nav__title" id="outline-title">Sections</p><ul id="outline-list"></ul></nav>
${reviewHints(data.role, data.canApprove)}
</div>
</details>
</div>
`
		: "";
	// Approve is the decisive action, so it takes the primary button and the
	// owner's Save is demoted; a comment-only review has no approve button and
	// keeps Save primary. A reviewer's one write action is Post, and nothing on
	// their page closes the review or mints another link.
	const isOwner = data.role === "owner";
	const isViewer = data.role === "viewer";
	const approveButton = data.canApprove
		? `
<button type="button" class="bf-btn bf-btn--primary" id="approve" data-keyshortcut="a">Approve &amp; run</button>`
		: "";
	// A viewer's page writes nothing, so it gets no save control of either kind — and the bar
	// itself is left out below when every control in it is absent.
	const saveControl = isOwner
		? `<button type="button" class="${data.canApprove ? "bf-btn" : "bf-btn bf-btn--primary"}" id="save" data-keyshortcut="s">Save feedback</button>`
		: isViewer
			? ""
			: `<button type="button" class="bf-btn bf-btn--primary" id="post" data-keyshortcut="s">Post comments</button>`;
	const closeControl = isOwner
		? `<button type="button" class="bf-btn" id="cancel" data-keyshortcut="Escape">Back to Pi</button>`
		: "";
	// Sharing belongs to the owner; a reviewer's identity is a row in the panel.
	const shareControl = isOwner ? `<button type="button" class="bf-btn" id="share">Share</button>` : "";
	// Sharing and closing are the two actions a phone can afford to put behind one control: the
	// details is transparent above 640 (see REVIEW_CSS), so the wide row keeps both buttons, and
	// below it they open over the document instead of growing the header.
	const aside = `${shareControl}${closeControl}`;
	const moreControl =
		aside === ""
			? ""
			: `
<details class="review-more" id="review-more" open>
<summary class="bf-btn review-more__summary" aria-label="More actions">More</summary>
<div class="review-more__panel">${aside}</div>
</details>`;
	const controls = `${approveButton}${saveControl}${moreControl}`;
	// One name for the page, read from the role: a view is not a review, and the tab, the
	// toolbar lockup, and the section of the docs that explains it must not disagree.
	const pageName = isViewer ? "plan view" : "plan review";
	return `<!doctype html>
<html lang="en"${baseAttribute(data.base)}>
<head>
${docHead({ title: tabTitle(pageName, data.title), css: REVIEW_CSS, base: data.base })}
</head>
<body class="bf-app">
<a class="skip" href="#plan">Skip to the plan</a>
${appHead({
	product: pageName,
	subject: { id: "plan-title", label: data.title, title: data.path },
	facts: `${liveChip({ id: "review-state", label: "connecting\u2026" })}
${reloadChip({ title: isViewer ? "Reload to read the plan again" : "Reload to review the plan again" })}
<span class="bf-status" id="status"></span>
<p class="sr-only" id="review-announce" role="status" aria-live="polite"></p>`,
	controls: controls === "" ? undefined : controls,
	identityClass: "review-bar",
	controlsClass: "review-actions",
})}
<div class="${bodyClass}">
${outlinePanel}<main class="bf-app__main bf-review bf-md" id="plan" aria-label="Plan"></main>
</div>
${pageFooter({ facts: `plan ${data.path}` })}
${keysSheet(reviewKeys(data.role, data.canApprove))}
${isViewer ? "" : confirmDialog()}
${data.canApprove ? approveDialog() : ""}
${data.role === "owner" ? shareDialog() : data.role === "reviewer" ? nameDialog() : ""}
<script type="application/json" id="review-data">${island}</script>
<script src="${data.base}/client.js" defer></script>
</body>
</html>
`;
}

/**
 * The review facts panel: the step progress an owner or a viewer is owed — approval is what
 * an owner's list is seeded from, and a viewer is reading the same steps — and the comment
 * total every role is. Static placeholders; the client fills them from the blocks it
 * rendered and skips a fact the markup does not carry.
 */
function reviewFacts(role: ReviewRole): string {
	const steps =
		role === "reviewer"
			? ""
			: `
<div class="review-fact" id="step-fact"><span>Plan steps</span><span class="review-steps"><span class="review-steps__track"><span class="review-steps__fill" id="step-fill"></span></span><span class="review-fact__value" id="step-count">0/0</span></span></div>`;
	return `<div class="review-facts" id="review-facts">${steps}
<div class="review-fact"><span>Comments</span><span class="review-fact__value" id="comment-total">0</span></div>
</div>`;
}
