/**
 * The board's row grammar: the one place a card becomes a line in the transcript.
 *
 * Every field comes from a card file, which the model wrote and a person may have
 * edited, so it is sanitized here at the boundary that reaches the terminal, and
 * every row is clipped to the width it was given by the shared row helpers.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef, DEFAULT_PRIORITY, priorityOf } from "../../lib/board/card.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { listRow } from "../../lib/tui/rows.ts";
import type { TailRowLine } from "../../lib/tui/tool.ts";

/** Who holds a card, as the row's trailing text. */
function holderOf(card: Card): string {
	if (card.owner === undefined) return "unassigned";
	return sanitizeLine(card.owner.label);
}

/**
 * The lane, and — for work in flight — whether it was planned first, and — when it is
 * not the ordinary one — how urgent it is.
 *
 * A row carries the lane because a flat listing has no section heading to say it, and
 * "planned" because a `doing` card nobody planned is the one a lead looks at. The
 * priority rides along for the same reason: inside a lane the order is the priority,
 * and an order nobody can see reads as an accident.
 */
function stateOf(card: Card): string[] {
	const urgency = priorityOf(card) === DEFAULT_PRIORITY ? [] : [priorityOf(card)];
	if (card.status === "todo" || card.status === "done") return [...urgency, card.status];
	return [...urgency, card.status, card.plan === undefined ? "unplanned" : "planned"];
}

/** One card: the id and title, with its state trailing. */
export function cardRowLine(card: Card, width: number, theme: Theme, options: { self?: boolean } = {}): string {
	return listRow(theme, width, {
		marker: false,
		label: `${cardRef(card.id)} ${sanitizeLine(card.title)}`,
		labelRole: options.self === true ? "accent" : "label",
		trailing: [holderOf(card), ...stateOf(card)].join(SEPARATORS.item),
	});
}

/** The row renderer every board section uses. */
export const boardRowLine: TailRowLine<Card> = (card, width, theme) => cardRowLine(card, width, theme);
