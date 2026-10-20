/**
 * The browser theme runtime shared by the Bytefly web surfaces: the storage
 * key, the pre-paint bootstrap, and the header toggle wiring.
 *
 * Value-only: string constants with no state. The element contract
 * (`#theme-toggle`, `.theme-glyph`) and the storage key are the agreement
 * between the server-rendered pages and this script.
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
 * and remembers that choice under the shared key.
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

/**
 * The `?` keyboard sheet's wiring, shared by both clients.
 *
 * It owns the sheet's pointer behavior — the page's trigger button, the sheet's
 * own close button, and a click on the backdrop — and nothing else: each page
 * keeps its own keyboard policy in its keydown handler, because the two differ
 * (the review peels `Esc` through a composer first), and calls in through
 * `window.bfKeys`.
 *
 * `triggerId` is the page's own shortcut button, since browse opens the sheet
 * from `#keys-open` and review from `#shortcuts`. The sheet's ids are the fixed
 * contract in `keysSheet` (`lib/web/markup.ts`).
 *
 * Value-only: the open state is the dialog's own `hidden` attribute, so this
 * module holds nothing.
 */
export function keysDialogScript(triggerId: string): string {
	return `(function () {
  "use strict";
  var dialog = document.getElementById("keys-dialog");
  if (!dialog) return;

  function isOpen() {
    return !dialog.hidden;
  }
  function toggle(force) {
    var open = force === undefined ? dialog.hidden : force;
    dialog.hidden = !open;
    if (open) {
      var close = document.getElementById("keys-close");
      if (close && close.focus) close.focus();
    }
  }

  var trigger = document.getElementById("${triggerId}");
  if (trigger) trigger.addEventListener("click", function () { toggle(); });
  var closer = document.getElementById("keys-close");
  if (closer) closer.addEventListener("click", function () { toggle(false); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) toggle(false);
  });

  window.bfKeys = {
    toggle: toggle,
    close: function () { toggle(false); },
    isOpen: isOpen
  };
})();`;
}
