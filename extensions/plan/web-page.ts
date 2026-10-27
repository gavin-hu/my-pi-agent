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
	brandLockup,
	docHead,
	type KeyHint,
	keysSheet,
	SIDEBAR_COLLAPSE_MAX,
	tabTitle,
	themeToggle,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../lib/web/index.ts";
import { keyRows, type KeySurface } from "./web-keys.ts";
import type { ReviewRole } from "./types.ts";
import type { ReviewPageData } from "./web-payload.ts";

// The island's two types live with the code that builds it (`web-payload.ts`); they are
// re-exported here because a page's data and the page's markup are read from the same
// imports in every caller, and two declarations of one island is how its halves drift.
export type { ReviewOutlineItem, ReviewPageData } from "./web-payload.ts";

/** Page styles: the shared base + theme + shell + components, then the review. */
export const REVIEW_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}
.review-share__list{list-style:none;margin:0 0 var(--space-3);padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.review-share__row{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-md)}
.review-share__url{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:var(--fs-sm) var(--font-mono);color:var(--text)}
.review-share__who{flex:0 0 auto;font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.review-share__who--bound{color:var(--accent)}
.review-share__actions{display:flex;flex:0 0 auto;gap:4px}
.review-share__actions .bf-btn{padding:1px 8px;font-size:var(--fs-xs)}
.review-share__qr{display:flex;justify-content:center;margin:0 0 var(--space-3)}
.review-share__qr svg{width:168px;height:168px;background:#fff;border-radius:var(--radius-md);padding:var(--space-1)}
.bf-review{--review-measure:1012px;--review-rail:26px;--review-gutter:34px;flex:1 1 auto;padding:var(--space-5) var(--space-6) 120px}
/* The document is one content column at GitHub's Markdown body width, with the
   comment rail inside it, so a plan reads the way the same file does on GitHub. */
/* Sticky header: identity, the connection/save chip, the actions, and a
   hairline reading-progress bar pinned to the header's bottom edge. */
.review-bar{align-items:center;gap:var(--space-2) var(--space-4)}
.review-bar .bf-brand{flex:0 0 auto}
.review-heading{display:flex;align-items:center;flex:1 1 240px;min-width:0;overflow:hidden;border-left:1px solid var(--border);padding-left:var(--space-4)}
.review-title{display:block;flex:1 1 auto;min-width:8ch;font-size:var(--fs-lg);font-weight:var(--fw-semibold);line-height:var(--lh-tight);color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-state{flex:0 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-status{flex:0 0 auto;max-width:42ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-status:empty{display:none}
.review-controls{display:inline-flex;align-items:center;gap:var(--space-2);flex:0 0 auto}
.review-progress{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden}
.review-progress__fill{display:block;height:100%;width:0;background:var(--accent);transition:width var(--motion-fast) linear}
/* Review panel: the plan's review facts, the section outline, then the keys. */
.bf-app__body--single{grid-template-columns:minmax(0,1fr)}
.review-panel{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4) var(--space-4) var(--space-2)}
.review-facts{display:flex;flex-direction:column;gap:var(--space-2);padding-bottom:var(--space-3);border-bottom:1px solid var(--border)}
.review-fact{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);font-size:var(--fs-sm);color:var(--muted)}
.review-fact .bf-progress{color:var(--text)}
.review-fact .bf-progress__track{width:96px}
.review-fact__value{color:var(--text);font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.review-view{display:flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:var(--radius-md)}
.review-view .bf-btn{flex:1 1 auto;justify-content:center;padding:3px 8px;font-size:var(--fs-xs);border:0;background:none}
.review-view .bf-btn[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent);font-weight:var(--fw-semibold)}
.review-view .bf-btn:disabled{opacity:.5;cursor:default}
.review-nav{min-width:0}
.review-nav__title{margin:0;font:var(--fw-semibold) var(--fs-xs) var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.review-nav ul{list-style:none;margin:0;padding:0}
.review-nav a{display:flex;align-items:baseline;gap:var(--space-2);padding:4px 8px;border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-sm);line-height:var(--lh-snug)}
.review-nav a:hover{background:var(--accent-soft);color:var(--accent);text-decoration:none}
.review-nav a[aria-current="true"]{background:var(--accent-soft);color:var(--accent);font-weight:var(--fw-semibold)}
.review-nav__link{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-nav__count{flex:0 0 auto;min-width:18px;padding:0 5px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent);font:var(--fs-xs)/18px var(--font-mono);text-align:center}
.review-changed{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.review-nav .lvl-2 a{padding-left:18px}
.review-nav .lvl-3 a{padding-left:30px}
.review-nav .lvl-4 a,.review-nav .lvl-5 a,.review-nav .lvl-6 a{padding-left:42px}
.review-hints{margin:auto 0 0;padding-top:var(--space-3);color:var(--muted);font-size:var(--fs-xs);line-height:var(--lh-relaxed)}
.review-hints .bf-kbd{margin:0 1px}
/* The document: one measure, centred, with a comment rail in its left margin. */
.bf-review>.bf-block{position:relative;width:100%;max-width:var(--review-measure);margin:0 auto;padding:3px 8px 3px var(--review-gutter);border-radius:var(--radius-md);overflow-wrap:break-word}
.bf-block[id]{scroll-margin-top:88px}
.bf-block__rail{position:absolute;left:0;top:6px;display:flex;flex-direction:column;align-items:center;gap:6px;width:var(--review-rail)}
.bf-block__add{appearance:none;width:22px;height:22px;min-width:22px;padding:0;border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--surface);color:var(--muted);font:var(--fs-md)/1 var(--font-ui);cursor:pointer;opacity:0;transition:opacity var(--motion-fast) var(--motion-ease)}
.bf-block__add:hover{border-color:var(--accent);color:var(--accent)}
.bf-block:hover .bf-block__add,.bf-block:focus-within .bf-block__add,.bf-block--active .bf-block__add,.bf-block--commented .bf-block__add{opacity:1}
.bf-block__count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent);font:var(--fw-semibold) var(--fs-xs)/1 var(--font-mono)}
/* A block the last review did not hold: the one mark that says "read this line again". The
   rule sits at the text edge, inside the gutter the rail already reserves, so it cannot
   reflow the measure or collide with a comment badge. */
.bf-block[data-changed]{box-shadow:inset 2px 0 0 var(--accent)}
.bf-block:hover,.bf-block--active{background:var(--surface)}
.bf-block--active{box-shadow:inset 0 0 0 1px var(--border)}
.bf-block h1,.bf-block h2,.bf-block h3,.bf-block h4,.bf-block h5,.bf-block h6{margin:24px 0 8px;line-height:var(--lh-tight)}
.bf-block h1{font-size:var(--fs-xl);padding-bottom:6px;border-bottom:1px solid var(--border)}
.bf-block h2{font-size:var(--fs-lg);padding-bottom:4px;border-bottom:1px solid var(--border)}
.bf-block h3{font-size:17px}
.bf-block h4,.bf-block h5,.bf-block h6{font-size:var(--fs-base)}
.bf-block p{margin:11px 0;line-height:var(--lh-relaxed)}
.bf-block blockquote{margin:11px 0;padding:2px 14px;border-left:3px solid var(--border);color:var(--muted)}
.bf-block hr{border:0;border-top:1px solid var(--border);margin:22px 0}
.bf-block__li{display:flex;gap:8px;margin:4px 0;line-height:var(--lh-relaxed)}
.bf-block__marker{flex:0 0 auto;min-width:1.4em;color:var(--muted)}
.bf-block__marker--done{color:var(--success)}
.bf-block code{font-family:var(--font-mono);font-size:.9em;background:var(--surface);border-radius:var(--radius-sm);padding:.1em .35em}
.bf-block pre.bf-code{margin:11px 0;padding:var(--space-3) 0;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);font:var(--fs-code)/1.55 var(--font-mono);tab-size:4;flex:none}
.bf-block pre.bf-code code{background:none;border:0;padding:0;font-size:inherit}
.bf-block pre.bf-code .bf-code__line{display:block;padding:0 14px;white-space:pre;min-height:1.55em}
.review-table-wrap{margin:11px 0;overflow-x:auto}
.review-table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.review-table th,.review-table td{padding:6px 10px;border:1px solid var(--border);text-align:left;vertical-align:top}
.review-table th{background:var(--surface);color:var(--muted);font-weight:var(--fw-medium)}
/* Comment threads sit in the document flow, aligned with the block's text. */
.bf-comments{display:flex;flex-direction:column;gap:8px;width:100%;max-width:var(--review-measure);margin:0 auto 14px;padding-left:var(--review-gutter)}
.bf-comments:empty{display:none}
.bf-comments--orphans{margin-top:26px;padding:var(--space-3) 0 0 var(--review-gutter);border-top:1px dashed var(--border)}
.bf-comments--orphans>p{margin:0 0 8px;color:var(--muted);font-size:var(--fs-sm)}
.bf-comment{padding:var(--space-3) var(--space-4)}
.bf-comment__head{display:flex;align-items:center;gap:var(--space-2);margin-bottom:6px}
.bf-comment__label{font:var(--fw-semibold) var(--fs-xs) var(--font-mono);color:var(--warn);text-transform:uppercase;letter-spacing:.06em}
/* A reviewer's name is a name, not a label: keep its own capitalisation. */
.bf-comment__label--author{text-transform:none;letter-spacing:0}
/* A note a refinement carried off its own block: muted, because the complaint is the guess, not the text. */
.bf-comment__moved{font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 6px}
.bf-comment__spacer{flex:1 1 auto}
.bf-comment__actions{display:flex;gap:4px}
.bf-comment__actions .bf-btn{padding:1px 8px;font-size:var(--fs-xs)}
.bf-comment__quote{margin-bottom:6px;padding-left:8px;border-left:2px solid var(--border);color:var(--muted);font-size:var(--fs-sm);overflow-wrap:anywhere}
.bf-comment__body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:var(--lh-snug)}
.bf-composer{margin:0}
.bf-block--composing .bf-block__add{opacity:0}
@media (max-width:1180px){
.bf-app__body{grid-template-columns:1fr;align-content:start}
.bf-app__sidebar{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border)}
.review-panel{padding:var(--space-2) var(--space-4) var(--space-3)}
.review-facts{flex-direction:row;flex-wrap:wrap;gap:var(--space-3) var(--space-5);border-bottom:0;padding-bottom:0}
.review-nav__title{padding:0}
.review-nav ul{display:flex;flex-wrap:wrap;gap:2px}
.review-nav .lvl-2 a,.review-nav .lvl-3 a,.review-nav .lvl-4 a,.review-nav .lvl-5 a,.review-nav .lvl-6 a{padding-left:8px}
.review-hints{display:none}
}
@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){
.bf-review{padding:var(--space-4) 18px 80px}
.review-nav__title{display:none}
}
/* The controls are the widest thing in the bar — seven of them once a review can
   be shared — so the title moves to its own row while they still need a row of
   their own, rather than being squeezed to nothing beside it. */
