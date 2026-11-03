/**
 * The transcript block for one `board` result: the collapsed line a reader sees
 * without expanding, and the rows the expanded block draws.
 *
 * Both come from `details` alone, so a replayed session renders the same block it
 * rendered live — nothing is remembered between frames beyond the component the
 * transcript hands back.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { LANE_RULES } from "../../lib/board/lanes.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import type { TailResultInput, TailSection, TailRowLine } from "../../lib/tui/tool.ts";
import { plural } from "../../lib/board/round-text.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { boardRowLineFor } from "./rows.ts";
import { TONE_ROLE } from "./tone.ts";
import type { ArchiveOutcome, BoardDetails } from "./types.ts";

/** One section of the expanded block, drawn as the session that asked for it. */
function section(label: string | undefined, cards: readonly Card[], rowLine: TailRowLine<Card>): TailSection<Card> {
	return { label, rows: cards, more: 0, rowLine };
}

/**
 * What the expanded block draws, or undefined when the action has nothing to list.
 *
 * A `list` is the board (or the one card it was asked for); a `list --round` is that
 * listing — when a filter made it a slice — above one section per rollup group, in the
 * order a lead reads them: owners, then what needs a decision. Every other action produced
 * one card, which the collapsed line already names, so it has no rows.
 */
export function resultInput(details: BoardDetails): TailResultInput<Card> | undefined {
	if (details.action !== "list") return undefined;
	// Only a read narrowed to this session's own cards marks them, and it marks them with
	// the rule the filter used: the rows and the filter agree about what "mine" means.
	const rowLine = boardRowLineFor(details.mine === true ? details.me : undefined);
	// The rollup is the whole board, so its rows are nobody's in particular: the accent means
	// "this row is yours" and a group holding a peer's card is not.
	const rollupLine = boardRowLineFor();
	if (details.card) return { kind: "list", rows: [details.card], more: 0, rowLine };
	const round = details.round;
	if (!round) {
		const cards = details.cards ?? [];
		return cards.length === 0 ? undefined : { kind: "list", rows: cards, more: 0, rowLine };
	}
	const sections: TailSection<Card>[] = [];
	// The slice the call asked for, unlabelled because it is the listing rather than a group
	// of one, and only when a filter made it a slice: a bare `round` already draws every one
	// of those cards in the rollup below.
	const slice = details.narrowed === true ? (details.cards ?? []) : [];
	if (slice.length > 0) sections.push(section(undefined, slice, rowLine));
	// An owner whose last card is done keeps its group, because the round's text line still counts
	// what it finished — but the group has no rows, so a heading here would draw a label above
	// nothing, and the finished cards themselves are already in the `Done` section below.
	for (const group of round.owners) {
		if (group.cards.length === 0) continue;
		sections.push(section(group.label, group.cards, rollupLine));
	}
	if (round.unassigned.length > 0) sections.push(section("Unassigned", round.unassigned, rollupLine));
	if (round.unplanned.length > 0) sections.push(section("Unplanned", round.unplanned, rollupLine));
	// The lead's first signature: a contract nobody has signed is a card the flow stops on, so
	// it is drawn in the order `formatRound` prints it rather than left to the text above.
	if (round.unapproved.length > 0) sections.push(section("Awaiting approval", round.unapproved, rollupLine));
	// The lead's second signature: a card the lead has not looked at yet is one the flow stops
	// on just as surely, so it is drawn beside the first rather than left to `unwritten`'s clock.
	if (round.unreviewed.length > 0) sections.push(section("Awaiting review", round.unreviewed, rollupLine));
	if (round.blocked.length > 0) sections.push(section("Blocked", round.blocked, rollupLine));
	if (round.unwritten.length > 0) sections.push(section("Unwritten", round.unwritten, rollupLine));
	if (round.done.length > 0) sections.push(section("Done", round.done, rollupLine));
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
	if (details.archive) return `${archiveLine(theme, details.archive)} ${SEPARATORS.item} ${me}`;
	if (details.dropped)
		return `${paint(theme, "label", `${cardRef(details.dropped)} dropped`)} ${SEPARATORS.item} ${me}`;
	const card = details.card;
	if (card) return `${cardLine(theme, card)} ${SEPARATORS.item} ${me}${toldLine(theme, details.told)}`;
	const count = details.cards?.length ?? 0;
	const round = details.round;
	if (!round) return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${me}`;
	const owners = round.owners.length;
	return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${plural(owners, "owner")} ${SEPARATORS.item} ${me}`;
}

/**
 * What an archive did, as the one line a reader sees.
 *
 * The four answers a call can give at once — cards folded away, cards an open card still
 * waits on, cards the store refused, and the card a second call found already aside — so a
 * sweep that failed on a card names it here instead of drawing a count that reads as if it
 * had not. The reasons stay in the text; the ids are what a reader acts on.
 */
function archiveLine(theme: Theme, outcome: ArchiveOutcome): string {
	const parts: string[] = [];
	const moved = outcome.moved;
	if (moved.length === 1 && moved[0] !== undefined) {
		parts.push(paint(theme, "label", `${cardRef(moved[0])} archived`));
	} else if (moved.length > 1) {
		parts.push(paint(theme, "label", `${plural(moved.length, "card")} archived`));
	}
	if (outcome.already !== undefined) parts.push(paint(theme, "meta", `${cardRef(outcome.already)} already archived`));
	if (outcome.kept.length > 0)
		parts.push(paint(theme, "meta", `${plural(outcome.kept.length, "card")} kept: still waited on`));
	if (outcome.failed.length > 0) {
		const ids = outcome.failed.map((entry) => cardRef(entry.card)).join(", ");
		parts.push(paint(theme, "bad", `${ids} not archived`));
	}
	// A sweep with nothing to do is an answer: no move, no hold, no refusal.
	if (parts.length === 0) parts.push(paint(theme, "label", "no finished cards to archive"));
	return parts.join(` ${SEPARATORS.item} `);
}

/**
 * The sign's sentence, after the actor: `· told api-core`, or who was not told.
 *
 * One clause for both answers, because `announce` writes one sentence — and the person's
 * command prints the same clause after its card (`#4 approved by you · api-core was not told
 * (…)`), so the two doors a sign has read alike.
 */
function toldLine(theme: Theme, told: string | undefined): string {
	return told === undefined ? "" : ` ${SEPARATORS.item} ${paint(theme, "meta", sanitizeLine(told))}`;
}

/**
 * `#4 execute · Billing webhook accepts orders`, clipped by the caller's row helper.
 *
 * The lane wears the colour the page gives it — `LANE_RULES`' role, through the tone
 * bridge — rather than one accent for all five.
 */
function cardLine(theme: Theme, card: Card): string {
	const id = paint(theme, "meta", cardRef(card.id));
	const lane = paint(theme, TONE_ROLE[LANE_RULES[card.lane].role], card.lane);
	const title = paint(theme, "label", sanitizeLine(card.title));
	return `${id} ${lane} ${SEPARATORS.item} ${title}`;
}
