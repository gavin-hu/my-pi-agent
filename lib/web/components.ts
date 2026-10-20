/**
 * The shared Bytefly web component styles (`bf-*`).
 *
 * One string constant, no state. `bf-` marks the kit; a page that needs a
 * layout tweak adds a page-namespaced rule rather than re-declaring a kit
 * class. Components read tokens only, never literal colours or sizes.
 */

export const WEB_COMPONENTS_CSS = `.bf-brand{display:inline-flex;align-items:center;gap:var(--space-2);font-weight:var(--fw-semibold);white-space:nowrap}
.bf-mark{display:inline-block;width:18px;height:18px;flex:0 0 18px}
.bf-mark__top{fill:var(--accent)}
.bf-mark__bottom{fill:var(--warn)}
.bf-title{margin:0;font-weight:var(--fw-semibold);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-context{font-family:var(--font-mono);font-size:var(--fs-sm);color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-toolbar{display:flex;align-items:center;gap:var(--space-3);min-height:56px;padding:var(--space-2) var(--space-6);flex-wrap:wrap}
.bf-spacer{flex:1 1 auto}
.bf-btn{appearance:none;border:1px solid var(--border);border-radius:var(--radius-md);background:transparent;color:var(--text);font:var(--fs-sm) var(--font-ui);padding:5px var(--space-3);cursor:pointer}
.bf-btn:hover{border-color:var(--accent);color:var(--accent);text-decoration:none}
.bf-btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.bf-btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}
.bf-btn--primary:hover{filter:brightness(1.06);color:#fff}
.bf-btn--ghost{border-color:transparent;background:none;padding:0;font:inherit;color:inherit}
.bf-btn--ghost:hover{color:var(--accent)}
.bf-btn--icon{min-width:36px;text-align:center;line-height:1}
.bf-btn:disabled{opacity:.5;cursor:default}
.bf-theme-toggle{min-width:36px;text-align:center;line-height:1}
.bf-theme-toggle .theme-glyph{font-size:var(--fs-md)}
.bf-chip{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
.bf-chip--accent{color:var(--accent);border:1px solid currentColor;border-radius:var(--radius-pill);padding:2px 10px}
.bf-chip--success{color:var(--success)}
.bf-chip--warn{color:var(--warn)}
.bf-chip--danger{color:var(--danger)}
.bf-segmented{display:inline-flex;border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}
.bf-segmented__item{appearance:none;border:0;border-radius:0;background:transparent;color:var(--text);font:var(--fs-xs) var(--font-ui);padding:5px var(--space-3);cursor:pointer}
.bf-segmented__item+.bf-segmented__item{border-left:1px solid var(--border)}
.bf-segmented__item:hover{color:var(--accent);text-decoration:none}
.bf-segmented__item[aria-current="page"],.bf-segmented__item[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent)}
.bf-input{border:0;background:transparent;color:var(--text);font:var(--fs-sm) var(--font-mono);width:100%;outline:none}
.bf-field{display:flex;align-items:center;gap:var(--space-1);background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-1) var(--space-2);color:var(--muted);font-size:var(--fs-sm)}
.bf-textarea{width:100%;min-height:72px;padding:var(--space-2);font:inherit;color:var(--text);background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius-md);resize:vertical}
.bf-panel{min-width:0;overflow:auto;overscroll-behavior:contain}
.bf-panel__summary{display:none}
.bf-progress{display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--fs-xs);color:var(--muted);white-space:nowrap}
.bf-progress__track{display:inline-block;width:72px;height:6px;border-radius:var(--radius-pill);background:var(--border);overflow:hidden}
.bf-progress__fill{display:block;height:100%;background:var(--success)}
.bf-status{color:var(--muted);font-size:var(--fs-sm)}
.bf-status--saved{color:var(--success)}
.bf-status--error{color:var(--danger)}
.bf-note{margin-top:var(--space-3);font-size:var(--fs-sm);color:var(--muted)}
.bf-empty{padding:64px var(--space-6);text-align:center}
.bf-empty__title{font-size:var(--fs-base);margin:0 0 6px}
.bf-empty__sub{color:var(--muted);font-size:var(--fs-sm);margin:0 0 var(--space-4)}
.bf-empty__code{font:var(--fw-bold) 64px/1 var(--font-mono);color:var(--danger)}
.bf-dialog{position:fixed;inset:0;z-index:5;display:flex;align-items:flex-start;justify-content:center;padding:10vh var(--space-4) var(--space-4);background:rgba(0,0,0,.45)}
.bf-dialog__panel{width:min(640px,100%);max-height:70vh;display:flex;flex-direction:column;overflow:hidden;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.bf-dialog__status{margin:0;padding:var(--space-2) var(--space-4);border-top:1px solid var(--border);color:var(--muted);font-size:var(--fs-xs)}
.bf-dialog__input{appearance:none;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font:var(--fs-md) var(--font-mono);padding:var(--space-3) var(--space-4);outline:none}
.bf-dialog__list{list-style:none;margin:0;padding:var(--space-1) 0;overflow:auto;min-height:0}
.bf-dialog__option{padding:var(--space-1) var(--space-4);font:var(--fs-sm) var(--font-mono);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bf-dialog__option[aria-selected="true"]{background:var(--accent-soft);color:var(--accent)}
.bf-dialog mark{background:transparent;color:var(--warn);font-weight:var(--fw-semibold)}
.bf-tree{font-family:var(--font-mono);font-size:var(--fs-sm);overflow-x:auto}
.bf-tree ul{list-style:none;margin:0;padding-left:14px}
.bf-tree>ul{padding-left:0}
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
.bf-table th{font-weight:var(--fw-medium);color:var(--muted);text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);font-size:var(--fs-xs)}
.bf-table td{padding:6px 10px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bf-table tbody tr:hover,.bf-table tbody tr:focus-within{background:var(--accent-soft)}
.bf-table__size,.bf-table__when{color:var(--muted);text-align:right}
.bf-table__when{font-family:var(--font-mono);font-size:var(--fs-sm)}
.bf-table__name{display:flex;align-items:center;gap:10px;min-width:0}
.bf-table__name a,.bf-table__name span{flex:1 1 auto;min-width:0;font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bf-table__thumb{width:36px;height:36px;border-radius:5px;object-fit:cover;background:var(--canvas);border:1px solid var(--border);flex:0 0 36px}
.bf-sort{appearance:none;border:0;background:none;color:inherit;font:inherit;padding:0;cursor:pointer}
.bf-sort:hover{color:var(--accent)}
th[aria-sort] .bf-sort{color:var(--text);font-weight:var(--fw-semibold)}
th[aria-sort="ascending"] .bf-sort::after{content:" \\25B2";font-size:9px;color:var(--accent)}
th[aria-sort="descending"] .bf-sort::after{content:" \\25BC";font-size:9px;color:var(--accent)}
.bf-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;background:var(--surface)}
.bf-card__head{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);flex-wrap:wrap}
.bf-card__title{margin:0;font:var(--fw-semibold) var(--fs-lg) var(--font-mono)}
.bf-card__meta{color:var(--muted);font-size:var(--fs-sm);font-family:var(--font-mono)}
.bf-card__actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.bf-code{margin:0;padding:var(--space-3) 0 var(--space-4);flex:1 1 auto;min-height:0;overflow:auto;font:var(--fs-code)/1.55 var(--font-mono);counter-reset:line;tab-size:4;background:var(--canvas)}
.bf-code__line{display:block;padding:0 var(--space-4) 0 0;white-space:pre;min-height:1.55em}
.bf-code--numbered .bf-code__line::before{counter-increment:line;content:counter(line);display:inline-block;width:64px;padding-right:var(--space-4);text-align:right;color:var(--dim);user-select:none}
.bf-code--wrap .bf-code__line{white-space:pre-wrap;overflow-wrap:anywhere}
.bf-media{display:flex;flex:1 1 auto;align-items:center;justify-content:center;padding:var(--space-6);min-height:240px;background-image:linear-gradient(45deg,var(--border) 25%,transparent 25%),linear-gradient(-45deg,var(--border) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--border) 75%),linear-gradient(-45deg,transparent 75%,var(--border) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.bf-media img{max-width:100%;max-height:70vh;border-radius:var(--radius-sm)}
.bf-md{min-width:0;min-height:0;overflow:auto;padding:6px var(--space-5) var(--space-5);line-height:var(--lh-relaxed);overflow-wrap:anywhere}
.bf-md>*:first-child{margin-top:0}
.bf-md h1,.bf-md h2,.bf-md h3,.bf-md h4,.bf-md h5,.bf-md h6{margin:1.4em 0 .6em;line-height:var(--lh-tight)}
.bf-md h1,.bf-md h2{padding-bottom:.3em;border-bottom:1px solid var(--border)}
.bf-md h1{font-size:1.7em}.bf-md h2{font-size:1.4em}.bf-md h3{font-size:1.2em}
.bf-md p,.bf-md ul,.bf-md ol,.bf-md blockquote,.bf-md table,.bf-md pre{margin:0 0 1em}
.bf-md ul,.bf-md ol{padding-left:1.6em}
.bf-md li{margin:.25em 0}
.bf-md code{font-family:var(--font-mono);font-size:.9em;background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.1em .35em}
.bf-md pre{border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);overflow:auto;background:var(--canvas)}
.bf-md pre code{background:none;border:0;padding:0}
.bf-md blockquote{margin-left:0;padding:0 1em;border-left:3px solid var(--border);color:var(--muted)}
.bf-md li.task{list-style:none;margin-left:-1.4em}
.bf-md .md-check{color:var(--success)}
.bf-md table{margin:0;border-collapse:collapse;table-layout:auto;width:auto;font-size:var(--fs-sm)}
.bf-md .md-table-wrap{overflow-x:auto;margin:0 0 1em}
.bf-md th,.bf-md td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word}
.bf-md th{white-space:nowrap}
.bf-md th code,.bf-md td code{white-space:nowrap}
.bf-md thead th{background:var(--surface);font-weight:var(--fw-medium)}
.bf-md .md-left{text-align:left}
.bf-md .md-center{text-align:center}
.bf-md .md-right{text-align:right}
.bf-md img{max-width:100%;height:auto;border-radius:var(--radius-sm)}
.bf-md hr{border:0;border-top:1px solid var(--border);margin:1.4em 0}
.bf-md details{margin:0 0 1em}
.bf-md summary{cursor:pointer;font-weight:var(--fw-medium)}
.bf-md figure{margin:0 0 1em}
.bf-md figcaption{color:var(--muted);font-size:var(--fs-sm)}
.bf-md kbd{font-family:var(--font-mono);font-size:.85em;background:var(--canvas);border:1px solid var(--border);border-bottom-width:2px;border-radius:var(--radius-sm);padding:.1em .35em}
.bf-md mark{background:var(--accent-soft);color:inherit;padding:0 .1em}
.bf-md abbr[title]{text-decoration:underline dotted;cursor:help}
.bf-md sub,.bf-md sup{font-size:.75em;line-height:0}
.bf-comment{padding:var(--space-3) var(--space-4);background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:var(--radius-md)}
.bf-comment__quote{margin-bottom:var(--space-1);color:var(--muted);font-size:var(--fs-xs);overflow-wrap:anywhere}
.bf-comment__body{white-space:pre-wrap;overflow-wrap:anywhere}
.bf-comment__row{display:flex;gap:6px;justify-content:flex-end;margin-top:var(--space-2)}
.bf-composer{padding:var(--space-3);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md)}
.bf-composer__row{display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:6px}
.bf-quote-chip{display:inline-block;max-width:100%;margin-bottom:6px;padding:1px 6px;background:var(--accent-soft);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
