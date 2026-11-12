/**
 * The shared Bytefly web component styles (`bf-*`).
 *
 * One string constant, no state. `bf-` marks the kit; a page that needs a
 * layout tweak adds a page-namespaced rule rather than re-declaring a kit
 * class. Components read tokens only, never literal colours — and no box casts
 * a shadow: a lifted panel is a rail and a hairline, which is the difference
 * between this kit's grammar and the pill-and-card one it replaces.
 */

/**
 * Viewport width, in px, at and below which a code panel wraps its lines.
 *
 * One number for both sides of the rule: the kit's media query wraps the panel, and
 * `file-browse`'s wrap control reads the same width to know what the page is already doing.
 * A literal in either place is how a button comes to describe a rule that moved.
 */
export const NARROW_MAX_PX = 720;

export const WEB_COMPONENTS_CSS = `.bf-brand{position:relative;display:inline-flex;align-items:baseline;gap:var(--space-2);font:var(--fw-semibold) var(--fs-base) var(--font-mono);white-space:nowrap}
.bf-mark{display:inline-block;width:18px;height:18px;flex:0 0 18px;align-self:center}
.bf-mark__top{fill:var(--accent)}
.bf-mark__bottom{fill:var(--warn)}
/* The mark's rule is the signature's first home: out of flow under the mark, so an identity
   row that wraps at 860 cannot stretch it into a bar beside the path. */
.bf-brand__rule{position:absolute;left:0;top:100%;margin-top:4px;width:18px;height:2px;background:linear-gradient(90deg,var(--accent) 0 12px,var(--warn) 12px 18px)}
.bf-wordmark{color:var(--text)}
.bf-title{margin:0;font-weight:var(--fw-semibold);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-context{font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The page's subject: the identity row's splitter, and the one label it truncates. RTL keeps the
   end of a path — the folder a reader is in — over its head, which names only the machine. */
.bf-context--subject{flex:1 1 auto;direction:rtl;text-align:left;color:var(--dim);line-height:18px}
.bf-spacer{flex:1 1 auto}
/* One tone set, worn by a tag, a row's reason, or a lane's mark: a glyph carries the state and
   the colour only agrees with it, so nothing is encoded by hue alone. */
.bf-tone--accent{color:var(--accent)}
.bf-tone--success{color:var(--success)}
.bf-tone--warn{color:var(--warn)}
.bf-tone--danger{color:var(--danger)}
.bf-tone--dim{color:var(--dim)}
.bf-tone--muted{color:var(--muted)}
/* A tag is a rail, not a pill: a 2px edge in the tone, a glyph, a word in mono. No box and no
   radius, because a box in this kit is a container or an action. */
.bf-tag{display:inline-flex;align-items:center;gap:5px;padding-left:5px;border-left:2px solid currentColor;font:var(--fs-xs) var(--font-mono);color:var(--muted);white-space:nowrap}
.bf-tag__glyph{font-size:10px;line-height:1}
.bf-tag--trunc{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis}
/* The live state and its one action: borderless, the tone is the text's colour, so a new state
   never costs a new shape. */
.bf-live,.bf-reload{display:inline-flex;align-items:center;gap:5px;border:0;background:none;padding:0;font:var(--fs-xs) var(--font-mono)}
.bf-live{color:var(--accent)}
.bf-live__glyph{font-size:9px;line-height:1}
.bf-live__text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-reload{appearance:none;color:var(--warn);cursor:pointer}
.bf-reload:hover{color:var(--warn);text-decoration:underline}
/* A button is the only boxed, uppercase, monospace element on a page: its 2px bottom edge is
   the click, so a label can never be mistaken for a tag. */
.bf-btn{appearance:none;border:1px solid var(--border);border-bottom-width:2px;border-radius:var(--radius-sm);background:transparent;color:var(--text);font:var(--fs-xs) var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;cursor:pointer;transition:transform var(--motion-fast) var(--motion-ease),border-color var(--motion-fast) var(--motion-ease)}
.bf-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft);text-decoration:none}
.bf-btn:active{transform:translateY(1px);border-bottom-width:1px}
.bf-btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.bf-btn--primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.bf-btn--primary:hover{background:var(--accent);filter:brightness(1.06);color:var(--on-accent)}
.bf-btn--danger{border-color:var(--danger);color:var(--danger)}
.bf-btn--danger:hover{border-color:var(--danger);background:var(--danger);color:var(--on-accent)}
.bf-btn--ghost{border-color:transparent;border-bottom-width:0;background:none;padding:0;font:inherit;letter-spacing:normal;text-transform:none;color:inherit}
.bf-btn--ghost:hover{color:var(--accent);background:none}
.bf-btn--icon{min-width:30px;text-align:center;line-height:1}
.bf-btn:disabled{opacity:.5;cursor:default}
.theme-glyph{font-size:var(--fs-md)}
/* A key is a bracket, not a key cap: [j] reads as one in mono and needs no drawn box. */
.bf-kbd{font:var(--fs-xs) var(--font-mono);color:var(--text);white-space:nowrap}
.bf-kbd::before{content:"[";color:var(--dim)}
.bf-kbd::after{content:"]";color:var(--dim)}
/* A view switch with no box, no underline and no marker: the current view is the accent and the
   weight, its neighbours muted, and one hairline keeps the items apart. */
.bf-tabs{display:inline-flex}
.bf-tabs__item{appearance:none;border:0;background:none;color:var(--muted);font:var(--fs-xs) var(--font-mono);padding:4px 10px;cursor:pointer}
.bf-tabs__item+.bf-tabs__item{border-left:1px solid var(--border)}
.bf-tabs__item:hover{color:var(--text)}
.bf-tabs__item[aria-current],.bf-tabs__item[aria-selected="true"],.bf-tabs__item[aria-pressed="true"]{color:var(--accent);font-weight:var(--fw-semibold)}
.bf-tabs__item:disabled{opacity:.5;cursor:default}
.bf-tabs__count{color:var(--dim);margin-left:5px}
/* The field is a prompt line: at rest it is text, and the rule arrives on hover or focus, which
   is the focus affordance the boxed field drew with its border. */
.bf-field{display:flex;align-items:baseline;gap:6px;padding:0 0 2px;border-bottom:1px solid transparent;cursor:text}
.bf-field:hover{border-bottom-color:var(--border)}
.bf-field:focus-within{border-bottom-color:var(--accent)}
.bf-field--filter{width:15rem;margin-left:auto}
.bf-field__prompt{color:var(--muted);font-family:var(--font-mono)}
/* The prompt glyph is the kit's own, so a page writes the slot empty and no page spells it. */
.bf-field__prompt::before{content:"❯"}
.bf-field:focus-within .bf-field__prompt{color:var(--accent)}
.bf-input{border:0;background:transparent;color:var(--text);font:var(--fs-sm) var(--font-mono);width:100%;outline:none}
.bf-input::placeholder{color:var(--dim)}
/* The field's rule is the ring: a second outline inside it drew a border within a border. */
.bf-field .bf-input:focus-visible{outline:none}
.bf-textarea{width:100%;min-height:72px;padding:var(--space-2);font:inherit;color:var(--text);background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius-sm);resize:vertical}
/* A quantity is literal: ten fixed cells, then the count itself, so a reader reads without
   counting glyphs. The number lives in the text and the cells are decoration. */
.bf-gauge{display:inline-flex;align-items:baseline;gap:6px;font:var(--fs-sm) var(--font-mono);white-space:nowrap}
.bf-gauge__cells{color:var(--success);font-variant-numeric:tabular-nums}
.bf-gauge__empty{color:var(--border)}
.bf-gauge__text{color:var(--muted);font:var(--fs-xs) var(--font-mono);font-variant-numeric:tabular-nums}
/* The only rounded shape in the kit. */
.bf-badge{display:inline-block;min-width:1.4em;padding:0 4px;border-radius:var(--radius-badge);background:var(--canvas);color:var(--muted);font:var(--fs-xs) var(--font-mono);text-align:center}
.bf-panel{min-width:0;overflow:auto;overscroll-behavior:contain}
.bf-panel__summary{display:none}
.bf-status{color:var(--muted);font-size:var(--fs-sm)}
.bf-status--saved{color:var(--success)}
.bf-status--error{color:var(--danger)}
/* The footer's one line: where the content came from, and what it holds. It wraps rather than
   truncating — a footer is one sentence carrying two facts, and cutting it hides one of them. */
.bf-footer__facts{display:block;min-width:0;overflow-wrap:anywhere}
.bf-note{margin-top:var(--space-3);font-size:var(--fs-sm);color:var(--muted)}
.bf-empty{padding:64px var(--space-6);text-align:center}
.bf-empty__title{font-size:var(--fs-base);margin:0 0 6px}
.bf-empty__sub{color:var(--muted);font-size:var(--fs-sm);margin:0 0 var(--space-4)}
/* A missing page is a glyph a terminal would print, not a red banner. */
.bf-empty__code{font:var(--fw-normal) 48px/1 var(--font-mono);color:var(--dim)}
/* The dialog stays centred and loses its shadow: a 2px accent rail and its hairline hold it. */
.bf-dialog{position:fixed;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:var(--space-4);background:var(--scrim)}
.bf-dialog__panel{width:min(560px,100%);max-height:70vh;display:flex;flex-direction:column;overflow:hidden;background:var(--surface);border:1px solid var(--border-strong);border-top:2px solid var(--accent);border-radius:var(--radius-lg)}
.bf-dialog__status{margin:0;padding:var(--space-2) var(--space-4);border-top:1px solid var(--border);color:var(--muted);font-size:var(--fs-xs)}
.bf-dialog__input{appearance:none;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font:var(--fs-md) var(--font-mono);padding:var(--space-3) var(--space-4);outline:none}
.bf-dialog__list{list-style:none;margin:0;padding:var(--space-1) 0;overflow:auto;min-height:0}
.bf-dialog__option{padding:var(--space-1) var(--space-4);font:var(--fs-sm) var(--font-mono);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bf-dialog__option[aria-selected="true"]{background:var(--accent-soft);color:var(--accent)}
.bf-dialog mark{background:transparent;color:var(--warn);font-weight:var(--fw-semibold)}
.bf-dialog__head{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--border)}
.bf-dialog__head h2{margin:0;font:var(--fw-semibold) var(--fs-md) var(--font-mono)}
.bf-dialog__body{padding:var(--space-3) var(--space-4);font-size:var(--fs-sm);line-height:var(--lh-relaxed);overflow:auto;min-height:0}
.bf-dialog__body p{margin:0 0 var(--space-2)}
.bf-dialog__body p:last-child{margin:0}
.bf-dialog__hint{color:var(--muted)}
.bf-dialog__actions{display:flex;justify-content:flex-end;gap:var(--space-2);padding:var(--space-2) var(--space-4);border-top:1px solid var(--border)}
.bf-keys{display:grid;grid-template-columns:auto 1fr;gap:8px var(--space-4);margin:0;padding:var(--space-4)}
.bf-keys dt{white-space:nowrap}
.bf-keys dd{margin:0;color:var(--muted);font-size:var(--fs-sm)}
/* One line under the table, for a rule that is not a key: what an open dialog keeps. */
.bf-keys__note{margin:0;padding:0 var(--space-4) var(--space-4);color:var(--muted);font-size:var(--fs-xs)}
.bf-tree{font-family:var(--font-mono);font-size:var(--fs-sm);overflow-x:auto}
.bf-tree ul{list-style:none;margin:0;padding-left:14px}
.bf-tree>ul{padding-left:0}
/* A nested level draws the one guide that says where it starts, at the indent's edge. */
.bf-tree ul ul{position:relative}
.bf-tree ul ul::before{content:"";position:absolute;left:0;top:0;bottom:0;border-left:1px solid var(--border)}
.bf-tree__row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:var(--radius-sm);white-space:nowrap}
.bf-tree__row:hover,.bf-tree__row:focus-within{background:var(--accent-soft)}
.bf-tree__row[aria-current]{background:var(--accent-soft);color:var(--text);font-weight:var(--fw-semibold)}
.bf-tree__tw{position:relative;appearance:none;background:none;border:0;padding:0;margin:0;width:12px;height:16px;flex:0 0 12px;font:inherit;line-height:1;text-align:center;color:var(--muted);cursor:pointer}
.bf-tree__tw--toggle::after{content:"";position:absolute;inset:-6px -3px}
.bf-tree__tw--spacer{cursor:default}
.bf-tree__icon{width:16px;height:16px;flex:0 0 16px}
.bf-tree li[data-loading] .bf-tree__tw{opacity:.5}
.bf-tree li[data-error]>.bf-tree__row{color:var(--danger)}
.bf-tree__broken{color:var(--muted);text-decoration:line-through}
.bf-tree__link-mark{color:var(--muted);font-size:var(--fs-xs)}
.bf-crumbs{font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--muted);padding-bottom:var(--space-2);overflow-wrap:anywhere}
.bf-crumbs__sep{padding:0 6px}
.bf-crumbs [aria-current]{color:var(--text);font-weight:var(--fw-semibold)}
.bf-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:var(--fs-md)}
.bf-table th{font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--muted);text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)}
.bf-table td{padding:6px 10px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bf-table tbody tr:hover,.bf-table tbody tr:focus-within{background:var(--accent-soft)}
.bf-table__size,.bf-table__when{color:var(--muted);text-align:right}
.bf-table__when{font-family:var(--font-mono);font-size:var(--fs-sm)}
.bf-table__name{display:flex;align-items:center;gap:10px;min-width:0}
.bf-table__name a,.bf-table__name span{flex:1 1 auto;min-width:0;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-table__thumb{width:36px;height:36px;border-radius:var(--radius-sm);object-fit:cover;background:var(--canvas);border:1px solid var(--border);flex:0 0 36px}
.bf-sort{appearance:none;border:0;background:none;color:inherit;font:inherit;padding:0;cursor:pointer}
.bf-sort:hover{color:var(--accent)}
th[aria-sort] .bf-sort{color:var(--text);font-weight:var(--fw-semibold)}
th[aria-sort="ascending"] .bf-sort::after{content:" \\25B2";font-size:9px;color:var(--accent)}
th[aria-sort="descending"] .bf-sort::after{content:" \\25BC";font-size:9px;color:var(--accent)}
/* The one box a page reads whole: a hairline box with the signature rule above it — the accent's
   lead, the warn's step, then the border — and no shadow, because a rail and a hairline hold it. */
.bf-record{display:flex;flex-direction:column;min-width:0;border:1px solid var(--border);background:none}
.bf-record::before{content:"";display:block;flex:0 0 auto;height:2px;background:linear-gradient(90deg,var(--accent) 0 12px,var(--warn) 12px 18px,var(--border) 18px)}
.bf-record__head{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);flex-wrap:wrap}
.bf-record__title{margin:0;font:var(--fw-semibold) var(--fs-lg) var(--font-mono)}
.bf-record__meta{color:var(--muted);font:var(--fs-sm) var(--font-mono)}
.bf-record__body{padding:var(--space-3) var(--space-4)}
/* The one list component: a glyph marks it, the tone agrees with the glyph, and the lifted
   state is a surface that appears only where a reader points. */
.bf-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--space-2);align-items:start;padding:var(--space-2) 0;border-bottom:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer}
.bf-row:last-of-type{border-bottom:0}
.bf-row:hover,.bf-row:focus-visible{background:var(--surface)}
.bf-row__mark{font:var(--fs-xs) var(--font-mono);line-height:1.6;color:var(--lane-role,var(--dim))}
.bf-row__id{font:var(--fs-xs) var(--font-mono);color:var(--dim);margin-right:6px}
.bf-row__title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font:var(--fs-sm)/var(--lh-snug) var(--font-ui);color:var(--text);overflow-wrap:anywhere}
.bf-row__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:2px 0 0;font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.bf-row__kind{color:var(--dim)}
.bf-row__breaking{color:var(--warn)}
.bf-row__ago{font:var(--fs-xs) var(--font-mono);color:var(--dim)}
.bf-row__reason{display:block;margin-top:2px;font:var(--fs-xs) var(--font-mono);color:var(--muted)}
.bf-row__reason[data-tone="accent"]{color:var(--accent)}
.bf-row__reason[data-tone="warn"]{color:var(--warn)}
.bf-row__reason[data-tone="danger"]{color:var(--danger)}
.bf-row[data-current="true"] .bf-row__mark{color:var(--accent)}
.bf-row[data-current="true"] .bf-row__title{font-weight:var(--fw-semibold)}
/* A lane is a head with a tone rule and rows under it — no tray, no fill, no inset edge. */
.bf-lane{display:flex;flex-direction:column;min-width:0}
.bf-lane__head{display:flex;align-items:center;gap:6px;margin:0 0 var(--space-2);padding-bottom:var(--space-1);border-bottom:2px solid var(--lane-role,var(--border));font:var(--fw-semibold) var(--fs-xs) var(--font-mono);color:var(--muted)}
.bf-lane__dot{font-size:9px;line-height:1;color:var(--lane-role,var(--muted))}
.bf-lane__count{margin-left:auto;color:var(--dim)}
.bf-lane__list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;min-width:0}
.bf-lane__empty{margin:0;padding:var(--space-2) 0;font:var(--fs-xs) var(--font-mono);color:var(--dim)}
/* A section states its tone in the rule it already draws, never in a box around the content. */
.bf-section{display:flex;flex-direction:column;min-width:0}
.bf-section__cap{display:flex;align-items:center;gap:var(--space-2);margin:0;padding:0 0 var(--space-2);border-bottom:1px solid var(--border);font:var(--fw-semibold) var(--fs-xs) var(--font-mono);text-transform:uppercase;color:var(--muted)}
.bf-section[data-tone] .bf-section__cap{color:var(--text);border-bottom-width:2px}
.bf-section[data-tone="accent"] .bf-section__cap{border-bottom-color:var(--accent)}
.bf-section[data-tone="warn"] .bf-section__cap{border-bottom-color:var(--warn)}
.bf-section[data-tone="danger"] .bf-section__cap{border-bottom-color:var(--danger)}
.bf-section[data-tone="success"] .bf-section__cap{border-bottom-color:var(--success)}
.bf-section__count{margin-left:auto;font-variant-numeric:tabular-nums}
/* A section row is a reference to a card that also sits in its lane, so it stays secondary. */
.bf-section[data-tone] .bf-row__title{color:var(--muted)}
.bf-code{margin:0;padding:var(--space-3) 0 var(--space-4);flex:1 1 auto;min-height:0;overflow:auto;font:var(--fs-code)/1.55 var(--font-mono);counter-reset:line;tab-size:4;background:var(--canvas)}
.bf-code__line{display:block;padding:0 var(--space-4) 0 0;white-space:pre;min-height:1.55em}
.bf-code--numbered .bf-code__line::before{counter-increment:line;content:counter(line);display:inline-block;width:64px;padding-right:var(--space-4);text-align:right;color:var(--dim);user-select:none}
.bf-code--wrap .bf-code__line{white-space:pre-wrap;overflow-wrap:anywhere}
/* Below a phone's width a line wraps rather than scrolling out of sight: a path or a
   command is a fact the reader came for, and an overlay scrollbar is no way to reach it.
   The same declaration the opt-in class states, so a page that asks for wrap and a phone
   that does not cannot break a line differently. */
@media (max-width:${NARROW_MAX_PX}px){
  .bf-code__line,.bf-code>code{white-space:pre-wrap;overflow-wrap:anywhere}
}
/* The other answer, for a page with its own control: its "no wrap" has to mean no on a
   narrow screen too, and it is more specific than the media rule above so it wins there. */
.bf-code--nowrap .bf-code__line,.bf-code--nowrap>code{white-space:pre}
.bf-media{display:flex;flex:1 1 auto;align-items:center;justify-content:center;padding:var(--space-6);min-height:240px;background-image:linear-gradient(45deg,var(--border) 25%,transparent 25%),linear-gradient(-45deg,var(--border) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--border) 75%),linear-gradient(-45deg,transparent 75%,var(--border) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.bf-media img{max-width:100%;max-height:70vh;border-radius:var(--radius-sm)}
/* The document keeps prose's face and loses GitHub's shapes: mono headings, a rail instead of
   an underline, rule-only rows, and one measure so a plan is not an 1,800px line. */
.bf-md{min-width:0;min-height:0;max-width:var(--measure-prose);overflow:auto;padding:6px var(--space-5) var(--space-5);line-height:var(--lh-relaxed);overflow-wrap:anywhere}
.bf-md>*:first-child{margin-top:0}
.bf-md h1,.bf-md h2,.bf-md h3,.bf-md h4,.bf-md h5,.bf-md h6{margin:1.2em 0 .5em;font-family:var(--font-mono);line-height:var(--lh-tight)}
.bf-md h1{font-size:1.4em;font-weight:var(--fw-semibold)}
.bf-md h2{font-size:1.2em;font-weight:var(--fw-semibold)}
.bf-md h2::before{content:"▏";color:var(--dim);margin-right:6px;font-weight:var(--fw-normal)}
.bf-md h3{font-size:1.05em;font-weight:var(--fw-medium);color:var(--muted)}
.bf-md p,.bf-md ul,.bf-md ol,.bf-md blockquote,.bf-md table,.bf-md pre{margin:0 0 1em}
.bf-md ul,.bf-md ol{padding-left:1.4em}
.bf-md li{margin:.25em 0}
.bf-md code{font-family:var(--font-mono);font-size:.9em;background:var(--surface);padding:.1em .35em}
.bf-md pre{border:0;border-left:2px solid var(--border);padding:var(--space-3) var(--space-4);overflow:auto;background:var(--surface);font:var(--fs-code)/1.55 var(--font-mono)}
.bf-md pre code{background:none;padding:0}
.bf-md blockquote{margin-left:0;padding-left:1em;border-left:2px solid var(--dim);color:var(--muted)}
.bf-md li.task{list-style:none;margin-left:-1.2em}
/* The boxes are drawn rather than left native: a disabled native checkbox is UA
   gray in both themes, so the done state could not carry the success colour. */
.bf-md .md-check{appearance:none;-webkit-appearance:none;width:13px;height:13px;margin:0 6px 0 0;border:1px solid var(--border-strong);border-radius:1px;background:var(--canvas);vertical-align:-2px}
.bf-md .md-check:checked{border-color:var(--success);background:var(--success) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/11px 11px no-repeat}
.bf-md .md-check:disabled{opacity:1}
.bf-md table{margin:0;border-collapse:collapse;table-layout:auto;width:auto;font-size:var(--fs-sm)}
.bf-md .md-table-frame{position:relative}
.bf-md .md-table-wrap{overflow-x:auto;margin:0 0 1em}
.bf-md th,.bf-md td{border:0;border-bottom:1px solid var(--border);padding:5px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word}
.bf-md thead th{border-bottom:2px solid var(--border);font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--muted)}
.bf-md th{white-space:nowrap}
.bf-md th code,.bf-md td code{white-space:nowrap}
.bf-md .md-left{text-align:left}
.bf-md .md-center{text-align:center}
.bf-md .md-right{text-align:right}
.bf-md img{max-width:100%;height:auto;border-radius:var(--radius-sm)}
.bf-md hr{border:0;border-top:1px solid var(--border);margin:1.4em 0}
.bf-md details{margin:0 0 1em}
.bf-md summary{cursor:pointer;font-weight:var(--fw-medium)}
.bf-md figure{margin:0 0 1em}
.bf-md figcaption{color:var(--muted);font-size:var(--fs-sm)}
.bf-md kbd{font:var(--fs-xs) var(--font-mono);color:var(--text)}
.bf-md mark{background:var(--accent-soft);color:inherit;padding:0 .1em}
.bf-md abbr[title]{text-decoration:underline dotted;cursor:help}
.bf-md sub,.bf-md sup{font-size:.75em;line-height:0}
/* A comment is a record with a rail: the label is a glyph in the dim role, because warn is a
   verdict the comment carries and not the colour of its author. */
.bf-comment{padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-left:2px solid var(--border);border-radius:0;background:none}
.bf-comment--resolved{border-left-color:var(--success)}
.bf-comment__label{font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--dim)}
.bf-comment__quote{margin-bottom:var(--space-1);color:var(--muted);font-size:var(--fs-xs);overflow-wrap:anywhere}
.bf-comment__body{white-space:pre-wrap;overflow-wrap:anywhere}
.bf-comment__row{display:flex;gap:6px;justify-content:flex-end;margin-top:var(--space-2)}
.bf-composer{padding:var(--space-3);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm)}
.bf-composer__row{display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:6px}
.bf-quote-chip{display:inline-block;max-width:100%;margin-bottom:6px;padding:1px 6px;background:var(--accent-soft);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
