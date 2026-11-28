/**
 * The transcript block for one `board` result: the collapsed line a reader sees
 * without expanding, and the rows the expanded block draws.
 *
 * Both come from `details` alone, so a replayed session renders the same block it
 * rendered live — nothing is remembered between frames beyond the component the
 * transcript hands back.
 */

import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef, cardRefOf } from "../../lib/workflow/card.ts";
import { LANE_RULES } from "../../lib/workflow/lanes.ts";
import { plural, sanitizeLine } from "../../lib/format.ts";
import { type RoundTally as BoardTally, roundTally } from "../../lib/workflow/round-text.ts";
import { DECISION_TONE, type DecisionKind } from "../../lib/workflow/tone.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import {
	callLine,
	detailsOrLine,
	isTailResult,
	type TailResultInput,
	type TailSection,
	type TailRowLine,
	TailResult,
} from "../../lib/tui/tool.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { boardRowLineFor } from "./rows.ts";
import { TONE_ROLE } from "./tone.ts";
import { toolError } from "../../lib/tool-result.ts";
import type { RoundSummary } from "../../lib/workflow/round.ts";
import { BOARD_TOOL, type ArchiveOutcome, type BoardAction, type BoardDetails, normalizeBoardAction } from "./types.ts";
import { BoardParams } from "./schema.ts";

/** One section of the listing, drawn as the session that asked for it. */
function section(label: string | undefined, cards: readonly Card[], rowLine: TailRowLine<Card>): TailSection<Card> {
	return { label, rows: cards, more: 0, rowLine };
}

/**
 * How many rows a body section draws, and how many ids an index line names.
 *
 * The two numbers differ because the two costs do: an id is a few characters on a line that already
 * exists, while a row is a screen line of its own. So the index — the decision surface, and the part
 * a lead reads first — can afford a dozen, and the board below it stops at eight and names the rest
 * by id, which is the half of a row a reader acts on.
 */
const INDEX_IDS = 12;
const SECTION_ROWS = 8;

/**
 * One section of a body: counted, and capped.
 *
 * The heading carries the count because no card is drawn under every group it belongs to any more, so
 * "how many await review" is a number in a heading rather than a number of rows.
 */
function capped(label: string, cards: readonly Card[], rowLine: TailRowLine<Card>): TailSection<Card>[] {
	const head: TailSection<Card> = {
		label: `${label} · ${cards.length}`,
		rows: cards.slice(0, SECTION_ROWS),
		more: 0,
		rowLine,
	};
	if (cards.length <= SECTION_ROWS) return [head];
	const rest = cards.slice(SECTION_ROWS).map((card) => cardRef(card.id));
	return [head, { label: `… ${rest.length} more: ${rest.join(" ")}`, rows: [], more: 0, rowLine }];
}

/**
 * One index line: a group's name and the ids it holds, and deliberately no rows.
 *
 * The id is what the next command takes, and the card's title is one section below, in the hands of
 * whoever holds it — so the index answers "what do I sign" without scrolling and without drawing a
 * card twice. A later reader who "fixes" the repetition by drawing the row here puts that duplicate
 * back and unbounds the block, which is the one thing this shape is for.
 */
function indexLine(entry: BoardTally, rowLine: TailRowLine<Card>): TailSection<Card> {
	const ids = entry.cards.map((card) => cardRef(card.id));
	const hidden = ids.length - INDEX_IDS;
	const named = hidden > 0 ? `${ids.slice(0, INDEX_IDS).join(" ")} +${hidden}` : ids.join(" ");
	return { label: `${entry.label} · ${named}`, rows: [], more: 0, rowLine };
}

/**
 * Every card a round names, in a stable order.
 *
 * The groups overlap by design, so this repeats cards and the body dedupes by id. That is the point:
 * a card filed in a group no section draws as a row still reaches the block, so the block cannot
 * drop a card the board it just read holds.
 */
