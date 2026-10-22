/**
 * Base rules shared by the Bytefly browser surfaces: box sizing, hidden,
 * links, the focus ring, the skip-link / screen-reader helpers, and the two
 * media the kit answers for every page — print and forced colours.
 *
 * Page layout (body display, shells) stays with each page; this layer is the
 * smallest set both pages must agree on.
 */

// Every focusable element gets the same ring; components must not re-declare
// their own, so the keyboard affordance cannot disappear surface by surface.
export const WEB_BASE_CSS = `html,body{margin:0}
*{box-sizing:border-box}
[hidden]{display:none!important}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:var(--focus-ring) solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:0;z-index:3;padding:var(--space-2) var(--space-4);background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-md)}
.skip:focus{left:var(--space-3);top:var(--space-3)}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
/* A printed page is not a viewport: the shell un-constrains, its chrome goes,
   and the panes stop scrolling so the document prints whole. */
@media print{
.bf-app,.bf-app__body,.bf-app__main,.bf-app__sidebar,.bf-panel{display:block!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}
.bf-toolbar,.bf-app__sidebar,.bf-app__footer,.bf-progress,.skip,.bf-dialog{display:none!important}
.bf-app__header{position:static!important;border:0!important}
.bf-app__main{padding:0!important}
}
/* Windows High Contrast replaces colour but not a drawn control, so the one
   hand-drawn box names a system colour and the ring stays visible. */
@media (forced-colors:active){
a{color:LinkText}
:focus-visible{outline-color:CanvasText}
.bf-md .md-check{border-color:CanvasText}
.bf-md .md-check:checked{forced-color-adjust:none;background:Highlight;border-color:Highlight}
}`;
