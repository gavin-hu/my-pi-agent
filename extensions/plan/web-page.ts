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
 * It shares the theme tokens, base rules, and syntax-token colors with
 * `file-browse` through `lib/web-theme.ts`; the server sets the CSP header, and
 * the page loads only same-origin scripts.
 */

import { WEB_BASE_CSS, WEB_THEME_CSS } from "../../lib/web-theme.ts";
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

/** Page styles: the shared base + theme, then the review components. */
export const REVIEW_CSS = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
body{display:flex;flex-direction:column;min-height:100vh;margin:0;background:var(--canvas);color:var(--text);font:15px/1.5 var(--ui)}
header.site{position:sticky;top:0;z-index:2;flex:0 0 auto;background:var(--surface);border-bottom:1px solid var(--border)}
.bar{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 24px;flex-wrap:wrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:0 0 8px}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap}
.plan-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.path{font-family:var(--mono);font-size:12.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spacer{flex:1 1 auto}
.steps{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);white-space:nowrap}
.steps-bar{display:inline-block;width:72px;height:6px;border-radius:999px;background:var(--border);overflow:hidden}
.steps-fill{display:block;height:100%;background:var(--success)}
.comment-count{font-size:12.5px;color:var(--muted);white-space:nowrap}
.action{appearance:none;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font:12.5px var(--ui);padding:5px 12px;cursor:pointer}
.action:hover{border-color:var(--accent);color:var(--accent)}
.action.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.action.primary:hover{filter:brightness(1.06);color:#fff}
.action:disabled{opacity:.5;cursor:default}
.theme-toggle{min-width:36px;text-align:center;line-height:1}
.theme-toggle .theme-glyph{font-size:14px}
.status{min-height:20px;padding:0 24px;color:var(--muted);font-size:13px}
.status.saved{color:var(--success)}
.status.error{color:var(--danger)}
.shell{flex:1 1 auto;display:grid;grid-template-columns:220px minmax(0,1fr);align-items:start}
.outline-panel{position:sticky;top:56px;align-self:start;max-height:calc(100vh - 56px);overflow-y:auto;padding:14px 10px;border-right:1px solid var(--border)}
.outline-summary{display:none}
.outline ul{list-style:none;margin:0;padding:0}
.outline a{display:block;padding:4px 8px;border-radius:4px;color:var(--muted);font-size:13px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.outline a:hover{background:var(--accent-soft);color:var(--accent);text-decoration:none}
.outline a[aria-current="true"]{background:var(--accent-soft);color:var(--accent);font-weight:600}
.outline .lvl-2 a{padding-left:18px}
.outline .lvl-3 a{padding-left:30px}
.outline .lvl-4 a,.outline .lvl-5 a,.outline .lvl-6 a{padding-left:42px}
.review{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);align-items:start;column-gap:28px;min-width:0;padding:20px 28px 96px}
.block{position:relative;padding:2px 0;border-radius:6px}
.block[id]{scroll-margin-top:76px}
.block:hover{background:var(--surface)}
.block h1,.block h2,.block h3,.block h4,.block h5,.block h6{margin:20px 0 8px;line-height:1.25}
.block h1{font-size:24px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.block h2{font-size:19px;padding-bottom:4px;border-bottom:1px solid var(--border)}
.block h3{font-size:16px}
.block p{margin:10px 0}
.block blockquote{margin:10px 0;padding:2px 14px;border-left:3px solid var(--border);color:var(--muted)}
.block .li{display:flex;gap:8px;margin:3px 0}
.block .li .marker{flex:0 0 auto;min-width:1.4em;color:var(--muted)}
.block .li .marker.done{color:var(--success)}
.block code{font-family:var(--mono);font-size:.9em;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:.1em .35em}
.block pre.code{margin:10px 0;padding:12px 0;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;font:13px/1.55 var(--mono);tab-size:4}
.block pre.code code{background:none;border:0;padding:0;font-size:inherit}
.block pre.code .line{display:block;padding:0 14px;white-space:pre;min-height:1.55em}
.add{position:absolute;top:4px;right:4px;opacity:0;font-size:12px;padding:2px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--muted);cursor:pointer}
.block:hover .add,.add:focus-visible{opacity:1}
.comments{display:flex;flex-direction:column;gap:8px;padding:4px 0 10px}
.comment{padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:6px}
.comment .quote{margin-bottom:4px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.comment .body{white-space:pre-wrap;overflow-wrap:anywhere}
.comment .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
.comment .row button{font-size:12px;padding:2px 8px}
.composer{padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:6px}
.composer textarea{width:100%;min-height:72px;padding:8px;font:inherit;color:var(--text);background:var(--canvas);border:1px solid var(--border);border-radius:6px;resize:vertical}
.composer .row{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
.quote-chip{display:inline-block;max-width:100%;margin-bottom:6px;padding:1px 6px;background:var(--accent-soft);border-radius:4px;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.orphans{margin:20px 0 0;padding-top:12px;border-top:1px dashed var(--border)}
.orphans p{margin:0 0 8px;color:var(--muted);font-size:13px}
@media (max-width:1180px){
.shell{grid-template-columns:1fr}
.outline-panel{position:static;max-height:none;padding:0;border-right:0;border-bottom:1px solid var(--border)}
.outline-summary{display:flex;align-items:center;gap:8px;padding:10px 20px;cursor:pointer;list-style:none;font-size:13px;color:var(--muted)}
.outline-summary::-webkit-details-marker{display:none}
.outline-summary::before{content:"▸";color:var(--muted)}
.outline-panel[open] .outline-summary::before{content:"▾"}
.outline{padding:4px 16px 12px}
}
@media (max-width:860px){
.review{grid-template-columns:1fr;padding:16px 18px 80px}
.path{display:none}
}
@media (prefers-reduced-motion:no-preference){.block{transition:background .08s ease}}
@media (hover:none){.add{opacity:1}}
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
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Plan review</title>
<style>${REVIEW_CSS}</style>
<script src="/theme.js"></script>
</head>
<body>
<a class="skip" href="#plan">Skip to the plan</a>
<header class="site"><div class="bar">
<span class="brand"><span class="dot"></span>plan review</span>
<span class="plan-title" id="plan-title">Plan review</span>
<span class="path" id="plan-path"></span>
<span class="spacer"></span>
<span class="steps" id="steps" hidden><span class="steps-bar"><span class="steps-fill" id="steps-fill"></span></span><span id="steps-label"></span></span>
<span class="comment-count" id="comment-count"></span>
<button type="button" class="action theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span class="theme-glyph" aria-hidden="true">☾</span></button>
<button type="button" class="action primary" id="save">Save feedback</button>
<button type="button" class="action" id="cancel">Close</button>
</div></header>
<div class="status" id="status" role="status" aria-live="polite"></div>
<div class="shell">
<details class="outline-panel" open>
<summary class="outline-summary">Sections</summary>
<nav class="outline" aria-label="Plan sections"><ul id="outline-list"></ul></nav>
</details>
<main class="review" id="plan" aria-label="Plan"></main>
</div>
<script type="application/json" id="review-data">${island}</script>
<script src="/client.js" defer></script>
</body>
</html>
`;
}