function roundCards(round: RoundSummary): readonly Card[] {
	return [
		...round.owners.flatMap((group) => [...group.cards, ...group.done]),
		...round.unassigned,
		...round.shelved,
		...round.unplanned,
		...round.unapproved,
		...round.unreviewed,
		...round.untold,
		...round.blocked,
		...round.unwritten,
		...round.done,
		...round.archivable,
	];
}

/**
 * What the expanded block draws, or undefined when the action has nothing to list.
 *
 * A `list` is the board (or the one card it was asked for). A `list --round` is that listing — when a
 * filter made it a slice — then an index of the ids that need a decision, then one section per body
 * group, each card drawn once. Every other action produced one card, which the collapsed line already
 * names, so it has no rows.
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
	// of those cards in the body below.
	const slice = details.narrowed === true ? (details.cards ?? []) : [];
	if (slice.length > 0) sections.push(section(undefined, slice, rowLine));
	// The decision first, as ids, in the order the model's own first line prints the counts: a lead
	// answers "what do I sign" before scrolling the board, and reads which card each count is made of.
	for (const entry of roundTally(details.cards ?? [], round)) {
		if (entry.kind !== undefined && entry.count > 0) sections.push(indexLine(entry, rollupLine));
	}
	// Then the board, once per card: each owner's live cards, the pool nobody holds, the shelf, and the
	// history. A card the round found and no section draws — one whose owner the rollup lost, say —
	// lands in `Unassigned` rather than vanishing, because the block has to show what it just read.
	const drawn = new Set<string>();
	const draw = (label: string, cards: readonly Card[]): void => {
		const fresh = cards.filter((card) => !drawn.has(card.id));
		if (fresh.length === 0) return;
		for (const card of fresh) drawn.add(card.id);
		sections.push(...capped(label, fresh, rollupLine));
	};
	// An owner whose last card is done keeps its group in the text, because the headline counts what
	// it finished — but it draws no heading here, and its finished cards are in `Done`.
	for (const group of round.owners) draw(group.label, group.cards);
	const shelved = new Set(round.shelved.map((card) => card.id));
	const unheld = roundCards(round).filter(
		(card) => card.lane !== "done" && card.owner === undefined && !shelved.has(card.id),
	);
	draw("Unassigned", unheld);
	draw("Shelved", round.shelved);
	draw("Done", round.done);
	return sections.length === 0 ? undefined : { kind: "sections", sections };
}

/**
 * One refusal: the reason for the model, the state for the renderer.
 *
 * A refusal carries the card it left alone, because the store hands one back for a refused write:
 * the next call starts from the truth rather than from the caller's guess.
 */
