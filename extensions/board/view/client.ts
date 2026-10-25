/**
 * The client bundle: the three modules that render, write, and follow the frame
 * stream, plus the shared theme toggle and the one entry point that starts them.
 *
 * Served as one string, because a page that opens three requests before it can
 * paint is a page that looks broken for a moment. Nothing here is typed — no
 * compiler sees a template string — so the split is by job rather than by size:
 * `render.ts` builds nodes from the snapshot and never parses a field, `actions.ts`
 * posts one named action at a time, and `live.ts` owns the tabs and the stream.
 */

import { THEME_TOGGLE_JS } from "../../../lib/web/index.ts";
import { BOARD_ACTIONS_JS } from "./actions.ts";
import { BOARD_LIVE_JS } from "./live.ts";
import { BOARD_RENDER_JS } from "./render.ts";

/** The whole client, in load order: helpers, writes, wiring, then start. */
export const BOARD_CLIENT_JS = `${BOARD_RENDER_JS}
${BOARD_ACTIONS_JS}
${BOARD_LIVE_JS}
${THEME_TOGGLE_JS}
(function () {
  "use strict";
  var board = window.bfBoard;
  if (!board) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { board.start(); });
  else board.start();
})();
`;
