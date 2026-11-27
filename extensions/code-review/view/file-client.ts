/**
 * The file view's own script: the shared theme toggle, then the wrap control it draws.
 *
 * Served at {@link FILE_CLIENT_JS_PATH} and loaded with `src`, because the page's CSP is
 * `script-src 'self'` and refuses an inline one. The review page's client cannot come
 * along: its comment, place and stream wiring belongs to a page that writes, and this one
 * only reads.
 *
 * Both halves guard their own element, so the same body is safe on a page that drew no
 * diff or no control row — a binary file, or the review's problem page, which loads it for
 * the toggle alone.
 */

import { THEME_TOGGLE_JS } from "../../../lib/web/index.ts";

/** Where the file view's script is served, beside the shared theme restore. */
export const FILE_CLIENT_JS_PATH = "/file.js";

/**
 * The file view's script.
 *
 * The wrap block writes the one state the server rendered and the button reports, and no
 * more: the file view wraps at every width by default, so there is no fold to follow and no
 * choice to remember — the reader's press is this tab's, until the page is loaded again.
 * A comment inside the body is prose without backticks: they would end the template.
 */
export const FILE_CLIENT_JS = String.raw`(function () {
  var button = document.getElementById("rv-wrap");
  var diffs = document.querySelectorAll(".rv-diff");
  if (!button || diffs.length === 0) return;

  function setWrap(on) {
    button.setAttribute("aria-pressed", String(on));
    for (var index = 0; index < diffs.length; index++) {
      diffs[index].setAttribute("data-wrap", String(on));
    }
  }

  button.addEventListener("click", function () {
    setWrap(button.getAttribute("aria-pressed") !== "true");
  });
})();
${THEME_TOGGLE_JS}`;
