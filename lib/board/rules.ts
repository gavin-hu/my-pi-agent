/**
 * The card lifecycle: every transition, as a pure function of the card, the
 * operation, who asked, the clock, the board's other cards, and the board's limits.
 *
 * One table decides who may do what — the tool, the router, the page, and `team` all
 * route through {@link applyOp} — so a lane change cannot be reachable from one
 * surface and refused from another. Nothing here touches the filesystem or the bus:
 * ownership is advisory (the bus's path claims are the lock), and the store owns the
 * compare-and-set that makes a concurrent writer lose.
 *
 * Two shapes of failure, and the difference matters. A refusal is `{ ok: false }` with
 * the reason, and the caller returns the card untouched. A *no-op* is `{ ok: true,
 * changed: false }`: the operation's preconditions already hold (claiming a card you
 * already hold), so nothing is written and the revision does not move.
 *
 * {@link mayOp} is the same decision without writing it, which is what `team` asks
 * before it sends a handoff: a dry run is a question — "would this be allowed" — not a
 * mutation performed as a fake session.
 *
 * The board index is a parameter rather than a lookup because three operations need a
 * *different* card: a claim or a move is refused while a dependency is unfinished, and
 * a drop is refused while somebody waits on the card. `lib/board/links.ts` answers those
 * questions; this module decides what to do with the answer. The limits are a parameter
 * for the same reason: the rule decides, the owner of the setting supplies the number.
 *
 * `add` is {@link createCard} rather than an operation, because it has no card to
 * transition — and because a card is born in `backlog` with no owner, which is the one
 * state the other operations never produce.
 */

import type { ArtifactCheck } from "./artifact.ts";
import { type Card, type CardBlock, CARD_VERSION, DEFAULT_PRIORITY, MAX_LOG, type Priority } from "./card.ts";
import { DEFAULT_WIP, type WipLimits } from "./limits.ts";
import type { Lane } from "./lanes.ts";
import type { BoardIndex } from "./links.ts";
import {
	approve,
	archive,
	assign,
	claim,
	contractOp,
	drop,
	edit,
	move,
	note,
	offer,
	reclaim,
	release,
	review,
} from "./steps.ts";

/** Who is attempting an operation: a session when it has one, and the label it is addressed by. */
export interface Actor {
	id?: string;
	label: string;
}

/** One named mutation of one card. */
export type CardOp =
	/** Pull a backlog card into `plan`: the only way a card starts moving. */
	| { kind: "claim" }
	/**
	 * Hand a pool card to `to`: the owner is recorded and the card enters `plan`. A held card is
	 * refused — `reclaim` is how it changes hands — and `team assign` sends the handoff, which
	 * the state machine knows nothing about.
	 */
	| { kind: "assign"; to: Actor }
	| { kind: "release" }
	/**
	 * Change lane. `blockedBy` and `blocker` are what a block records, `landed` says which
	 * commit closed a card, and `artifact` is the plan proof a card entering `execute` or
	 * `done` carries: each is read only by the lanes that ask for it.
	 */
	| {
			kind: "move";
			lane: Lane;
			blockedBy?: unknown;
			blocker?: unknown;
			landed?: { commit: string };
			artifact?: ArtifactCheck;
	  }
	// `text` and the contract fields are whatever the model sent: the modules that own
	// them validate them, and the refusal they produce is the one the caller shows.
	| { kind: "note"; text: unknown }
	/**
	 * Write the contract and the plan it is executed against. `artifact` is what the caller
	 * proved: a resolved, existing plan file, or the sentence refusing it. The state machine
	 * decides — nothing here touches a filesystem — and a contract naming neither is refused,
	 * so a caller cannot skip the check by omitting it.
	 */
	| { kind: "contract"; artifact?: ArtifactCheck; goal?: unknown; acceptance?: unknown; scopeOut?: unknown }
	/** Read the contract and approve it: a session that does not hold the card. */
	| { kind: "approve" }
	/** Spot-check the finished work: a session that does not hold the card, in `execute`. */
	| { kind: "review" }
	// Every field but `kind` is optional, and an absent one is left as it was: the page
	// sends the three it can show, and omitting a link must not clear it.
	| { kind: "edit"; title?: unknown; paths?: unknown; priority?: unknown; dependsOn?: unknown }
	| { kind: "reclaim" }
	/**
	 * Record that the card was offered to the team: `team offer` broadcasts it on the bus
	 * and then writes this, because an event nobody answers otherwise leaves no trace.
	 */
	| { kind: "offer" }
	/**
	 * Set a finished card aside: the store moves its file out of the board, and the record
	 * itself is unchanged, because the pile its file lies in is the whole of the state.
	 */
	| { kind: "archive" }
	| { kind: "drop" };

/** What an operation did: the new card, or the reason it was refused. */
export type OpResult = { ok: true; card: Card; changed: boolean } | { ok: false; error: string };

/** What one operation would write, or why it may not. */
export type Prepared = { error: string } | { fields: Partial<Card> | null; changed: boolean };

/** A card's first state: `backlog`, no owner, one note at most. */
export function createCard(
	id: string,
	input: { title: string; paths: string[]; note?: string; priority?: Priority },
	actor: Actor,
	now: number,
): Card {
	return {
		v: CARD_VERSION,
		id,
		title: input.title,
		lane: "backlog",
		paths: [...input.paths],
		// A new card says its priority out loud, even when it is the ordinary one, so a
		// file on disk tells a reader the whole story without a default to know.
		priority: input.priority ?? DEFAULT_PRIORITY,
		notes: input.note === undefined ? [] : [{ by: actor.label, at: now, text: input.note }],
		notesDropped: 0,
		// A card is born in `backlog`, and that is a transition like any other: a reader
		// asking "how long has this been waiting" gets an answer rather than an absence.
		log: [{ lane: "backlog", at: now, by: actor.label }],
		logDropped: 0,
		rev: 1,
		createdAt: now,
		updatedAt: now,
		by: actor.label,
	};
}

