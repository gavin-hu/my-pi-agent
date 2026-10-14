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
	themeToggle,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../lib/web/index.ts";
import type { PlanBlock } from "./blocks.ts";
import type { PlanAnnotation } from "./feedback.ts";

/** A heading the outline can jump to. */
export interface ReviewOutlineItem {
	/** DOM id the client gives the heading. */
	id: string;
	/** 0-based source line. */
	line: number;
	/** Heading level, 1-6. */
	level: number;
	/** Heading text. */
	text: string;
}

/** Everything the browser needs to render one plan review. */
export interface ReviewPageData {
	/** Plan title, derived from the file name. */
	title: string;
	/** Path relative to the working directory, for the header. */
	relativePath: string;
	/** Source-line blocks of the feedback-stripped plan. */
	blocks: PlanBlock[];
	/** Feedback already stored in the file. */
	annotations: PlanAnnotation[];
	/** Step progress for the header. */
	steps: { done: number; total: number };
	/** Section outline, in document order. */
	outline: ReviewOutlineItem[];
	/** Highlighted HTML per line, keyed by the code block's 0-based start line. */
	code: Record<string, string[]>;
	/** Per-session secret the client echoes on every request. */
	token: string;
}

/** Page styles: the shared base + theme + shell + components, then the review. */
export const REVIEW_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}
.bf-review{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);align-items:start;column-gap:28px;padding:var(--space-5) var(--space-6) 96px}
.review-nav{min-width:0}
.review-nav ul{list-style:none;margin:0;padding:0}
.review-nav a{display:block;padding:4px 8px;border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-sm);line-height:var(--lh-snug);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-nav a:hover{background:var(--accent-soft);color:var(--accent);text-decoration:none}
.review-nav a[aria-current="true"]{background:var(--accent-soft);color:var(--accent);font-weight:var(--fw-semibold)}
.review-nav .lvl-2 a{padding-left:18px}
.review-nav .lvl-3 a{padding-left:30px}
.review-nav .lvl-4 a,.review-nav .lvl-5 a,.review-nav .lvl-6 a{padding-left:42px}
.bf-review>.bf-block{position:relative;padding:2px 0;border-radius:var(--radius-md)}
.bf-block[id]{scroll-margin-top:76px}
.bf-block:hover{background:var(--surface)}
.bf-block h1,.bf-block h2,.bf-block h3,.bf-block h4,.bf-block h5,.bf-block h6{margin:20px 0 8px;line-height:var(--lh-tight)}
.bf-block h1{font-size:24px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.bf-block h2{font-size:19px;padding-bottom:4px;border-bottom:1px solid var(--border)}
.bf-block h3{font-size:16px}
.bf-block p{margin:10px 0}
.bf-block blockquote{margin:10px 0;padding:2px 14px;border-left:3px solid var(--border);color:var(--muted)}
.bf-block__li{display:flex;gap:8px;margin:3px 0}
.bf-block__marker{flex:0 0 auto;min-width:1.4em;color:var(--muted)}
.bf-block__marker--done{color:var(--success)}
.bf-block code{font-family:var(--font-mono);font-size:.9em;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.1em .35em}
.bf-block pre.bf-code{margin:10px 0;padding:var(--space-3) 0;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);font:var(--fs-code)/1.55 var(--font-mono);tab-size:4;flex:none}
.bf-block pre.bf-code code{background:none;border:0;padding:0;font-size:inherit}
.bf-block pre.bf-code .bf-code__line{display:block;padding:0 14px;white-space:pre;min-height:1.55em}
.bf-block__add{position:absolute;top:4px;right:4px;opacity:0;font-size:var(--fs-xs);padding:2px 8px}
.bf-block:hover .bf-block__add,.bf-block__add:focus-visible{opacity:1}
.bf-block--composing .bf-block__add{opacity:0}
.bf-rail__cell{min-width:0}
.bf-rail__comments{display:flex;flex-direction:column;gap:8px;padding:4px 0 10px}
.bf-rail__orphans{margin:20px 0 0;padding-top:var(--space-3);border-top:1px dashed var(--border)}
.bf-rail__orphans p{margin:0 0 8px;color:var(--muted);font-size:var(--fs-sm)}
@media (max-width:1180px){
.bf-app__body{grid-template-columns:1fr}
.bf-app__sidebar{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border)}
.review-nav{padding:4px 16px 12px}
}
@media (max-width:860px){
.bf-review{grid-template-columns:1fr;padding:var(--space-4) 18px 80px}
}
@media (prefers-reduced-motion:no-preference){.bf-block{transition:background .08s ease}}
@media (hover:none){.bf-block__add{opacity:1}}
`.trim();

/**
 * Render the review page for `data`. The markup is a fixed shell; the client
 * fills every dynamic field, so this function is the only place that needs the
 * JSON-island escaping.
 */
export function renderReviewPage(data: ReviewPageData): string {
	const island = JSON.stringify(data).replace(/</g, "\\u003c");
	return `<!doctype html>
<html lang="en">
<head>
${docHead({ title: "Plan review", css: REVIEW_CSS })}
</head>
<body class="bf-app">
<a class="skip" href="#plan">Skip to the plan</a>
<header class="bf-app__header"><div class="bf-toolbar">
${brandLockup("plan review")}
<span class="bf-title" id="plan-title">Plan review</span>
<span class="bf-context" id="plan-path"></span>
<span class="bf-spacer"></span>
<span class="bf-progress" id="steps" hidden><span class="bf-progress__track"><span class="bf-progress__fill" id="steps-fill"></span></span><span id="steps-label"></span></span>
<span class="bf-chip" id="comment-count"></span>
${themeToggle()}
<button type="button" class="bf-btn bf-btn--primary" id="save">Save feedback</button>
<button type="button" class="bf-btn" id="cancel">Close</button>
</div></header>
<div class="bf-status" id="status" role="status" aria-live="polite"></div>
<div class="bf-app__body">
<details class="bf-app__sidebar review-outline" open>
<summary class="bf-panel__summary">Sections</summary>
<nav class="bf-panel review-nav" aria-label="Plan sections"><ul id="outline-list"></ul></nav>
</details>
<main class="bf-app__main bf-review" id="plan" aria-label="Plan"></main>
</div>
<script type="application/json" id="review-data">${island}</script>
<script src="/client.js" defer></script>
</body>
</html>
`;
}
