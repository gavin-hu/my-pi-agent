/**
 * The client bundle: the modules that paint, round up, open a card, bind keys, and
 * follow the frame stream, plus the kit's own theme toggle and the two dialog scripts,
 * and the one entry point that starts them.
 *
 * Served as one string, because a page that opens six requests before it can paint
 * is a page that looks broken for a moment. Nothing here is typed — no compiler sees
 * a template string — so the split is by job and the class-contract test reads the
 * result: `render.ts` paints, `team.ts` draws the round, `dialog.ts` opens one card,
 * `keys.ts` binds, and `live.ts` owns the tabs and the stream.
 *
 * Load order is a dependency: `team` takes helpers from `render`, and `live` starts
 * last, after every `board.*` handler it wires exists.
 */

import { MATCHES_QUERY_JS } from "../../../lib/board/card.ts";
import { CLIENT_RUNTIME_JS } from "../../../lib/web/index.ts";
import { PLURAL_JS } from "../../../lib/board/round-text.ts";
import { FORMAT_AGE_JS } from "../../../lib/format.ts";
import { namesScript, TAB_TITLE_JS, THEME_TOGGLE_JS, dialogScript, keysDialogScript } from "../../../lib/web/index.ts";
import { BOARD_CLASS } from "./names.ts";
import { BOARD_DIALOG_JS } from "./dialog.ts";
import { BOARD_KEYS_JS } from "./keys.ts";
import { BOARD_LIVE_JS } from "./live.ts";
import { renderJs } from "./render.ts";
import { BOARD_TEAM_JS } from "./team.ts";

/**
 * The whole client, in load order: paint, round, the card dialog, keys, wiring, start.
 *
 * Four rules cross the boundary as source — the count's wording, the tab title's
 * shape, what a `query` matches, and how an age reads: the browser has no import graph,
 * and a second copy of any of them is exactly what this bundle is not allowed to hold.
 */
export const BOARD_CLIENT_JS = `${namesScript(BOARD_CLASS)}
${renderJs({ plural: PLURAL_JS, tabTitle: TAB_TITLE_JS, matches: MATCHES_QUERY_JS, age: FORMAT_AGE_JS, runtime: CLIENT_RUNTIME_JS })}
${BOARD_TEAM_JS}
${BOARD_DIALOG_JS}
${BOARD_KEYS_JS}
${BOARD_LIVE_JS}
${THEME_TOGGLE_JS}
${dialogScript({ dialogId: "board-card-dialog", closeId: "card-dialog-close", globalName: "bfCard" })}
${keysDialogScript("keys-open")}
(function () {
  "use strict";
  var board = window.bfBoard;
  if (!board) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { board.start(); });
  else board.start();
})();
`;
