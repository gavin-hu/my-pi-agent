/**
 * The transcript block for one `board` result: the collapsed line a reader sees
 * without expanding, and the rows the expanded block draws.
 *
 * Both come from `details` alone, so a replayed session renders the same block it
 * rendered live — nothing is remembered between frames beyond the component the
 * transcript hands back.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { TailResult, type TailResultInput, type TailSection } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { plural } from "./format.ts";
import { boardRowLine } from "./rows.ts";
import type { BoardDetails } from "./types.ts";

/** One section of the expanded block. */
function section(label: string | undefined, cards: readonly Card[]): TailSection<Card> {
	return { label, rows: cards, more: 0, rowLine: boardRowLine };
}

/**
 * What the expanded block draws, or undefined when the action has nothing to list.
 *
 * A `list` is the board (or the one card it was asked for); a `list --round` is one
 * section per rollup group, in the order a lead reads them: owners, then what needs
 * a decision. Every other action produced one card, which the collapsed line
 * already names, so it has no rows.
 */
export function resultInput(details: BoardDetails): TailResultInput<Card> | undefined {
	if (details.action !== "list") return undefined;
	if (details.card) return { kind: "list", rows: [details.card], more: 0, rowLine: boardRowLine };
	const round = details.round;
	if (!round) {
		const cards = details.cards ?? [];
		return cards.length === 0 ? undefined : { kind: "list", rows: cards, more: 0, rowLine: boardRowLine };
	}
	const sections: TailSection<Card>[] = [];
	for (const group of round.owners) sections.push(section(group.label, group.cards));
	if (round.unassigned.length > 0) sections.push(section("Unassigned", round.unassigned));
	if (round.unplanned.length > 0) sections.push(section("Unplanned", round.unplanned));
	if (round.blocked.length > 0) sections.push(section("Blocked", round.blocked));
	if (round.idle.length > 0) sections.push(section("Idle", round.idle));
	if (round.done.length > 0) sections.push(section("Done", round.done));
	return sections.length === 0 ? undefined : { kind: "sections", sections };
}

/**
 * The one line a reader sees without expanding.
 *
 * It states the outcome of the call — what happened, to which card, in which lane —
 * so the transcript is readable as a log. A refusal never reaches here: the shared
 * `detailsOrLine` draws that instead.
 */
export function collapsedLine(theme: Theme, details: BoardDetails): string {
	const me = paint(theme, "faint", sanitizeLine(details.me.label));
	if (details.dropped)
		return `${paint(theme, "label", `${cardRef(details.dropped)} dropped`)} ${SEPARATORS.item} ${me}`;
	const card = details.card;
	if (card) return `${cardLine(theme, card)} ${SEPARATORS.item} ${me}`;
	const count = details.cards?.length ?? 0;
	const round = details.round;
	if (!round) return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${me}`;
	const owners = round.owners.length;
	return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${plural(owners, "owner")} ${SEPARATORS.item} ${me}`;
}

/** `#4 doing · Billing webhook accepts orders`, clipped by the caller's row helper. */
function cardLine(theme: Theme, card: Card): string {
	const id = paint(theme, "meta", cardRef(card.id));
	const lane = paint(theme, "accent", card.status);
	return `${id} ${lane} ${SEPARATORS.item} ${paint(theme, "label", sanitizeLine(card.title))}`;
}

/** The expanded block, as a component the transcript can reuse across renders. */
export class BoardResult implements Component {
	private readonly view: TailResult<Card>;

	constructor(input: TailResultInput<Card>, theme: Theme) {
		this.view = new TailResult(input, theme);
	}

	/** Update in place so the transcript reuses this component. */
	setInput(input: TailResultInput<Card>, theme: Theme): void {
		this.view.setInput(input, theme);
	}

	invalidate(): void {
		this.view.invalidate();
	}

	render(width: number): string[] {
		return this.view.render(width);
	}
}
