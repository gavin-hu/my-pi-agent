/**
 * What a session is told about the cards it holds, once, before its first turn.
 *
 * The failure this answers is a session that resumes mid-card and does the work without ever
 * reading the board: the lane is the record, and a model that has not been told which lane its
 * card is in will work in the wrong one. So the first turn carries one small message — the
 * cards this session holds, and what each owes next — and nothing after it, because every
 * later turn already has the claim, the move, or the sign in its own transcript.
 *
 * The sentences come from `lib/workflow/reason.ts`, the page's own "what happens next" rule, so
 * the line a session reads and the line a lead reads on a card face cannot disagree. The cap
 * is a context budget, not a screen: three cards and one "more" line, which
 * `test/prompt-budget.test.ts` holds.
 *
 * Injection is `display: false`, the way `goal` restates its objective: the transcript stays
 * the work, and this is the state the work is in. The `context` handler keeps the newest copy
 * so a `/resume` cannot stack them.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef, holds } from "../../lib/workflow/card.ts";
import { laneIndex } from "../../lib/workflow/lanes.ts";
import { reasonFor } from "../../lib/workflow/reason.ts";
import { plural } from "../../lib/format.ts";
import { buildRound } from "../../lib/workflow/round.ts";
import { SESSION_TTL_MS } from "../../lib/session-roster.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";

/** The marker the model reads, and the custom type the session stores. */
export const BOARD_CONTEXT_MARKER = "[BOARD]";
export const BOARD_CONTEXT_TYPE = "board-context";

/** How many held cards the line names before it counts the rest. */
export const MAX_CONTEXT_CARDS = 3;

/** The whole message's ceiling, in characters. */
export const MAX_CONTEXT_CHARS = 320;

/** The longest one bullet may be: a `blocked` note is up to 200 characters, and one card should not spend the line. */
export const MAX_BULLET_CHARS = 200;

/** Room kept for the `and N more` line, so a bullet never pushes it past the ceiling. */
const MORE_RESERVE = "\n- and 99 more".length;

/** The cards this session holds and has not finished, in lane order and then by id. */
export async function heldCards(
	session: Pick<BoardSession, "store" | "who">,
	ctx: ExtensionContext,
): Promise<Card[] | undefined> {
	try {
		const me = await session.who(ctx, ctx.cwd);
		const store = await session.store(ctx.cwd);
		const { cards } = await store.scan();
		return cards
			.filter((card) => card.lane !== "done" && holds(card, me))
			.sort((left, right) => laneIndex(left.lane) - laneIndex(right.lane) || Number(left.id) - Number(right.id));
	} catch {
		// A board that cannot be read is not a reason to fail the turn it was read for.
		return undefined;
	}
}

/**
 * The line, or `undefined` when this session holds nothing and has nothing to report.
 *
 * Nothing is the ordinary answer, and the one that keeps the message out of every session
 * that never touches the board: a line saying "you hold no cards" would be noise in a turn
 * that has nothing to do with the board.
 *
 * The budget is spent on whole bullets rather than on a slice: a card whose block note is long
 * is clipped with an ellipsis, and the cards that no longer fit are counted instead of being
 * cut off mid-sentence by the message's ceiling. `notes` are the things a turn start has to say
 * — a path it could not take, the cards it released — one bullet each inside the same ceiling,
 * so one sentence cannot push the line past it.
 */
export function buildBoardContext(held: readonly Card[], notes: readonly string[] = []): string | undefined {
	// Nothing held and nothing swept is no message at all; a sweep with nothing of its own to report
	// still says what it released, and there is no headline to count zero cards under.
	if (held.length === 0) return notes.length === 0 ? undefined : releasedLine(notes);
	const lines = [`${BOARD_CONTEXT_MARKER} ${plural(held.length, "card")} ${held.length === 1 ? "is" : "are"} yours:`];
	const tail = notes.map((note) => `\n- ${fitLine(note)}`).join("");
	let shown = 0;
	for (const card of held.slice(0, MAX_CONTEXT_CARDS)) {
		const bullet = bulletOf(card);
		const rest = held.length - shown - 1;
		const fits =
			lines.join("\n").length + bullet.length + 1 + (rest > 0 ? MORE_RESERVE : 0) + tail.length <= MAX_CONTEXT_CHARS;
		if (!fits) break;
		lines.push(bullet);
		shown += 1;
	}
	if (held.length > shown) lines.push(`- and ${held.length - shown} more`);
	return `${lines.join("\n")}${tail}`;
}

/**
 * The line for a turn that holds nothing but did release cards: the sweep's sentence alone.
 *
 * Its ceiling is the message's own, less the marker that tells the model this message from the
 * transcript: there are no card bullets to spend it on, so a long list of released cards shortens
 * with an ellipsis and the turn is told who else it freed by the round.
 */
function releasedLine(notes: readonly string[]): string {
	const room = MAX_CONTEXT_CHARS - BOARD_CONTEXT_MARKER.length - 1;
	return `${BOARD_CONTEXT_MARKER} ${fitLine(notes.join("; "), room)}`;
}

