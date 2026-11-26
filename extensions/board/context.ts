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
import { plural } from "../../lib/format.ts";
import { SESSION_TTL_MS } from "../../lib/session-roster.ts";
import { type Card, cardRef, holds } from "../../lib/workflow/card.ts";
import { JOIN_DOORS } from "../../lib/workflow/join.ts";
import { laneIndex } from "../../lib/workflow/lanes.ts";
import { reasonFor } from "../../lib/workflow/reason.ts";
import { buildRound } from "../../lib/workflow/round.ts";
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

/**
 * What a turn says when this session is offered no `board` tool.
 *
 * The tool is absent, so this sentence is the only thing that says a board exists here and how to
 * get one: without it a model reads the gap as "this Pi has no board" and keeps its list in
 * memory, which is the failure the whole gate has to avoid. It names the same two doors the
 * refusal names — one constant, `JOIN_DOORS` — so a reader is never sent to a door their build
 * does not have. One line, inside the message's own ceiling, and the caller pays it only while the
 * tool is withheld.
 */
export function doorContext(): string {
	return `${BOARD_CONTEXT_MARKER} This board is not yours yet: join with ${JOIN_DOORS}.`;
}

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

/**
 * The marker the seat's block opens with, and its own ceilings.
 *
 * Five lines, and what they can spend: 74 for the headline, 190 for `Yours:`, 150 for `Blocked:`,
 * 140 for `Peers:` and 47 for the hatch, with four newlines, come to 605. The 620 is that worst
 * case with slack, and the six is the price of the mode rather than a count of what it prints
 * today: a clause the round grows next spends a line, not a second message.
 */
export const LEAD_CONTEXT_MARKER = "[LEAD MODE]";
export const MAX_LEAD_CHARS = 620;
export const MAX_LEAD_LINES = 6;
/**
 * What one clause of the block may spend. The hatch is not shareable: a clause
 * that ate the ceiling would cut the line that says how to leave, so each list
 * clips at its own budget and the last line is always there.
 */
export const MAX_LEAD_CLAUSE_CHARS = 190;
export const MAX_LEAD_PEERS_CHARS = 140;
/**
 * The pool's share of the `Yours:` clause: how many untaken cards it names, and how much of the
 * clause it may take.
 *
 * The pool is the one clause on that line that is not the seat's work, so it is fitted first and
 * into its own budget — a busy board naming forty cards used to spend the clause and clip away the
 * two signatures only the seat can make.
 */
export const MAX_POOL_IDS = 3;
export const MAX_LEAD_POOL_CHARS = 72;
/**
 * What the `Blocked:` line spends: how many cards it names, and how much of each decision it keeps.
 *
 * A block's sentence is up to `MAX_BLOCKED` characters and says what a person owes the card; the
 * ids and the gist are what the seat acts on, and the card itself is one `board list <id>` away.
 */
export const MAX_BLOCKED_SHOWN = 2;
export const MAX_BLOCKED_WHY_CHARS = 60;
export const MAX_LEAD_BLOCKED_CHARS = 150;

/** A card parked on a decision: what it is, and the sentence it waits on. */
export interface BlockedFact {
	/** The card, as `#12`. */
	ref: string;
	/** The decision a person owes it, in the card face's own words. */
	why: string;
}

/** What the seat is owed, gathered once per turn. */
export interface LeadFacts {
	/** Contracts waiting for the seat's approval. */
	approve: readonly string[];
	/** Executions waiting for the seat's spot-check. */
	review: readonly string[];
	/**
	 * Signs, and handoffs, the bus never took: the owner has not heard, so the only retry is the
	 * seat's own signature again.
	 */
	untold: readonly string[];
	/** Cards nobody has taken. */
	unclaimed: readonly string[];
	/** Cards parked on a decision, and what each waits on. */
	blocked: readonly BlockedFact[];
	/** Messages in the seat's own inbox that nothing has told it about. */
	mail: number;
	/** One line per live peer: its label, whether it is quiet, and its unread mail. */
	peers: readonly string[];
}

/**
 * The round as the seat needs it: what it owes a signature, what a person owes a decision,
 * what nobody has taken, and who is listening — read from the same cards and roster the page
 * draws, so the line and the page cannot disagree. A board or a bus that cannot be read is no
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
			untold: round.untold.map((card) => cardRef(card.id)),
			unclaimed: round.unassigned.map((card) => cardRef(card.id)),
			blocked: round.blocked.map((card) => ({ ref: cardRef(card.id), why: blockedWhy(card) })),
			// The roster is the one reader of "written and not told", and the seat's own row is the
			// only place its inbox is counted: a seat that was never told reads zero, like a session
			// the bus holds no record of, which is the same silence either way.
			mail: roster.find((peer) => peer.id === self)?.mail ?? 0,
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
 * What a blocked card waits on: `reasonFor`'s sentence, which is the card face's own.
 *
 * The recorded block names the errand and the decision; a card hand-edited into the lane, or one
 * parked by a build that recorded neither, is `blocked` and nothing more. The word is the type's
 * floor rather than a case this build makes.
 */