export function refusal(action: BoardAction, me: BoardDetails["me"], message: string, card?: BoardDetails["card"]) {
	return toolError(message, {
		action,
		me,
		error: message,
		...(card === undefined ? {} : { card }),
	});
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
	// A dropped card is the one answer whose clause hangs off an id rather than a card, and it is
	// still the write's: a release the bus refused is the fact that keeps a peer off those paths.
	if (details.dropped)
		return `${paint(theme, "label", `${cardRef(details.dropped)} dropped`)} ${SEPARATORS.item} ${me}${sideLine(theme, details.held)}`;
	const card = details.card;
	if (card)
		return `${cardLine(theme, card)} ${SEPARATORS.item} ${me}${sideLine(theme, details.held)}${sideLine(theme, details.told)}`;
	const count = details.cards?.length ?? 0;
	const round = details.round;
	if (!round) return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${me}`;
	// The rollup's own counts, minus the ones that are not an ask: the model reads these words on
	// the first line of its answer, so the block's one line and that text cannot count one board two
	// ways. A narrowed read passes its slice for the entries this does not print, and every kinded
	// entry is the round's — the whole board's — so a filter cannot put a slice's tally under it.
	const asks = roundTally(details.cards ?? [], round).filter(
		(entry): entry is BoardTally & { kind: DecisionKind } => entry.kind !== undefined && entry.count > 0,
	);
	if (asks.length > 0) {
		const gap = ` ${paint(theme, "meta", SEPARATORS.item)} `;
		const counts = asks.map((entry) => paint(theme, TONE_ROLE[DECISION_TONE[entry.kind]], entry.word));
		return `${paint(theme, "label", plural(count, "card"))}${gap}${counts.join(gap)}${gap}${me}`;
	}
	return `${paint(theme, "label", plural(count, "card"))} ${SEPARATORS.item} ${plural(round.owners.length, "owner")} ${SEPARATORS.item} ${me}`;
}

/**
 * What an archive did, as the one line a reader sees.
 *
 * Every answer a call can give at once — cards folded away, cards an open card still waits
 * on, cards a bound left where they are, cards the store refused, and the card a second call
 * found already aside — so a sweep that failed on a card names it here instead of drawing a
 * count that reads as if it had not, and a bounded one says what it kept back rather than
 * reading as "that was all of it". The reasons stay in the text; the ids are what a reader
 * acts on.
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
	if (outcome.held.length > 0 && outcome.bound !== undefined)
		parts.push(paint(theme, "meta", `${plural(outcome.held.length, "card")} stayed: within ${outcome.bound}`));
	if (outcome.failed.length > 0) {
		const ids = outcome.failed.map((entry) => cardRef(entry.card)).join(", ");
		parts.push(paint(theme, "bad", `${ids} not archived`));
	}
	// A sweep with nothing to do is an answer: no move, no kept link, no held card, no refusal.
	if (parts.length === 0) parts.push(paint(theme, "label", "no finished cards to archive"));
	return parts.join(` ${SEPARATORS.item} `);
}

/**
 * One clause after the actor: the paths a lane crossing claimed or lost, or who was told of a
 * sign. Both are written by the write that produced them, so the block and the text carry the
 * same sentence; a call has at most one of them.
 */
function sideLine(theme: Theme, clause: string | undefined): string {
	return clause === undefined ? "" : ` ${SEPARATORS.item} ${paint(theme, "meta", sanitizeLine(clause))}`;
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

function callSubject(action: BoardAction, args: Record<string, unknown>): string {
	const card = cardRefOf(args.card);
	if (action === "add") {
		const title = typeof args.title === "string" ? args.title.trim() : "";
		return title === "" ? "add" : `add ${title}`;
	}
	if (action === "list") {
		const parts = ["list"];
		if (args.round === true) parts.push("round");
		if (typeof args.lane === "string") parts.push(args.lane);
		if (typeof args.query === "string" && args.query.trim() !== "") parts.push(`"${args.query.trim()}"`);
		if (card !== "") parts.push(card);
		return parts.join(" ");
	}
	if (card === "") return action;
	const lane = typeof args.lane === "string" ? ` ${args.lane}` : "";
	return `${action} ${card}${lane}`;
}

/** The two transcript hooks the board's tool registers, typed from the definition they belong to. */
type BoardRenderers = Required<
	Pick<ToolDefinition<typeof BoardParams, BoardDetails, Card>, "renderCall" | "renderResult">
>;

export const renderBoardCall: BoardRenderers["renderCall"] = (args, theme, context) => {
	const action = normalizeBoardAction(args.action) ?? "list";
	return callLine(theme, context.lastComponent, BOARD_TOOL, callSubject(action, args as Record<string, unknown>));
};

export const renderBoardResult: BoardRenderers["renderResult"] = (result, options, theme, context) => {
	const text = reuseText(context?.lastComponent);
	const details = toolDetails<BoardDetails>(result.details);
	const outcome = detailsOrLine(theme, result, options.expanded, details);
	if ("line" in outcome) {
		text.setText(outcome.line);
		return text;
	}
	// A `list` is the one action with rows, so a collapsed block is the line that counts
	// them: the rows are what expanding adds, not a second copy of the line's answer.
	const input = options.expanded ? resultInput(outcome.details) : undefined;
	if (!input) {
		text.setText(collapsedLine(theme, outcome.details));
		return text;
	}
	const previous = context?.lastComponent;
	const view = isTailResult<Card>(previous) ? previous : new TailResult<Card>(input, theme);
	view.setInput(input, theme);
	return view;
};
