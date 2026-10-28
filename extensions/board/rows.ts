/**
 * The board's row grammar: the one place a card becomes a line in the transcript.
 *
 * Every field comes from a card file, which the model wrote and a person may have
 * edited, so it is sanitized here at the boundary that reaches the terminal, and
 * every row is clipped to the width it was given by the shared row helpers.
 *
 * The colours come from `lib/board/tone.ts` — the table the page reads too — through
 * `TONE_ROLE`, so a lane's word in the transcript is the lane's colour on the page. Each
 * word is painted on its own, which means the separator between two words is painted as
 * well: a bare ` · ` would fall back to the terminal's default foreground between two
 * coloured words.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef, DEFAULT_PRIORITY, holds, priorityOf } from "../../lib/board/card.ts";
import { LANE_RULES } from "../../lib/board/lanes.ts";
import type { Actor } from "../../lib/board/rules.ts";
import { type BoardTone, REASON_TONE } from "../../lib/board/tone.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { clip, splitRow } from "../../lib/tui/columns.ts";
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
 * Who holds a card, the lane it sits in, and — for work in flight — whether it was planned
 * first, with the priority when it is not the ordinary one.
 *
 * A row carries the lane because a flat listing has no section heading to say it, and
 * "planned" because a card nobody planned is the one a lead looks at. The priority rides
 * along for the same reason: inside a lane the order is the priority, and an order nobody
 * can see reads as an accident.
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
	// The pool has no plan to speak of and a finished card is history, so only a lane
	// somebody is working in says whether the work was planned first. An unplanned card
	// wears the tone the page's reason line gives the same fact.
	const rule = LANE_RULES[card.lane];
	if (!rule.ownerless && !rule.terminal) {
		facts.push(
			card.planPath === undefined
				? { text: "unplanned", tone: REASON_TONE.contract }
				: { text: "planned", tone: "muted" },
		);
	}
	return facts;
}

/** One card: the id and title, with its facts trailing. */
function cardRowText(card: Card, width: number, theme: Theme, self: boolean): string {
	const head = paint(theme, self ? "accent" : "label", `${cardRef(card.id)} ${sanitizeLine(card.title)}`);
	const gap = paint(theme, "meta", SEPARATORS.item);
	const trailing = factsOf(card)
		.map((fact) => paint(theme, TONE_ROLE[fact.tone], fact.text))
		.join(gap);
	return splitRow(head, clip(trailing, width), width);
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