function blockedWhy(card: Card): string {
	return reasonFor(card, () => "now")?.text ?? "blocked";
}

/**
 * The seat's block: what it owes, what is parked on a person, who is here, and the hatch.
 *
 * The hatch is on every turn, because the refusal the model meets names it and this
 * is the line it reads before it acts. The ceiling is characters and lines, spent on
 * whole clauses: a long list of ids clips rather than the line being cut, and the
 * pool rides at the end of `Yours` in its own budget, so a busy board costs a clause
 * and not the signature queue.
 *
 * `Blocked` is the round's own group and not the seat's queue: the card is somebody's, and what
 * the seat owes it is a dispatch or a push on the person who owes the decision — which is why it
 * names the decision rather than the card alone. A board with nothing parked spends no line on it.
 */
export function buildLeadContext(facts: LeadFacts): string {
	const lines = [
		`${LEAD_CONTEXT_MARKER} You hold the seat: sign, dispatch, and ticket; code is a card.`,
		yoursLine(facts),
	];
	if (facts.blocked.length > 0) lines.push(blockedLine(facts.blocked));
	lines.push(
		fitLine(`Peers: ${facts.peers.length === 0 ? "no peers live" : facts.peers.join(" · ")}.`, MAX_LEAD_PEERS_CHARS),
	);
	lines.push("`/board stop` to write — the page closes with it; `/board` re-takes both.");
	return lines.join("\n");
}

/**
 * The seat's own queue, with the pool's room reserved before it is fitted.
 *
 * The mail count leads, because it is the one thing the seat cannot learn from the ids below it:
 * a message nobody announced is waiting to be read. The pool comes last and is clipped into what
 * the line has left, so the signatures keep their room however long the board is.
 */
function yoursLine(facts: LeadFacts): string {
	const pool = poolClause(facts.unclaimed);
	const owed: string[] = [];
	if (facts.mail > 0) owed.push(`${facts.mail} unread`);
	if (facts.approve.length > 0) owed.push(`approve ${facts.approve.join(", ")}`);
	if (facts.review.length > 0) owed.push(`review ${facts.review.join(", ")}`);
	if (facts.untold.length > 0) owed.push(`untold ${facts.untold.join(", ")}`);
	const body = owed.length === 0 ? "nothing to sign" : owed.join(" · ");
	if (pool === "") return fitLine(`Yours: ${body}.`, MAX_LEAD_CLAUSE_CHARS);
	const room = MAX_LEAD_CLAUSE_CHARS - pool.length - " · ".length;
	return fitLine(`Yours: ${fitLine(body, room)} · ${pool}.`, MAX_LEAD_CLAUSE_CHARS);
}

/**
 * The pool, capped: the cards nobody has taken, then a count of the rest.
 *
 * Three ids because the seat's next move on any of them is the same offer or assignment, and the
 * count is the fact the line could not carry otherwise: a board of forty reads as a board of forty.
 */
function poolClause(ids: readonly string[]): string {
	if (ids.length === 0) return "";
	const shown = ids.slice(0, MAX_POOL_IDS);
	const rest = ids.length - shown.length;
	const tail = rest === 0 ? "" : ` +${rest} more`;
	return fitLine(`unclaimed ${shown.join(", ")}${tail}`, MAX_LEAD_POOL_CHARS);
}

/**
 * What is parked on a person: each card, the decision it waits on, then a count of the rest.
 *
 * The tail is counted before the cards are fitted, so `+2 more` is never the half that the ceiling
 * takes: a reader who is told two cards and a count goes looking, and one who is told nothing goes
 * nowhere.
 */
function blockedLine(blocked: readonly BlockedFact[]): string {
	const shown = blocked.slice(0, MAX_BLOCKED_SHOWN);
	const rest = blocked.length - shown.length;
	const tail = rest === 0 ? "" : ` +${rest} more`;
	const room = MAX_LEAD_BLOCKED_CHARS - "Blocked: ".length - tail.length - 1;
	const cards = shown.map((card) => `${card.ref} — ${fitLine(card.why, MAX_BLOCKED_WHY_CHARS)}`);
	return `Blocked: ${fitLine(cards.join(" · "), room)}${tail}.`;
}

/** Whether a stored message is the line this module injected. */
export function isBoardContext(value: unknown): boolean {
	return (
		typeof value === "object" && value !== null && (value as { customType?: unknown }).customType === BOARD_CONTEXT_TYPE
	);
}
