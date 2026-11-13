/**
 * What tone a lane, a reason, and a Team decision row wear, and which band a decision is filed
 * under.
 *
 * The page and the terminal each decide a colour, and before this table they decided it in
 * seven places: a lane role in the lane table, a reason class in the browser bundle, two
 * hand-written `[data-kind]` edge rules, a second `blocked` rule for the queue's why line,
 * and a transcript that painted every lane the same accent. A tone stated once is the only
 * version of that which cannot drift.
 *
 * The words a decision row wears live here for the same reason: its pill, its rank, and the
 * band it is filed under are three facts about one kind, and the page, whose whole vocabulary
 * is a string, has no compiler to catch them drifting apart.
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
export const DECISION_KINDS = [
	"blocked",
	"gone",
	"approval",
	"review",
	"waiting",
	"unwritten",
	"unplanned",
	"unassigned",
] as const;

/** One reason a card is in the lead's queue. */
export type DecisionKind = (typeof DECISION_KINDS)[number];

/**
 * The pill a decision wears, one phrase per kind, beside the rank and the tone it already has.
 *
 * The row's sentence says why in full and is one hover away; this is what a reader scans by.
 * A label that repeats its kind ("blocked" for `blocked`) is the right answer rather than a
 * wasted entry: the pill is the shape, and the word is what a colour alone cannot say.
 */
export const DECISION_LABEL: Record<DecisionKind, string> = {
	blocked: "blocked",
	gone: "owner gone",
	approval: "needs approval",
	review: "needs review",
	waiting: "waits",
	unwritten: "unwritten",
	unplanned: "no contract",
	unassigned: "unassigned",
};

/** {@link DECISION_LABEL} as the browser bundle's own source, spliced in like the rank. */
export const DECISION_LABEL_JS = JSON.stringify(DECISION_LABEL);

/**
 * The route gates a card can owe, in the order a card meets them.
 *
 * A card in flight owes at most one: the contract of a `plan` card, that contract's approval, or
 * the spot-check that lets an execution close. `gateOf` in `round.ts` is the rule that answers
 * which — this is the closed list and the words, so the transcript's row, `board list`'s line and
 * the Team queue cannot spell one state two ways.
 */
export const GATES = ["contract", "approval", "review"] as const;

/** One gate a card still owes. */
export type Gate = (typeof GATES)[number];

/** The word a gate wears, taken from the table the queue's pills read. */
export const GATE_WORD: Record<Gate, string> = {
	contract: DECISION_LABEL.unplanned,
	approval: DECISION_LABEL.approval,
	review: DECISION_LABEL.review,
};

/**
 * How the queue's rows are grouped, in the order the column reads them.
 *
 * A lead reads the queue to answer one question first — *whose move is this?* — and the kinds
 * alone cannot: `unassigned` and `needs approval` sat in one list, which is why a queue of
 * backlog cards read as the backlog. The order is the order of obligation: what only the lead
 * can sign, then what is nobody's, then what a card's own owner owes.
 */
export const DECISION_BANDS = ["signature", "claim", "stalled"] as const;

/** One band a queue row is filed under. */
export type DecisionBand = (typeof DECISION_BANDS)[number];

/**
 * The band each kind is filed under.
 *
 * A table over every kind rather than a rule over the ones that fit: a new kind must name its
 * band here, and the compiler is what says so — the alternative was a `switch` in a string.
 */
export const DECISION_BAND: Record<DecisionKind, DecisionBand> = {
	approval: "signature",
	review: "signature",
	unassigned: "claim",
	gone: "claim",
	waiting: "claim",
	blocked: "stalled",
	unwritten: "stalled",
	unplanned: "stalled",
};

/** The band's name in the column: the word for whose move it is, not for what is wrong. */
export const DECISION_BAND_LABEL: Record<DecisionBand, string> = {
	signature: "Your signature",
	claim: "Unclaimed",
	stalled: "Stalled",
};

/** The bands, their kinds, and their names as the bundle's own source, spliced in like the rank. */
export const DECISION_BAND_JS = JSON.stringify({
	order: DECISION_BANDS,
	of: DECISION_BAND,
	label: DECISION_BAND_LABEL,
});

/** The tone a decision's pill wears, and a danger row's sentence. */
export const DECISION_TONE: Record<DecisionKind, BoardTone> = {
	blocked: "danger",
	gone: "danger",
	approval: "warn",
	review: "warn",
	waiting: "dim",
	unwritten: "warn",
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