@media (max-width:1120px){
.review-bar{align-items:flex-start}
.review-heading{flex:1 1 100%;order:3;border-left:0;padding-left:0;margin-top:var(--space-1)}
.review-controls{order:2;margin-left:auto}
.review-status{order:4;flex:1 1 100%;max-width:none;white-space:normal}
}
/* Below a phone's width the controls wrap instead of running off the page. */
@media (max-width:640px){
.review-controls{flex-wrap:wrap;justify-content:flex-end;max-width:100%}
.review-heading{gap:var(--space-2)}
.review-title{min-width:0}
}
@media (prefers-reduced-motion:no-preference){.bf-block{transition:background var(--motion-fast) var(--motion-ease)}}
@media (hover:none){.bf-block__add{opacity:1}}
/* On paper the document is the whole page: no comment rail to hover, no composer,
   no reading progress, and the comments stay with the blocks they belong to. */
@media print{
.bf-review{padding:0}
.bf-review>.bf-block{max-width:none;padding:0 0 6px}
.bf-block__rail,.bf-composer,.bf-block__add,.review-progress,.review-view{display:none}
/* A printed review is the whole plan, never the view the reader had on screen: the
   base layer's hidden rule is !important, so the un-hide has to be too, and a thread
   the filter hid on screen goes back under its block. */
.bf-block[hidden]{display:block!important}
.bf-comments[hidden]{display:flex!important}
.bf-block:hover,.bf-block--active{background:none;box-shadow:none}
.bf-comments{padding-left:0}
.bf-comment{break-inside:avoid}
}`.trim();

/**
 * The sidebar's one-line keyboard reminder. It names the keys a reviewer reaches
 * for first and defers to the shortcut sheet (`?`) for the rest, so the line does
 * not have to grow every time a binding is added.
 */
function reviewHints(role: ReviewRole, canApprove: boolean): string {
	const surface: KeySurface = { role, canApprove };
	const parts = keyRows(surface)
		.filter((row) => row.hint !== undefined)
		.map(
			(row) => `${row.keys.map((key) => `<kbd class="bf-kbd">${key}</kbd>`).join("/")} ${row.hint?.(surface) ?? ""}`,
		);
	return `<p class="review-hints">Press ${parts.join(", ")}.</p>`;
}

/** The shortcut sheet's rows: the same table the handler dispatches through. */
function reviewKeys(role: ReviewRole, canApprove: boolean): KeyHint[] {
	const surface: KeySurface = { role, canApprove };
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
 * Render the review page for `data`. The markup is a fixed shell; the client
 * fills every dynamic field, so this function is the only place that needs the
 * JSON-island escaping.
 */
export function renderReviewPage(data: ReviewPageData): string {
	const island = JSON.stringify(data).replace(/</g, "\\u003c");
	const hasOutline = data.outline.length > 0;
	const bodyClass = hasOutline ? "bf-app__body" : "bf-app__body bf-app__body--single";
	const outlinePanel = hasOutline
		? `<details class="bf-app__sidebar review-outline" open>
