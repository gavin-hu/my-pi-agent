/**
 * The shared app shell for Bytefly browser pages.
 *
 * `.bf-app` is a column of header, body, and optional footer; `.bf-app__body`
 * is a sidebar + main grid that collapses to a single column on narrow screens.
 * Page breakpoints for the body grid are literal media queries (CSS variables
 * cannot drive a query):
 *
 * - `860px`  the sidebar collapses to a `<details>` disclosure
 * - `1180px` plan review outline collapses above the review
 *
 * Only the shared 860px collapse lives here; the plan-specific rules stay in
 * `extensions/plan/web-page.ts`.
 *
 * The shell is a definite full-height column so the panes scroll inside it; the
 * 860px breakpoint drops that back to normal page scroll for narrow screens.
 *
 * The sidebar scrolls on its own box rather than on the `.bf-panel` it holds:
 * a `<details>` lays its content out in a block wrapper with no definite
 * height that takes no part in the element's flex layout, so a flex child there
 * keeps its content height and the sidebar would only clip it. A page that
 * needs pinned chrome above its own scroll pane (file-browse) fills that
 * wrapper absolutely and scrolls an inner region instead.
 */

/** Viewport width, in px, at and below which the sidebar becomes a disclosure. */
export const SIDEBAR_COLLAPSE_MAX = 860;

export const WEB_LAYOUT_CSS = `.bf-app{display:flex;flex-direction:column;height:100vh;min-height:0;overflow:hidden;background:var(--canvas);color:var(--text);font:var(--fs-base)/var(--lh-normal) var(--font-ui)}
.bf-app__header{position:sticky;top:0;z-index:2;flex:0 0 auto;background:var(--surface);border-bottom:1px solid var(--border)}
.bf-app__body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:260px minmax(0,1fr)}
.bf-app__sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;background:var(--surface);border-right:1px solid var(--border)}
.bf-app__main{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:auto;padding:var(--space-5) var(--space-6)}
.bf-app__footer{flex:0 0 auto;border-top:1px solid var(--border);color:var(--muted);font-size:var(--fs-sm);padding:var(--space-3) var(--space-6)}
@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){
.bf-app{height:auto;min-height:100vh;overflow:visible}
.bf-app__body{flex:none;grid-template-columns:1fr}
.bf-app__sidebar{display:block;position:static;max-height:none;overflow:visible;border-right:0;border-bottom:1px solid var(--border)}
.bf-app__main{overflow:visible}
.bf-app__sidebar .bf-panel__summary{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-4);cursor:pointer;list-style:none;font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--muted)}
.bf-panel__summary::-webkit-details-marker{display:none}
.bf-panel__summary::before{content:"\\25B8";color:var(--muted)}
.bf-app__sidebar[open] .bf-panel__summary::before{content:"\\25BE"}
}`;
