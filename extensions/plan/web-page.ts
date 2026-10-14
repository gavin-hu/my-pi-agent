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
 * The server sets the CSP header; the page adds no external assets.
 */

import type { PlanBlock } from "./blocks.ts";
import type { PlanAnnotation } from "./feedback.ts";

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
	/** Per-session secret the client echoes on every request. */
	token: string;
}

/** Page styles; inline because the server sends no static stylesheet. */
export const REVIEW_CSS = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --card: #f6f8fa; --accent: #0969da; --warn: #9a6700; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --card: #161b22; --accent: #4493f8; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.bar { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; padding: 12px 20px; background: var(--bg); border-bottom: 1px solid var(--line); }
.titles { min-width: 0; display: flex; flex-direction: column; }
.titles strong { font-size: 16px; }
.path { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.actions { display: flex; gap: 8px; align-items: center; }
.progress { color: var(--muted); font-size: 13px; margin-right: 4px; }
button { font: inherit; padding: 5px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
button:disabled { opacity: 0.5; cursor: default; }
.status { padding: 0 20px; color: var(--muted); font-size: 13px; min-height: 20px; }
.status.saved { color: var(--accent); }
.plan { max-width: 900px; margin: 0 auto; padding: 16px 20px 96px; }
.block { position: relative; padding: 2px 0; border-radius: 6px; }
.block:hover { background: var(--card); }
.block[data-kind="code"] pre, .block pre { margin: 8px 0; padding: 12px; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 6px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.block h1, .block h2, .block h3, .block h4, .block h5, .block h6 { margin: 18px 0 6px; line-height: 1.25; }
.block h1 { font-size: 24px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.block h2 { font-size: 19px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.block p { margin: 8px 0; }
.block blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--line); color: var(--muted); }
.block .li { display: flex; gap: 8px; margin: 2px 0; }
.block .li .marker { color: var(--muted); min-width: 1.4em; }
.block code { padding: 1px 5px; background: var(--card); border-radius: 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.add { position: absolute; top: 2px; right: 4px; opacity: 0; font-size: 12px; padding: 2px 8px; }
.block:hover .add, .add:focus { opacity: 1; }
.comments { margin: 2px 0 8px 16px; padding-left: 12px; border-left: 2px solid var(--warn); }
.comment { margin: 6px 0; padding: 8px 10px; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
.comment .quote { color: var(--muted); font-size: 12px; }
.comment .body { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
.composer { margin: 6px 0 10px 16px; }
.composer textarea { width: 100%; min-height: 64px; padding: 8px; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; resize: vertical; }
.composer .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.quote-chip { display: inline-block; margin-bottom: 4px; padding: 1px 6px; background: var(--card); border-radius: 4px; color: var(--muted); font-size: 12px; }
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
<title>Plan review</title>
<style>${REVIEW_CSS}</style>
</head>
<body>
<header class="bar">
<div class="titles"><strong id="plan-title">Plan review</strong><span class="path" id="plan-path"></span></div>
<div class="actions">
<span class="progress" id="step-progress"></span>
<button type="button" class="primary" id="save">Save feedback</button>
<button type="button" id="cancel">Close without saving</button>
</div>
</header>
<div class="status" id="status" role="status" aria-live="polite"></div>
<main class="plan" id="plan"></main>
<script type="application/json" id="review-data">${island}</script>
<script src="/client.js" defer></script>
</body>
</html>
`;
}
