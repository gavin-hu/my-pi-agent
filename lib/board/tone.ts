/**
 * What tone a lane, a reason, and a Team decision row wear.
 *
 * The page and the terminal each decide a colour, and before this table they decided it in
 * seven places: a lane role in the lane table, a reason class in the browser bundle, two
 * hand-written `[data-kind]` edge rules, a second `blocked` rule for the queue's why line,
 * and a transcript that painted every lane the same accent. A tone stated once is the only
 * version of that which cannot drift.
 *
 * A tone is a word the page's kit already names as a property (`var(--warn)`), so the page
 * wears one directly and needs no map. The terminal speaks its own vocabulary — `ok`, `warn`,
 * `bad`, `meta`, `faint` — and that bridge lives in `extensions/board/tone.ts`, because only
 * the transcript speaks it.
 *
 * The rule behind the words, so a future kind is not a guess: **warn is a person who must act
 * next** (approve, review, decide), **danger is a refusal or a loss** (blocked, gone), and
 * anything merely true of the card — waiting, offered, executing, done, noted — is muted.
 *
 * Value-only: no I/O, no clock, no card.
 */

import type { LaneRole } from "./lanes.ts";
import type { ReasonKind } from "./reason.ts";

/**
 * A colour a board surface may wear.
 *
 * `dim` joins the lane roles because a Team queue row nobody has to act on yet is quieter
 * than a muted one: drawn, not emphasised.
 */
export type BoardTone = LaneRole | "dim";

/** Every tone, in the order a rule is written for one. */
export const BOARD_TONES = ["muted", "dim", "warn", "accent", "danger", "success"] as const;

/**
 * The tone a card's reason line wears, by the kind `reason.ts` reports.
 *
 * `waiting` is here even though `reasonFor` never returns it: the page's card face invents it
 * for a card that names what it waits on (`view/card.ts`), so the table has to answer for it
 * or that line would draw the default.
 */
export const REASON_TONE: Record<ReasonKind, BoardTone> = {
	waiting: "muted",
	blocked: "danger",
	offered: "muted",
	contract: "warn",
	approval: "warn",
	executing: "muted",
	review: "warn",
	done: "muted",
	note: "muted",
};

/**
 * The Team queue's decision kinds, in the order a lead reads them.
 *
 * One list for both facts a row needs: the position is the rank (a `gone` owner outranks a
 * card merely sitting still), and {@link DECISION_TONE} is the colour. They were two lists — a
 * `KIND_RANK` object in the bundle and a hand-written set of `[data-kind]` rules in the
 * stylesheet — which is how `gone` came to be ranked second and drawn quietest.
 */
export const DECISION_KINDS = ["blocked", "gone", "approval", "waiting", "idle", "unplanned", "unassigned"] as const;

/** One reason a card is in the lead's queue. */
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** The tone a decision row's edge, and a danger row's reason line, wear. */
export const DECISION_TONE: Record<DecisionKind, BoardTone> = {
	blocked: "danger",
	gone: "danger",
	approval: "warn",
	waiting: "dim",
	idle: "warn",
	unplanned: "dim",
	unassigned: "dim",
};

/**
 * {@link DECISION_KINDS} as the browser bundle's own source.
 *
 * The page ranks its queue by this list, and the bundle is a string, so the order travels as
 * data the way `reasonFor` and `matchesQuery` do: one list in `lib/`, spliced in, never a
 * second copy in the browser. `test` parses it back to the tuple.
 */
export const DECISION_RANK_JS = JSON.stringify(DECISION_KINDS);

/** {@link DECISION_TONE} as the bundle's own source, spliced in like the rank. */
export const DECISION_TONE_JS = JSON.stringify(DECISION_TONE);

/** {@link REASON_TONE} as the bundle's own source, spliced in like the rank. */
export const REASON_TONE_JS = JSON.stringify(REASON_TONE);
