/**
 * The shared theme for this package's local browser surfaces (`file-browse`
 * and `plan`).
 *
 * Value-only: token variables, the syntax-token colors, the pre-paint bootstrap
 * that applies a saved choice, and the toggle wiring both clients embed. Kept
 * here so the two pages cannot drift — a color, a font stack, or the storage
 * key has one home. The palette is a GitHub-inspired light/dark set whose
 * canvas and accent match the `bytefly-dark`/`bytefly-light` themes.
 */

/** localStorage key for the browser's explicit light/dark choice, shared by both surfaces. */
export const WEB_THEME_STORAGE_KEY = "pi-web-theme";

/**
 * A tiny head script that applies the saved theme before the body is painted,
 * so an explicit choice does not flash the system theme on load. Served as
 * `/theme.js` and shared by both pages.
 */
export const THEME_JS = `(function(){try{var t=localStorage.getItem("${WEB_THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

/**
 * The toggle wiring both clients embed. It finds `#theme-toggle`, paints its
 * `.theme-glyph` (sun/moon), follows the system until the user makes a choice,
 * and remembers that choice under the shared key. The element ids and the
 * glyph class are the contract the two pages share.
 */
export const THEME_TOGGLE_JS = String.raw`(function () {
  var key = "${WEB_THEME_STORAGE_KEY}";
  var button = document.getElementById("theme-toggle");
  if (!button) return;

  function get() {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }
  function set(value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* private mode */ }
  }
  function system() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function stored() {
    var value = get();
    return value === "light" || value === "dark" ? value : null;
  }
  function effective() {
    return document.documentElement.getAttribute("data-theme") || system();
  }
  function paint(theme) {
    var glyph = button.querySelector(".theme-glyph");
    if (glyph) glyph.textContent = theme === "light" ? "\u2600" : "\u263E";
    var label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  var explicit = stored();
  paint(explicit || effective());
  button.addEventListener("click", function () {
    var next = effective() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    set(next);
    paint(next);
  });
  if (!explicit && window.matchMedia) {
    var query = window.matchMedia("(prefers-color-scheme: light)");
    var sync = function () { if (!stored()) paint(system()); };
    if (query.addEventListener) query.addEventListener("change", sync);
    else if (query.addListener) query.addListener(sync);
  }
})();`;

/** Light palette tokens, applied both by an explicit choice and the system media query. */
const LIGHT_TOKENS = `--canvas:#fff;--surface:#f6f8fa;--border:#d0d7de;--text:#1f2328;--muted:#656d76;
  --accent:#0969da;--accent-soft:rgba(9,105,218,.10);--success:#1a7f37;
  --danger:#cf222e;--warn:#9a6700;
  --tok-comment:#6e7781;--tok-string:#0a3069;--tok-number:#0550ae;--tok-keyword:#cf222e;
  --tok-literal:#0550ae;--tok-tag:#116329;--tok-attr:#0550ae;--tok-prop:#0550ae;--tok-var:#953800;
  color-scheme:light;`;

/**
 * The theme tokens and syntax-token classes: the dark base, the explicit light
 * override, the system fallback, and the `tok-*` rules the highlighter emits.
 * Pages prepend this to their own component CSS.
 */
export const WEB_THEME_CSS = `:root{
  --canvas:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;
  --muted:#8b949e;--accent:#58a6ff;--accent-soft:rgba(88,166,255,.15);
  --success:#3fb950;--danger:#f85149;--warn:#d29922;
  --tok-comment:#8b949e;--tok-string:#a5d6ff;--tok-number:#79c0ff;--tok-keyword:#ff7b72;
  --tok-literal:#79c0ff;--tok-tag:#7ee787;--tok-attr:#79c0ff;--tok-prop:#79c0ff;--tok-var:#ffa657;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color-scheme:dark;
}
:root[data-theme="light"]{
${LIGHT_TOKENS}}
:root[data-theme="dark"]{color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme]){
${LIGHT_TOKENS}}}
.tok-comment{color:var(--tok-comment);font-style:italic}
.tok-string{color:var(--tok-string)}
.tok-number{color:var(--tok-number)}
.tok-keyword{color:var(--tok-keyword)}
.tok-literal{color:var(--tok-literal)}
.tok-tag{color:var(--tok-tag)}
.tok-attr{color:var(--tok-attr)}
.tok-prop{color:var(--tok-prop)}
.tok-var{color:var(--tok-var)}`;

/**
 * Base rules the two pages share: box sizing, links, focus rings, and the
 * skip-link / screen-reader helpers. Page layout (body display, shells) stays
 * with each page.
 */
export const WEB_BASE_CSS = `*{box-sizing:border-box}
[hidden]{display:none!important}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:0;z-index:3;padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px}
.skip:focus{left:12px;top:12px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;