<summary class="bf-panel__summary">Sections</summary>
<div class="bf-panel review-panel">
${reviewFacts()}
<div class="review-view" role="group" aria-label="What to show" id="review-view">
<button type="button" class="bf-btn" data-view="all" aria-pressed="true">All</button>
<button type="button" class="bf-btn" data-view="changed" aria-pressed="false">Changed</button>
<button type="button" class="bf-btn" data-view="comments" aria-pressed="false">Comments</button>
</div>
<nav class="review-nav" aria-labelledby="outline-title"><p class="review-nav__title" id="outline-title">Sections</p><ul id="outline-list"></ul></nav>
${reviewHints(data.role, data.canApprove)}
</div>
</details>
`
		: "";
	// Approve is the decisive action, so it takes the primary button and the
	// owner's Save is demoted; a comment-only review has no approve button and
	// keeps Save primary. A reviewer's one write action is Post, and nothing on
	// their page closes the review or mints another link.
	const isOwner = data.role === "owner";
	const approveButton = data.canApprove
		? `
<button type="button" class="bf-btn bf-btn--primary" id="approve">Approve &amp; run</button>`
		: "";
	const saveControl = isOwner
		? `<button type="button" class="${data.canApprove ? "bf-btn" : "bf-btn bf-btn--primary"}" id="save">Save feedback</button>`
		: `<button type="button" class="bf-btn bf-btn--primary" id="post">Post comments</button>`;
	const closeControl = isOwner ? `<button type="button" class="bf-btn" id="cancel">Back to Pi</button>` : "";
	// Sharing belongs to the owner; a reviewer gets the name they comment under.
	const shareControl = isOwner
		? `<button type="button" class="bf-btn" id="share">Share</button>`
		: `<button type="button" class="bf-btn" id="reviewer-name" hidden></button>`;
	return `<!doctype html>
