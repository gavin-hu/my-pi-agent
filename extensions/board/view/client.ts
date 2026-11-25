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

import { ACTIVITY_LABEL_JS } from "../../../lib/workflow/activity.ts";
import { MATCHES_QUERY_JS } from "../../../lib/workflow/card.ts";
import { CURRENT_REVIEW_JS } from "../../../lib/workflow/signs.ts";
import { REASON_FOR_JS } from "../../../lib/workflow/reason.ts";
import { DECISION_LABEL_JS, DECISION_RANK_JS, DECISION_TONE_JS, REASON_TONE_JS } from "../../../lib/workflow/tone.ts";
import { LANES } from "../../../lib/workflow/lanes.ts";
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
import { HISTORY_LINE_JS, HISTORY_OWNER_JS, RAN_CLAUSE_JS } from "../../../lib/workflow/round-text.ts";
import { LABEL_KEY_JS, SAME_LABEL_JS } from "../../../lib/session-label.ts";
import { unreadableText } from "../../../lib/session-mail.ts";
import { skippedText } from "../../../lib/workflow/skipped.ts";
import { AGE_WORDS_JS, FORMAT_AGE_JS, pageSource, PLURAL_JS, SHORTEN_PATH_JS } from "../../../lib/format.ts";
import { BOARD_CARD_JS } from "./card.ts";
import { BOARD_CLASS } from "./names.ts";
import { BOARD_EMPTY_JS } from "./empty.ts";
import { dialogJs } from "./dialog.ts";
import { BOARD_KEYS_JS } from "./keys.ts";
import { renderJs } from "./render.ts";
import { rosterJs } from "./roster.ts";
import { fleetJs } from "./fleet.ts";
import { activeJs } from "./active.ts";
import { feedJs } from "./feed.ts";
import { teamJs } from "./team.ts";
import { PICKER_MQ } from "./styles.ts";
import { liveJs } from "./live.ts";

/**
 * The page's two clocks, in milliseconds.
 *
 * They cross the string boundary as numbers rather than literals so a case can drive a short one:
 * a suite that asserts a mark leaving, or an age moving, would otherwise wait the product's own
 * period out for every assertion. {@link SHIPPED_PERIODS} is what the page ships with, and
 * {@link BOARD_CLIENT_JS} is that page — a bundle built from any other pair is a fixture's.
 */
export interface BoardPeriods {
	/** How long a moved card wears its mark. */
	changeMs: number;
	/** How often the page redraws the ages and the freshness badge. */
	ageTickMs: number;
}

/** How long a moved card wears its mark, in milliseconds: one breath, not a state. */
export const CHANGE_MS = 1500;

/** How often the page redraws what time changes, in milliseconds: the ages and the freshness badge. */
export const AGE_TICK_MS = 1000;

/** The periods the shipped page runs on: news wears one breath, and the ages tick once a second. */
export const SHIPPED_PERIODS: BoardPeriods = { changeMs: CHANGE_MS, ageTickMs: AGE_TICK_MS };

/**
 * The whole client, in load order: paint, round, the card dialog, keys, wiring, start.
 *
 * Eight rules cross the boundary as source — the count's wording, the tab title's
 * shape, what a `query` matches, why a card sits where it does, how an age reads, which
 * owners a round may state once, how that one line reads, and what a session is holding:
 * the browser has no import graph, and a second copy of any of them is exactly what this
 * bundle is not allowed to hold.
 */
export function boardClientJs(periods: BoardPeriods = SHIPPED_PERIODS): string {
	return `${CLIENT_BASE_JS}
${namesScript(BOARD_CLASS)}
${renderJs({
	changeMs: String(periods.changeMs),
	plural: PLURAL_JS,
	tabTitle: TAB_TITLE_JS,
	matches: MATCHES_QUERY_JS,
	reason: REASON_FOR_JS,
	currentReview: CURRENT_REVIEW_JS,
	age: FORMAT_AGE_JS,
	ageWords: AGE_WORDS_JS,
	lanes: String(LANES.length),
	skipped: pageSource(skippedText),
	decisions: DECISION_RANK_JS,
	decisionTones: DECISION_TONE_JS,
	reasonTones: REASON_TONE_JS,
	runtime: CLIENT_RUNTIME_JS,
})}
${rosterJs({ historyOwner: HISTORY_OWNER_JS, sameLabel: SAME_LABEL_JS, labelKey: LABEL_KEY_JS, unreadable: pageSource(unreadableText) })}
${fleetJs({ historyLine: HISTORY_LINE_JS })}
${activeJs({ decisionLabels: DECISION_LABEL_JS, sameLabel: SAME_LABEL_JS, labelKey: LABEL_KEY_JS })}
${feedJs({ labels: ACTIVITY_LABEL_JS })}
${teamJs()}
${BOARD_CARD_JS}
${BOARD_EMPTY_JS}
${dialogJs({ inlineMarkdown: INLINE_MARKDOWN_JS, shortenPath: SHORTEN_PATH_JS, ranClause: RAN_CLAUSE_JS })}
${BOARD_KEYS_JS}
${liveJs({ picker: String(PICKER_MQ), ageTick: String(periods.ageTickMs) })}
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
}

/** The shipped client: the page `/board` serves, on {@link SHIPPED_PERIODS}. */
export const BOARD_CLIENT_JS = boardClientJs();