/**
 * Why `actor` may not apply `op` to `card`, or `undefined` when it may.
 *
 * The answer a dry run asks for: it computes everything a write would check and nothing
 * a write would store, so `team` can find out whether a handoff is deliverable before it
 * sends one.
 */
export function mayOp(
	card: Card,
	op: CardOp,
	actor: Actor,
	board: BoardIndex,
	limits: WipLimits = DEFAULT_WIP,
): string | undefined {
	const prepared = prepare(card, op, actor, 0, board, limits);
	return "error" in prepared ? prepared.error : undefined;
}

/**
 * Apply one operation.
 *
 * A refused operation returns the reason and no card: the caller already holds the
 * card it read, and a "refused" copy of it would be a second version of the truth.
 */
export function applyOp(
	card: Card,
	op: CardOp,
	actor: Actor,
	now: number,
	board: BoardIndex,
	limits: WipLimits = DEFAULT_WIP,
): OpResult {
	const prepared = prepare(card, op, actor, now, board, limits);
	if ("error" in prepared) return { ok: false, error: prepared.error };
	if (!prepared.changed) return { ok: true, card, changed: false };
	// `archive` changes the pile a card's file lies in and no field at all, which is why
	// its step has nothing to write and the store's move is the whole of the operation.
	if (prepared.fields === null) return { ok: true, card, changed: true };
	return { ok: true, card: write(card, actor, now, prepared.fields), changed: true };
}

/** The one place an operation becomes a write: each `step*` decides, this applies. */
function prepare(card: Card, op: CardOp, actor: Actor, now: number, board: BoardIndex, limits: WipLimits): Prepared {
	switch (op.kind) {
		case "claim":
			return claim(card, actor, board, limits);
		case "assign":
			return assign(card, op.to, board, limits);
		case "release":
			return release(card, actor);
		case "move":
			return move(card, op, actor, now, board, limits);
		case "note":
			return note(card, op.text, actor, now);
		case "contract":
			return contractOp(card, op, actor);
		case "approve":
			return approve(card, actor, now);
		case "review":
			return review(card, actor, now);
		case "edit":
			return edit(card, op, actor, board);
		case "reclaim":
			return reclaim(card);
		case "offer":
			return offer(card, now, board, limits);
		case "archive":
			return archive(card);
		case "drop":
			return drop(card, actor, board);
		default:
			// A caller from an older build, or a hand-written fixture, names an operation this
			// one does not know: that is a refusal, not a crash on `undefined`.
			return { error: "unknown board operation." };
	}
}

/**
 * A card's log after one more transition, with the oldest dropped and counted.
 *
 * The block travels with the entry that parked the card, because the card's own `blocked`
 * is deleted on the way out: without it the answer to "why did this sit for two days" dies
 * with the resume, and the notes are the only other place it could have been written.
 */
function appendTransition(
	card: Card,
	lane: Lane,
	actor: Actor,
	now: number,
	block: CardBlock | undefined,
): Pick<Card, "log" | "logDropped"> {
	const entry = block === undefined ? { lane, at: now, by: actor.label } : { lane, at: now, by: actor.label, block };
	const log = [...(card.log ?? []), entry];
	const overflow = Math.max(0, log.length - MAX_LOG);
	return {
		log: overflow === 0 ? log : log.slice(overflow),
		logDropped: (card.logDropped ?? 0) + overflow,
	};
}

/**
 * A card with `fields` applied and its write marks moved.
 *
 * This is the one place a lane change is observed, because it is the one place every
 * transition ends: a note, a contract, or an edit writes fields and leaves the lane alone,
 * while a claim, an assign, a release, a reclaim, and a move all name the new one. So
 * the log is appended from here rather than from each operation, and an operation added
 * later cannot forget it.
 */
function write(card: Card, actor: Actor, now: number, fields: Partial<Card>): Card {
	const lane = fields.lane;
	const transition =
		lane !== undefined && lane !== card.lane
			? appendTransition(card, lane, actor, now, lane === "blocked" ? fields.blocked : undefined)
			: undefined;
	const next: Card = { ...card, ...fields, ...transition, rev: card.rev + 1, updatedAt: now, by: actor.label };
	// `owner: undefined` must clear the field rather than store a key holding it, so a
	// released card reads back exactly like one that was never claimed. Only an
	// explicit `owner` in `fields` may delete it: every other write keeps the holder.
	if ("owner" in fields && fields.owner === undefined) delete next.owner;
	// The same for a block and a spot-check: a card that left `blocked` has no reason and no
	// kind, and one that left `execute` is not reviewed, so a key holding undefined would be
	// one more shape for a reader to know about.
	for (const field of ["blocked", "offeredAt", "review"] as const) {
		if (field in fields && fields[field] === undefined) delete next[field];
	}
	// `blocked` is a fact about the `blocked` lane and nothing else: a card back in the pool, or
	// one claimed out of it, is not parked on that decision any more. This is here rather than
	// in each operation because every lane change ends in this one write — so a release, a
	// reclaim, and a claim clean it without any of them having to remember, and the transition
	// log keeps what the park was.
	if (next.lane !== "blocked") delete next.blocked;
	return next;
}
