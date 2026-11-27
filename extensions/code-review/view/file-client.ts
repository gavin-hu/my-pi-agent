/**
 * The file view's own script: the page's stream, the wrap control, and the theme toggle.
 *
 * Served at {@link FILE_CLIENT_JS_PATH} and loaded with `src`, because the page's CSP is
 * `script-src 'self'` and refuses an inline one. The review page's client cannot come along:
 * its comment, place and send wiring belongs to a page that writes, and this one only reads.
 *
 * The stream is the point. A review's lifetime is its page's streams, so a tab that shows a
 * file without attaching one looks to the mount exactly like a tab that left — the closed-tab
 * grace runs out and the review is gone. The file view is the same page in the same tab, so it
 * attaches the page's own stream from the address and holds the review open. It paints nothing
 * from it: what a frame means is the diff page's business, and a page with nothing to say is
 * why `words` is a seam.
 *
 * Three shared bodies, spliced: `pageBase`, the `liveStream` client (one stream implementation
 * for every page, not a second `EventSource`), and the theme toggle. Each guard is its own, so
 * a page without a token, without a diff or without the button is still safe.
 */

import { pageSource } from "../../../lib/format.ts";
import { CLIENT_BASE_JS, liveStream } from "../../../lib/web/client-runtime.ts";
import { THEME_TOGGLE_JS } from "../../../lib/web/index.ts";

/** Where the file view's script is served, beside the shared theme restore. */
export const FILE_CLIENT_JS_PATH = "/file.js";

/**
 * The file view's script.
 *
 * A comment inside this body is prose without backticks: they would end the template. The
 * splice helpers are `pageSource`ed, so no annotation or replacement pattern may survive into
 * the string — the bodies are the shared ones, and this file contributes none.
 */
export const FILE_CLIENT_JS = `(function () {
${CLIENT_BASE_JS}
${pageSource(liveStream)}
  var token = new URLSearchParams(location.search).get("token") || "";
  if (token !== "") {
    liveStream({
      url: pageBase() + "/events",
      token: token,
      words: function () {},
      frame: function () {},
    });
  }

  var button = document.getElementById("rv-wrap");
  var diffs = document.querySelectorAll(".rv-diff");
  if (button && diffs.length > 0) {
    var setWrap = function (on) {
      button.setAttribute("aria-pressed", String(on));
      for (var index = 0; index < diffs.length; index++) {
        diffs[index].setAttribute("data-wrap", String(on));
      }
    };
    button.addEventListener("click", function () {
      setWrap(button.getAttribute("aria-pressed") !== "true");
    });
  }
  ${THEME_TOGGLE_JS}
})();`;