<html lang="en">
<head>
${docHead({ title: tabTitle("plan review", data.title), css: REVIEW_CSS })}
</head>
<body class="bf-app">
<a class="skip" href="#plan">Skip to the plan</a>
<header class="bf-app__header"><div class="bf-toolbar review-bar">
${brandLockup("plan review")}
<div class="review-heading">
<span class="review-title" id="plan-title">Plan review</span>
<span class="bf-chip bf-chip--accent review-state" id="review-state">Connecting&#8230;</span>
</div>
<span class="bf-status review-status" id="status" role="status" aria-live="polite"></span>
<div class="review-controls">
${themeToggle()}
<button type="button" class="bf-btn bf-btn--icon" id="shortcuts" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>${shareControl}${approveButton}${saveControl}${closeControl}
</div>
</div><div class="review-progress" aria-hidden="true"><span class="review-progress__fill" id="progress-fill"></span></div></header>
<div class="${bodyClass}">
${outlinePanel}<main class="bf-app__main bf-review" id="plan" aria-label="Plan"></main>
</div>
${keysSheet(reviewKeys(data.role, data.canApprove))}
${data.canApprove ? approveDialog() : ""}
${data.role === "owner" ? shareDialog() : nameDialog()}
<script type="application/json" id="review-data">${island}</script>
<script src="/client.js" defer></script>
</body>
</html>
`;
}

/**
 * The review facts panel: the plan's step progress and total comment count.
 * Static placeholders; the client fills them from the blocks it rendered.
 */
function reviewFacts(): string {
	return `<div class="review-facts" id="review-facts">
<div class="review-fact" id="step-fact"><span>Steps</span><span class="bf-progress"><span class="bf-progress__track"><span class="bf-progress__fill" id="step-fill"></span></span><span class="review-fact__value" id="step-count">0/0</span></span></div>
<div class="review-fact"><span>Comments</span><span class="review-fact__value" id="comment-total">0</span></div>
</div>`;
}
