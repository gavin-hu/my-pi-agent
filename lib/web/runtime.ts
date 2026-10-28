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
 * Where both routers serve {@link THEME_JS}. `docHead` emits the same path, so
 * the script tag and the route cannot drift apart.
 */
export const THEME_JS_PATH = "/theme.js";

/**
 * A tiny head script that applies the saved theme before the body is painted,
 * so an explicit choice does not flash the system theme on load. Served at
 * {@link THEME_JS_PATH} and shared by both pages.
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

/** Options for {@link dialogScript}. */
export interface DialogOptions {
	/** Id of the dialog root: the element carrying `.bf-dialog` and `hidden`. */
	dialogId: string;
	/** Id of the dialog's own close button, when the markup has one. */
	closeId?: string;
	/** Id of the page's trigger button, when the dialog opens from one. */
	triggerId?: string;
	/** Property to expose on `window`, so the page can open and close it. */
	globalName?: string;
}

/** Everything inside a dialog that can take focus, in DOM order. */
const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The wiring every modal in the kit shares: open and close, the backdrop, the
 * `Tab` trap, `Esc`, and focus returning to whatever opened it.
 *
 * A dialog is modal before this script runs too — `aria-modal` and `hidden` are
 * in the markup — so a page without JavaScript still shows it closed rather
 * than half-open.
 *
 * Value-only: the open state is the dialog's own `hidden` attribute, and the
 * element that opened it lives in this script's closure.
 */
export function dialogScript(options: DialogOptions): string {
	const trigger = options.triggerId ? `document.getElementById("${options.triggerId}")` : "null";
	const closer = options.closeId ? `document.getElementById("${options.closeId}")` : "null";
	const expose = options.globalName
		? `window.${options.globalName} = {
    open: function () { toggle(true); },
    toggle: toggle,
    close: function () { toggle(false); },
    isOpen: isOpen
  };`
		: "";
	return `(function () {
  "use strict";
  var dialog = document.getElementById("${options.dialogId}");
  if (!dialog) return;
  var opener = null;

  function isOpen() {
    return !dialog.hidden;
  }
  // A button inside a closed dialog has no boxes, so the rects are the test that
  // survives a hidden attribute, a collapsed panel, and a stylesheet swap alike.
  function focusables() {
    var nodes = Array.prototype.filter.call(dialog.querySelectorAll('${FOCUSABLE}'), function (node) {
      return node.getClientRects && node.getClientRects().length > 0;
    });
    // A panel that names itself focusable is where focus lands on open, so the close
    // button is not the first thing a dialog says with its ring. It stays first in the
    // list, which is what keeps Shift+Tab wrapping inside instead of escaping the scrim.
    var panel = dialog.querySelector('[role="dialog"][tabindex]');
    if (panel && panel.getClientRects && panel.getClientRects().length > 0) nodes.unshift(panel);
    return nodes;
  }
  function toggle(force) {
    var open = force === undefined ? dialog.hidden : force;
    if (open === isOpen()) return;
    dialog.hidden = !open;
    if (open) {
      opener = document.activeElement;
      var first = focusables()[0];
      if (first) first.focus();
    } else if (opener && opener.focus) {
      opener.focus();
      opener = null;
    }
  }

  var trigger = ${trigger};
  if (trigger) trigger.addEventListener("click", function () { toggle(); });
  var closer = ${closer};
  if (closer) closer.addEventListener("click", function () { toggle(false); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) toggle(false);
  });

  // Tab cycles inside the dialog: leaving it would put focus behind the scrim,
  // where the page looks inert but is not. Every Tab is redirected rather than only
  // the two that wrap, because the panel is the first node and the *container* of the
  // others: a browser's own backwards step from the last node has no sibling to land
  // on and walks out of the dialog instead.
  dialog.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var nodes = focusables();
    if (nodes.length === 0) { event.preventDefault(); return; }
    var at = nodes.indexOf(document.activeElement);
    var step = event.shiftKey ? -1 : 1;
    var next = at === -1 ? (event.shiftKey ? nodes.length - 1 : 0) : (at + step + nodes.length) % nodes.length;
    event.preventDefault();
    nodes[next].focus();
  });

  // Capture, so Esc closes the dialog before a page handler peels another layer.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !isOpen()) return;
    toggle(false);
    event.preventDefault();
    event.stopPropagation();
  }, true);

  ${expose}
})();`;
}

/**
 * The `?` keyboard sheet's wiring, shared by both clients.
 *
 * `triggerId` is the page's own shortcut button, since browse opens the sheet
 * from `#keys-open` and review from `#shortcuts`. The sheet's ids are the fixed
 * contract in `keysSheet` (`lib/web/markup.ts`), and the page's keydown handler
 * calls in through `window.bfKeys`.
 */
export function keysDialogScript(triggerId: string): string {
	return dialogScript({
		dialogId: "keys-dialog",
		closeId: "keys-close",
		triggerId,
		globalName: "bfKeys",
	});
}
