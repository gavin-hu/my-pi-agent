/**
 * The board's row grammar: the one place a card becomes a line in the transcript.
 *
 * Every field comes from a card file, which the model wrote and a person may have
 * edited, so it is sanitized here at the boundary that reaches the terminal, and
 * every row is clipped to the width it was given by the shared row helpers.
 *
 * The colours come from `lib/workflow/tone.ts` — the table the page reads too — through
 * `TONE_ROLE`, so a lane's word in the transcript is the lane's colour on the page. Each
 * word is painted on its own, which means the separator between two words is painted as
 * well: a bare ` · ` would fall back to the terminal's default foreground between two
 * coloured words.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type Card, cardRef, DEFAULT_PRIORITY, holds, priorityOf } from "../../lib/workflow/card.ts";
import { gateOf } from "../../lib/workflow/round.ts";
import { GATE_WORD } from "../../lib/workflow/tone.ts";
import { LANE_RULES } from "../../lib/workflow/lanes.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import { type BoardTone, REASON_TONE } from "../../lib/workflow/tone.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { clip, splitRow, usableWidth } from "../../lib/tui/columns.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { TailRowLine } from "../../lib/tui/tool.ts";
import { TONE_ROLE } from "./tone.ts";

/** One fact the row states about a card, and the tone it wears. */
interface Fact {
	text: string;
	tone: BoardTone;
}

/**
 * Who holds a card, the lane it sits in, what it still owes, with the priority when it is not
 * the ordinary one.
 *
 * A row carries the lane because a flat listing has no section heading to say it, and the gate —
 * the contract, the approval, the spot-check — because a card waiting for a signature used to
 * read exactly like one that had it. The priority rides along for the same reason: inside a lane
 * the order is the priority, and an order nobody can see reads as an accident.
 */
function factsOf(card: Card): Fact[] {
	const facts: Fact[] = [
		{
			text: card.owner === undefined ? "unassigned" : sanitizeLine(card.owner.label),
			tone: "muted",
		},
	];
	const priority = priorityOf(card);
	if (priority !== DEFAULT_PRIORITY) facts.push({ text: priority, tone: "muted" });
	facts.push({ text: card.lane, tone: LANE_RULES[card.lane].role });
	// What the card owes before it can move on, in the words the Team queue's pills use. A card
	// that owes no gate says nothing: `planned` was a word about a file, and it read the same as
	// a card waiting for a signature.
	const gate = gateOf(card);
	if (gate !== undefined) facts.push({ text: GATE_WORD[gate], tone: REASON_TONE[gate] });
	return facts;
}

/**
 * The narrowest a card's number and title may become before its facts move down.
 *
 * The head is the row's identity and the facts are its suffix, so a row that spent its last
 * columns on the facts stopped saying which card it was. That is worst exactly where a row is
 * most needed: in a rollup section the heading already says what the card owes, and only the row
 * can say which card owes it.
 */
const MIN_HEAD = 24;

/** One card: the id and title, with its facts trailing. */
function cardRowText(card: Card, width: number, theme: Theme, self: boolean): string | readonly string[] {
	const head = paint(theme, self ? "accent" : "label", `${cardRef(card.id)} ${sanitizeLine(card.title)}`);
	const gap = paint(theme, "meta", SEPARATORS.item);
	const trailing = factsOf(card)
		.map((fact) => paint(theme, TONE_ROLE[fact.tone], fact.text))
		.join(gap);
	return foldCardRow(head, trailing, width);
}

/**
 * The row, folded when the facts would leave the head below its floor.
 *
 * Two cells that fit, or a head that keeps `MIN_HEAD` columns, draw the row the way it has always
 * been drawn: `splitRow`'s right anchor still wins for a head with room to spare. Past that the
 * facts move to their own line rather than into the head's last columns, so a narrow terminal
 * keeps the card's number and the start of its title — the two things the row exists to say.
 *
 * Not `messageRowLines` (session-bus's fold) and not shared with it: a card row folds two fixed
 * cells, while a message row promotes its meta to a heading and wraps prose under it. The two
 * name different operations on purpose.
 */
function foldCardRow(head: string, facts: string, width: number): string | readonly string[] {
	const w = usableWidth(width);
	const trailing = clip(facts, w);
	const headBudget = w - visibleWidth(trailing) - 1;
	if (visibleWidth(head) <= headBudget || headBudget >= MIN_HEAD) return splitRow(head, facts, w);
	// The indent is spent only when it costs no column, the rule `fitCells` uses for its separator:
	// otherwise the facts would lose their last character to a gap.
	const continuation = w - visibleWidth(trailing) >= 2 ? `  ${trailing}` : trailing;
	return [clip(head, w), clip(continuation, w)];
}

/**
 * The row renderer every board section uses, for the session reading it.
 *
 * `me` matters: a `list` narrowed to this session's own cards should look like it, so the
 * holder's rows wear the accent the page gives the card the reader is looking at. Passing
 * no actor draws every row the same, which is what a card produced by an action gets.
 */
export function boardRowLineFor(me?: Actor): TailRowLine<Card> {
	return (card, width, theme) => cardRowText(card, width, theme, me !== undefined && holds(card, me));
}
