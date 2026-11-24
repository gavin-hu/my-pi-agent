/**
 * The shared app shell for Bytefly browser pages.
 *
 * `.bf-app` is a definite-height column: a two-row header, a body, and a footer.
 * `.bf-app__head` holds `.bf-app__id` (the mark, the subject, the state and the
 * app's chrome) over `.bf-app__ctl` (the page's own controls), with one plain
 * hairline between them and the header's own border under both. `.bf-app__body`
 * is a 260px sidebar plus main; `.bf-app__main` is the shell's scroll box, so the
 * document itself never scrolls and the header and footer never leave the
 * screen.
 *
 * Page breakpoints for the body grid are literal media queries (CSS variables
 * cannot drive a query):
 *
 * - `860px`  the sidebar collapses to a `<details>` disclosure above main
 * - `1180px` plan review takes the same collapse, at its own width
 *
 * The collapse is one body, `collapsedShell`, and this module ships it at 860. A page with its
 * own width asks for it instead of restating the rules — the plan review does, at 1180 — and a
 * page's rules for the same width ride the same query as its second argument. The header's own
 * narrow answer is a second body, `narrowShell`: a page takes the collapse at its width without
 * making its identity row three rows deep, because the body has a pane and the header has the
 * window.
 *
 * Every row of the shell sits on one gutter — `--space-6`, and `--space-7` from
 * 1440 up — at the viewport's width, because the lane heads, the prompt's right
 * edge and the footer are meant to land on the same two verticals.
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

/**
 * The sidebar's collapse, at the width the page asks for: the body stacks, the sidebar becomes a
 * bounded band, and its disclosure gets the chrome that makes it one.
 *
 * The sidebar becomes a band above main rather than the page becoming a document: its own box is
 * bounded, so a deep tree still releases the pane below it. `own` is the page's rules for the same
 * width, laid down after the shell's so a page still overrides at equal specificity — a rule
 * written there takes the collapse as its own condition.
 *
 * A page may take this at its own width without taking `narrowShell`: the body has a pane, and a
 * page whose outline needs the room earlier than the window runs out asks for this and nothing
 * else.
 */
export function collapsedShell(maxWidth: number, own = ""): string {
	const page = own === "" ? "" : `\n${own}`;
	return `@media (max-width:${maxWidth}px){
/* The sidebar becomes a band above main rather than the page becoming a document: its own box
   is bounded, so a deep tree still releases the pane below it. */
.bf-app__body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
.bf-app__sidebar{display:block;position:static;max-height:50vh;overflow-y:auto;border-right:0;border-bottom:1px solid var(--border)}
.bf-app__sidebar .bf-panel__summary{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-4);cursor:pointer;list-style:none;font-family:var(--font-ui);font-size:var(--fs-sm);color:var(--muted)}
.bf-panel__summary::-webkit-details-marker{display:none}
.bf-panel__summary::before{content:"\\25B8";color:var(--muted)}
.bf-app__sidebar[open] .bf-panel__summary::before{content:"\\25BE"}${page}
}`;
}

/**
 * The narrow header: at this width the identity row gives up its single line.
 *
 * The subject takes a row of its own rather than squeezing the facts beside it — a served root is
 * deeper than the identity row is wide — and a filter spans the control row. This is the header's
 * answer and not the sidebar's: it keys off the window, which is the width the header has, so it
 * stays at the shell's own breakpoint while the collapse travels to a page's width.
 */
export function narrowShell(maxWidth: number): string {
	return `@media (max-width:${maxWidth}px){
/* A long subject takes a row of its own rather than squeezing the facts beside it: the
   browser's root can be deeper than the identity row is wide. */
.bf-app__id .bf-context--subject{flex:1 1 100%}
.bf-app__ctl .bf-field--filter{width:100%;margin-left:0}
}`;
}

export const WEB_LAYOUT_CSS = `.bf-app{display:flex;flex-direction:column;height:100vh;min-height:0;overflow:hidden;background:var(--canvas);color:var(--text);font:var(--fs-base)/var(--lh-normal) var(--font-ui)}
.bf-app{height:100dvh}
/* The header is two rows and one hairline, on the page's own canvas: a bar that shares the
   page's plane needs no elevation to sit above it, and a shadow here was a second edge under a
   rule the reader already has. The rule between the rows stays, at the same weight, so the two
   rows read as one bar rather than as a stripe. */
.bf-app__head{flex:0 0 auto;background:var(--canvas);border-bottom:1px solid var(--border);position:relative;z-index:1}
/* The identity row is 52px rather than the 44 the chrome alone measures: the bar is where a
   reader's eye lands, and the icon's target wants air above and below it. */
.bf-app__id{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-height:52px;padding:var(--space-2) var(--space-6)}
.bf-app__rule{height:1px;background:var(--border)}
.bf-app__ctl{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;padding:5px var(--space-6)}
/* The control row's rhythm: 12 inside a role, 24 between roles — the switch, the meter and the
   prompt line are three groups, and the row's height comes from its equal padding. */
.bf-app__group{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;min-width:0}
.bf-app__group+.bf-app__group{margin-left:var(--space-3)}
/* A row's actions: the page's own controls, at the row's right end. Not a bf-app__group — the
   sibling margin above would win at equal specificity — and the push is the row's arrangement, not
   the group's, so a page that keeps two groups still reads as one rhythm. */
.bf-app__actions{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end;min-width:0;margin-left:auto}
.bf-app__facts{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.bf-app__chrome{display:flex;align-items:center;gap:var(--space-2);margin-left:auto}
/* Chrome is quieter than a control: a borderless icon here keeps the key-sheet button from
   reading as one of the page's own, and the box comes back on hover, where it is the target.
   One width on all four edges, because the hover rule brings back a colour and a colour on an
   edge with no width draws nothing. */
.bf-app__chrome .bf-btn{border-width:1px;border-color:transparent;color:var(--muted)}
.bf-app__chrome .bf-btn:hover{border-color:var(--border);color:var(--text);background:none}
.bf-app__body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:260px minmax(0,1fr)}
.bf-app__sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;overflow-x:hidden;overflow-y:auto;background:var(--raised);border-right:1px solid var(--border)}
.bf-app__main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;padding:var(--space-5) var(--space-6)}
.bf-app__foot{flex:0 0 auto;background:var(--canvas);border-top:1px solid var(--border);color:var(--dim);font-size:var(--fs-xs);padding:var(--space-3) var(--space-6)}
/* One gutter, two verticals: the identity row, the control row, the content and the footer all
   start and end on the same pair, and the separator rules are full-bleed by definition. */
@media (min-width:1440px){
.bf-app__id,.bf-app__ctl,.bf-app__main,.bf-app__foot{padding-left:var(--space-7);padding-right:var(--space-7)}
}
${collapsedShell(SIDEBAR_COLLAPSE_MAX)}
${narrowShell(SIDEBAR_COLLAPSE_MAX)}`;