/**
 * One line inside a bullet's ceiling: whole words where it can, an ellipsis where the tail was
 * cut. Not the terminal's `clip`, which is column arithmetic and re-emits the reset codes a
 * themed string carries — this line is read by the model, not drawn.
 */
function fitLine(text: string, max = MAX_BULLET_CHARS): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const at = cut.lastIndexOf(" ");
	// A line with no space to break on — one long path, say — is cut at the ceiling instead.
	return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** One card's bullet, fitted to {@link MAX_BULLET_CHARS} so a long reason cannot crowd the rest out. */
function bulletOf(card: Card): string {
	// No age is read for the lanes this names: `plan`, `execute` and `blocked` all answer without
	// one, and the formatter is the parameter `reason.ts` asks for.
	const reason = reasonFor(card, () => "now");
	return fitLine(`- ${cardRef(card.id)} (${card.lane})${reason === undefined ? "" : ` ${reason.text}`}`);
}

/** The marker the seat's block opens with, and its own ceilings. */
export const LEAD_CONTEXT_MARKER = "[LEAD MODE]";
export const MAX_LEAD_CHARS = 480;
export const MAX_LEAD_LINES = 6;
/**
 * What one clause of the block may spend. The hatch is not shareable: a clause
 * that ate the ceiling would cut the line that says how to leave, so each list
 * clips at its own budget and the last line is always there.
 */
export const MAX_LEAD_CLAUSE_CHARS = 190;
export const MAX_LEAD_PEERS_CHARS = 140;

/** What the seat is owed, gathered once per turn. */
export interface LeadFacts {
	/** Contracts waiting for the seat's approval. */
	approve: readonly string[];
	/** Executions waiting for the seat's spot-check. */
	review: readonly string[];
	/** Cards nobody has taken. */
	unclaimed: readonly string[];
	/** One line per live peer: its label, whether it is quiet, and its unread mail. */
	peers: readonly string[];
}

/**
 * The round as the seat needs it: what it owes a signature, what nobody has taken,
 * and who is listening — read from the same cards and roster the page draws, so the
 * line and the page cannot disagree. A board or a bus that cannot be read is no
 * line at all rather than a failed turn.
 */
export async function leadFacts(
	session: Pick<BoardSession, "store" | "roster" | "now">,
	ctx: ExtensionContext,
): Promise<LeadFacts | undefined> {
	try {
		const store = await session.store(ctx.cwd);
		const { cards } = await store.scan();
		const round = buildRound(cards, session.now());
		const roster = (await session.roster(ctx.cwd)) ?? [];
		const now = session.now();
		const self = ctx.sessionManager.getSessionId();
		return {
			approve: round.unapproved.map((card) => cardRef(card.id)),
			review: round.unreviewed.map((card) => cardRef(card.id)),
			unclaimed: round.unassigned.map((card) => cardRef(card.id)),
			peers: roster
				.filter((peer) => peer.id !== self)
				.map((peer) => {
					const quiet = now - peer.lastSeen > SESSION_TTL_MS ? " (quiet)" : "";
					const mail = peer.mail > 0 ? ` ${peer.mail} unread` : "";
					return `${peer.label}${quiet}${mail}`;
				}),
		};
	} catch {
		return undefined;
	}
}

/**
 * The seat's block: what it owes, who is here, and the hatch.
 *
 * The hatch is on every turn, because the refusal the model meets names it and this
 * is the line it reads before it acts. The ceiling is characters and lines, spent on
 * whole clauses: a long list of ids clips rather than the line being cut, and the
 * `unclaimed` clause folds into `Yours` when there is one, so a busy board costs a
 * clause and not a line.
 */
export function buildLeadContext(facts: LeadFacts): string {
	const owed: string[] = [];
	if (facts.approve.length > 0) owed.push(`approve ${facts.approve.join(", ")}`);
	if (facts.review.length > 0) owed.push(`review ${facts.review.join(", ")}`);
	if (facts.unclaimed.length > 0) owed.push(`unclaimed ${facts.unclaimed.join(", ")}`);
	const lines = [
		`${LEAD_CONTEXT_MARKER} You hold the seat: sign, dispatch, and ticket; code is a card.`,
		fitLine(owed.length === 0 ? "Yours: nothing to sign." : `Yours: ${owed.join(" · ")}.`, MAX_LEAD_CLAUSE_CHARS),
		fitLine(`Peers: ${facts.peers.length === 0 ? "no peers live" : facts.peers.join(" · ")}.`, MAX_LEAD_PEERS_CHARS),
		"`/board exit` to write; the page keeps serving.",
	];
	return lines.join("\n");
}

/** Whether a stored message is the line this module injected. */
export function isBoardContext(value: unknown): boolean {
	return (
		typeof value === "object" && value !== null && (value as { customType?: unknown }).customType === BOARD_CONTEXT_TYPE
	);
}
