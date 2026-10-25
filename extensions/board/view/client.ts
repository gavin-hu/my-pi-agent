/**
 * The client bundle: the five modules that paint, round up, write, bind keys, and
 * follow the frame stream, plus the kit's own theme toggle and one `dialogScript`
 * per modal, and the one entry point that starts them.
 *
 * Served as one string, because a page that opens six requests before it can paint
 * is a page that looks broken for a moment. Nothing here is typed — no compiler sees
 * a template string — so the split is by job and the class-contract test reads the
 * result: `render.ts` paints, `team.ts` draws the round, `actions.ts` posts and owns
 * the two dialogs, `keys.ts` binds, and `live.ts` owns the tabs and the stream.
 *
 * Load order is a dependency: `team` takes helpers from `render`, and `live` starts
 * last, after every `board.*` handler it wires exists.
 */

import { THEME_TOGGLE_JS, dialogScript, keysDialogScript } from "../../../lib/web/index.ts";
import { BOARD_ACTIONS_JS } from "./actions.ts";
import { BOARD_KEYS_JS } from "./keys.ts";
import { BOARD_LIVE_JS } from "./live.ts";
import { BOARD_RENDER_JS } from "./render.ts";
import { BOARD_TEAM_JS } from "./team.ts";

/** The whole client, in load order: paint, round, write, keys, wiring, then start. */
export const BOARD_CLIENT_JS = `${BOARD_RENDER_JS}
${BOARD_TEAM_JS}
${BOARD_ACTIONS_JS}
${BOARD_KEYS_JS}
${BOARD_LIVE_JS}
${THEME_TOGGLE_JS}
${dialogScript({ dialogId: "board-new-dialog", closeId: "new-dialog-close", globalName: "bfNew" })}
${dialogScript({ dialogId: "board-card-dialog", closeId: "card-dialog-close", globalName: "bfCard" })}
${dialogScript({ dialogId: "board-confirm", globalName: "bfConfirm" })}
${keysDialogScript("keys-open")}
(function () {
  "use strict";
  var board = window.bfBoard;
  if (!board) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { board.start(); });
  else board.start();
})();
`;
