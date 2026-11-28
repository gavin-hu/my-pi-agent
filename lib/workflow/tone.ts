/**
 * What tone a lane, a reason, and a Team decision row wear, and the words a decision wears.
 *
 * The page and the terminal each decide a colour, and before this table they decided it in
 * seven places: a lane role in the lane table, a reason class in the browser bundle, two
 * hand-written `[data-kind]` edge rules, a second `blocked` rule for the queue's why line,
 * and a transcript that painted every lane the same accent. A tone stated once is the only
 * version of that which cannot drift.
 *
 * The words a decision row wears live here for the same reason: its pill, its rank, and its tone
 * are three facts about one kind, and the page, whose whole vocabulary is a string, has no
 * compiler to catch them drifting apart.
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
 * A decision's tone ranks it inside one list, which is what the queue has read since its bands
 * went: a gate the seat must sign is `warn`, a loss already suffered is `danger`, and advice —
 * a card nobody has written to, which the seat may chase or spot-check — is `dim`, drawn and not
 * emphasised. Tone is the only ranking a flat list carries, so it follows that rule and no
 * other.
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
 * `waiting` and `ready` are here even though `reasonFor` returns neither: the page's card face
 * invents them from the two dependency fields the snapshot derives (`view/card.ts`), so the table
 * has to answer for them or that line would draw the default. Both are muted, because anything
 * merely true of the card is: a card that stopped waiting is not asking anybody for anything.
 */
export const REASON_TONE: Record<ReasonKind, BoardTone> = {
	waiting: "muted",
	ready: "muted",
	blocked: "danger",
	offered: "muted",
	shelved: "muted",
	contract: "warn",
	approval: "warn",
	executing: "muted",
	review: "warn",
	done: "muted",
	note: "muted",
};

/**
 * Every kind of reason a card can wait on the lead, in the order a lead reads them.
 *
 * One list for every fact a row needs: the position is the rank (a `gone` owner outranks a card
 * merely sitting still), and {@link DECISION_TONE} is the colour. They were two lists — a
 * `KIND_RANK` object in the bundle and a hand-written set of `[data-kind]` rules in the
 * stylesheet — which is how `gone` came to be ranked second and drawn quietest.
 *
 * The page's queue files four of these — `gone`, `untold`, `approval`, `unwritten` — because a
 * row is a move only the seat can finish; the other five are what a card owes its own holder, and
 * the transcript's rollup is the surface that counts them. The table stays whole: the rank is one
 * order whichever subset a surface draws, and a kind that files again needs no new word.
 */
export const DECISION_KINDS = [
	"blocked",
	"gone",
	"untold",
	"approval",
	"review",
	"waiting",
	"unwritten",
	"unplanned",
	"unassigned",
] as const;

/** One reason a card can wait on the lead. */
export type DecisionKind = (typeof DECISION_KINDS)[number];

/**
 * The pill a decision wears, one phrase per kind, beside the rank and the tone it already has.
 *
 * The row's sentence says why in full and is one hover away; this is what a reader scans by.
 * A label that repeats its kind ("blocked" for `blocked`) is the right answer rather than a
 * wasted entry: the pill is the shape, and the word is what a colour alone cannot say.
 *
 * A kind's own name is not always the pill's word: `unwritten` reads `no writes`, because the
 * row's sentence counts writes and `quiet` is already a `RosterState` this page prints beside a
 * holder's name — one word for two facts is what a pill must not do.
 */
export const DECISION_LABEL: Record<DecisionKind, string> = {
	blocked: "blocked",
	gone: "owner gone",
	untold: "not told",
	approval: "needs approval",
	review: "needs review",
	waiting: "waits",
	unwritten: "no writes",
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
 * The tone a decision's pill wears, and a danger row's sentence.
 *
 * Read down the four kinds the page's queue can file: a loss is `danger`, a gate the seat signs is
 * `warn`, and the one judgement the page makes for itself — a card with no writes — is `dim`,
 * because it is advice rather than a gate. `dim` exists for that row (see {@link BoardTone}), and
 * tone is the only ranking a flat list carries.
 */
export const DECISION_TONE: Record<DecisionKind, BoardTone> = {
	blocked: "danger",
	gone: "danger",
	untold: "warn",
	approval: "warn",
	review: "warn",
	waiting: "dim",
	unwritten: "dim",
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
