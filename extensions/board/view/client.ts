/**
 * The client bundle: the modules that paint, round up, open a card, bind keys, and
 * follow the frame stream, plus the kit's own theme toggle and the two dialog scripts,
 * and the one entry point that starts them.
 *
 * Served as one string, because a page that opens six requests before it can paint
 * is a page that looks broken for a moment. Nothing here is typed — no compiler sees
 * a template string — so the split is by job and the class-contract test reads the
 * result: `render.ts` paints a whole frame, `card.ts` draws one card's face, `team.ts`
 * draws the round, `dialog.ts` opens one card, `keys.ts` binds, and `live.ts` owns the
 * tabs and the stream.
 *
 * Load order is a dependency: `card` and `team` take helpers from `render`, and `live`
 * starts last, after every `board.*` handler it wires exists.
 */

import { MATCHES_QUERY_JS } from "../../../lib/board/card.ts";
import { REASON_FOR_JS } from "../../../lib/board/reason.ts";
import { DECISION_RANK_JS, DECISION_TONE_JS, REASON_TONE_JS } from "../../../lib/board/tone.ts";
import { LANES } from "../../../lib/board/lanes.ts";
import {
	CLIENT_BASE_JS,
	CLIENT_RUNTIME_JS,
	dialogScript,
	INLINE_MARKDOWN_JS,
	keysDialogScript,
	namesScript,
	TAB_TITLE_JS,
	THEME_TOGGLE_JS,
} from "../../../lib/web/index.ts";
import { PLURAL_JS, HISTORY_LINE_JS, HISTORY_OWNER_JS } from "../../../lib/board/round-text.ts";
import { skippedText } from "../../../lib/board/skipped.ts";
import { FORMAT_AGE_JS } from "../../../lib/format.ts";
import { BOARD_CARD_JS } from "./card.ts";
import { BOARD_CLASS } from "./names.ts";
import { BOARD_EMPTY_JS } from "./empty.ts";
import { dialogJs } from "./dialog.ts";
import { BOARD_KEYS_JS } from "./keys.ts";
import { BOARD_LIVE_JS } from "./live.ts";
import { renderJs } from "./render.ts";
import { teamJs } from "./team.ts";

/**
 * The whole client, in load order: paint, round, the card dialog, keys, wiring, start.
 *
 * Seven rules cross the boundary as source — the count's wording, the tab title's
 * shape, what a `query` matches, why a card sits where it does, how an age reads, which
 * owners a round may state once, and how that one line reads: the browser has no import
 * graph, and a second copy of any of them is exactly what this bundle is not allowed to hold.
 */
export const BOARD_CLIENT_JS = `${CLIENT_BASE_JS}
${namesScript(BOARD_CLASS)}
${renderJs({ plural: PLURAL_JS, tabTitle: TAB_TITLE_JS, matches: MATCHES_QUERY_JS, reason: REASON_FOR_JS, age: FORMAT_AGE_JS, lanes: String(LANES.length), skipped: String(skippedText), decisions: DECISION_RANK_JS, decisionTones: DECISION_TONE_JS, reasonTones: REASON_TONE_JS, runtime: CLIENT_RUNTIME_JS })}
${teamJs({ historyOwner: HISTORY_OWNER_JS, historyLine: HISTORY_LINE_JS })}
${BOARD_CARD_JS}
${BOARD_EMPTY_JS}
${dialogJs({ inlineMarkdown: INLINE_MARKDOWN_JS })}
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
