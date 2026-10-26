/**
 * The card lifecycle: every transition, as a pure function of the card, the
 * operation, who asked, the clock, and the board's other cards.
 *
 * One table decides who may do what — the tool, the router, the page, and `team` all
 * route through {@link applyOp} — so a lane change cannot be reachable from one
 * surface and refused from another. Nothing here touches the filesystem or the bus:
 * ownership is advisory (the bus's path claims are the lock), and the store owns the
 * compare-and-set that makes a concurrent writer lose.
 *
 * The board index is a parameter rather than a lookup because three operations need a
 * *different* card: a claim or a move is refused while a dependency is unfinished, and
 * a drop is refused while somebody waits on the card. `lib/board/links.ts` answers
 * those questions; this module decides what to do with the answer.
 *
 * Two shapes of failure, and the difference matters. A refusal is `{ ok: false }`
 * with the reason, and the caller returns the card untouched. A *no-op* is
 * `{ ok: true, changed: false }`: the operation's preconditions already hold
 * (claiming a card you already hold), so nothing is written and the revision does
 * not move.
 *
 * `add` is {@link createCard} rather than an operation, because it has no card to
 * transition — and because a card is born `todo` with no owner, which is the one
 * state the other operations never produce.
 */

import {
	type Card,
	type CardOwner,
	type CardStatus,
	cardRef,
	DEFAULT_PRIORITY,
	dependsOf,
	MAX_LOG,
	MAX_NOTES,
	normalizeBlockedBy,
	normalizeNote,
	normalizePathHints,
	normalizePlanPath,
	normalizePriority,
	normalizeTitle,
	type Priority,
	priorityOf,
} from "./card.ts";
import { type BoardIndex, dependedOn, normalizeDepends, waitingOn } from "./links.ts";

/** Who is attempting an operation: a session when it has one, and the label it is addressed by. */
export interface Actor {
	id?: string;
	label: string;
}

/** One named mutation of one card. */
export type CardOp =
	| { kind: "claim" }
	/**
	 * Hand a card to `to`, and — from the page, which cannot message a peer — a note that
	 * says so. `team assign` sends a handoff instead and passes none.
	 */
	| { kind: "assign"; to: Actor; note?: unknown }
	| { kind: "release" }
	/**
	 * Change lane. `blockedBy` says what a block waits on, and `landed` says which commit
	 * closed a card: both are read only by the lane they belong to, and both are optional,
	 * because a card may be blocked with nothing recorded and a `done` card may predate the
	 * field or live outside a repository.
	 */
	| { kind: "move"; status: Exclude<CardStatus, "todo">; blockedBy?: unknown; landed?: { commit: string } }
	// `text` and `path` are whatever the model sent: `card.ts` validates them, and the
	// refusal it produces is the one the caller shows.
	| { kind: "note"; text: unknown }
	| { kind: "plan"; path: unknown }
	// Every field but `kind` is optional, and an absent one is left as it was: the page
	// sends the three it can show, and omitting a link must not clear it.
	| { kind: "edit"; title: unknown; paths: unknown; priority: unknown; dependsOn: unknown }
	| { kind: "reclaim" }
	| { kind: "drop" };

/** What an operation did: the new card, or the reason it was refused. */
export type OpResult = { ok: true; card: Card; changed: boolean } | { ok: false; error: string };

/** A card's first state: `todo`, no owner, one note at most. */
export function createCard(
	id: string,
	input: { title: string; paths: string[]; note?: string; priority?: Priority },
	actor: Actor,
	now: number,
): Card {
	return {
		v: 1,
		id,
		title: input.title,
		status: "todo",
		paths: [...input.paths],
		// A new card says its priority out loud, even when it is the ordinary one, so a
		// file on disk tells a reader the whole story without a default to know.
		priority: input.priority ?? DEFAULT_PRIORITY,
		notes: input.note === undefined ? [] : [{ by: actor.label, at: now, text: input.note }],
		notesDropped: 0,
		// A card is born in `todo`, and that is a transition like any other: a reader asking
		// "how long has this been waiting" gets an answer rather than an absence.
		log: [{ status: "todo", at: now, by: actor.label }],
		logDropped: 0,
		rev: 1,
		createdAt: now,
		updatedAt: now,
		by: actor.label,
	};
}

/**
 * Whether `actor` is the owner of `card`.
 *
 * The id decides when both sides have one — a session that renamed itself is still
 * the same holder — and the label decides otherwise, case-insensitively, the way
 * the bus resolves a target.
 */
export function holds(card: Card, actor: Actor): boolean {
	const owner = card.owner;
	if (owner === undefined) return false;
	if (owner.id !== undefined && actor.id !== undefined) return owner.id === actor.id;
	return owner.label.toLowerCase() === actor.label.toLowerCase();
}

/**
 * Apply one operation.
 *
 * A refused operation returns the reason and no card: the caller already holds the
 * card it read, and a "refused" copy of it would be a second version of the truth.
 */
export function applyOp(card: Card, op: CardOp, actor: Actor, now: number, board: BoardIndex): OpResult {
	switch (op.kind) {
		case "claim":
			return claim(card, actor, now, board);
		case "assign":
			return assign(card, op.to, op.note, actor, now, board);
		case "release":
			return release(card, actor, now);
		case "move":
			return move(card, op, actor, now, board);
		case "note":
			return note(card, op.text, actor, now);
		case "plan":
			return plan(card, op.path, actor, now);
		case "edit":
			return edit(card, op, actor, now, board);
		case "reclaim":
			return reclaim(card, actor, now);
		case "drop":
			return drop(card, actor, board);
	}
}

function claim(card: Card, actor: Actor, now: number, board: BoardIndex): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be claimed.` };
	if (holds(card, actor)) return { ok: true, card, changed: false };
	if (card.owner !== undefined) return { ok: false, error: heldBy(card) };
	const waiting = waitingOn(card, board);
	if (waiting !== undefined) return { ok: false, error: waiting };
	return { ok: true, card: write(card, actor, now, { status: "doing", owner: ownerOf(actor) }), changed: true };
}

function assign(card: Card, to: Actor, rawNote: unknown, actor: Actor, now: number, board: BoardIndex): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be assigned.` };
	if (card.owner !== undefined && !holds(card, to)) return { ok: false, error: heldBy(card) };
	if (holds(card, to) && card.status === "doing") return { ok: true, card, changed: false };
	const waiting = waitingOn(card, board);
	if (waiting !== undefined) return { ok: false, error: waiting };
	const fields: Partial<Card> = { status: "doing", owner: ownerOf(to) };
	if (rawNote !== undefined) {
		const parsed = normalizeNote(rawNote);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		// One revision, not two: the history says who it went to in the same write that
		// recorded the owner, so a reader never sees the assignment without the sentence.
		Object.assign(fields, appendNote(card, actor, now, parsed.text));
	}
	return { ok: true, card: write(card, actor, now, fields), changed: true };
}

function release(card: Card, actor: Actor, now: number): OpResult {
	// Finished work is history: every other transition refuses it, and a release that did
	// not would be the one way a `done` card could go backwards — reopening the order a
	// dependency was recorded against.
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be released.` };
	if (card.owner === undefined) return { ok: false, error: `${cardRef(card.id)} is not claimed.` };
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} Release is the owner's decision.` };
	return { ok: true, card: write(card, actor, now, { status: "todo", owner: undefined }), changed: true };
}

function move(
	card: Card,
	op: Extract<CardOp, { kind: "move" }>,
	actor: Actor,
	now: number,
	board: BoardIndex,
): OpResult {
	const status = op.status;
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be moved.` };
	if (card.owner === undefined) {
		return { ok: false, error: `${cardRef(card.id)} is unclaimed; claim it before moving it to ${status}.` };
	}
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} Only its owner can move it.` };
	// A block's reason is checked before the no-op: a caller that repeats a move with a new
	// sentence meant to change it, and a refusal is clearer than a silent nothing.
	let blockedBy: string | undefined;
	if (status === "blocked" && op.blockedBy !== undefined) {
		const parsed = normalizeBlockedBy(op.blockedBy);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		blockedBy = parsed.blockedBy;
	}
	if (card.status === status && blockedBy === undefined) return { ok: true, card, changed: false };
	// Parking is what a link is for, so only the two lanes that put a card back in flight
	// are gated: a card that waits may be blocked, it may not be taken or finished.
	if (status !== "blocked") {
		const waiting = waitingOn(card, board);
		if (waiting !== undefined) return { ok: false, error: waiting };
	}
	return { ok: true, card: write(card, actor, now, laneFields(status, blockedBy, op, now)), changed: true };
}

/**
 * The fields one lane change writes.
 *
 * `blockedBy` belongs to `blocked` alone: a card that leaves for `doing` or `done` has
 * had its decision or stopped needing one, and a stale sentence would be read as a
 * current one. `landed` belongs to `done` alone, and only when the caller could name a
 * commit — a board outside git still finishes cards, it just cannot say with what.
 */
function laneFields(
	status: Exclude<CardStatus, "todo">,
	blockedBy: string | undefined,
	op: Extract<CardOp, { kind: "move" }>,
	now: number,
): Partial<Card> {
	const fields: Partial<Card> = { status };
	if (status === "blocked") {
		if (blockedBy !== undefined) fields.blockedBy = blockedBy;
	} else {
		fields.blockedBy = undefined;
	}
	if (status === "done" && op.landed !== undefined) fields.landed = { commit: op.landed.commit, at: now };
	return fields;
}

function note(card: Card, raw: unknown, actor: Actor, now: number): OpResult {
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { ok: false, error: parsed.error };
	return { ok: true, card: write(card, actor, now, appendNote(card, actor, now, parsed.text)), changed: true };
}

/** A card's notes after one more, with the oldest dropped and counted. */
function appendNote(card: Card, actor: Actor, now: number, text: string): Pick<Card, "notes" | "notesDropped"> {
	const notes = [...card.notes, { by: actor.label, at: now, text }];
	const overflow = Math.max(0, notes.length - MAX_NOTES);
	return {
		notes: overflow === 0 ? notes : notes.slice(overflow),
		notesDropped: card.notesDropped + overflow,
	};
}

/** A card's log after one more transition, with the oldest dropped and counted. */
function appendTransition(card: Card, status: CardStatus, actor: Actor, now: number): Pick<Card, "log" | "logDropped"> {
	const log = [...(card.log ?? []), { status, at: now, by: actor.label }];
	const overflow = Math.max(0, log.length - MAX_LOG);
	return {
		log: overflow === 0 ? log : log.slice(overflow),
		logDropped: (card.logDropped ?? 0) + overflow,
	};
}

function plan(card: Card, raw: unknown, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; its plan cannot change.` };
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} Only its owner records a plan.` };
	const parsed = normalizePlanPath(raw);
	if ("error" in parsed) return { ok: false, error: parsed.error };
	if (card.plan === parsed.path) return { ok: true, card, changed: false };
	return { ok: true, card: write(card, actor, now, { plan: parsed.path }), changed: true };
}

/**
 * Fix what a card says: its title, its hints, its priority, and what it waits for.
 *
 * The holder decides for a held card and anyone decides for an unclaimed one — and
 * that includes a `done` card, because a title is what a reader reads, not a step of
 * the work: a finished feature whose title says the wrong thing would stay wrong for
 * as long as the board keeps history.
 *
 * Every field is optional and an absent one is left alone; a field that already holds
 * the value asked for is not a write, so re-editing the same card is a no-op.
 */
function edit(
	card: Card,
	op: Extract<CardOp, { kind: "edit" }>,
	actor: Actor,
	now: number,
	board: BoardIndex,
): OpResult {
	if (card.owner !== undefined && !holds(card, actor)) {
		return { ok: false, error: `${heldBy(card)} Only its owner can edit it.` };
	}
	const fields: Partial<Card> = {};
	if (op.title !== undefined) {
		const parsed = normalizeTitle(op.title);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		if (parsed.title !== card.title) fields.title = parsed.title;
	}
	if (op.paths !== undefined) {
		const parsed = normalizePathHints(op.paths);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		if (!sameList(parsed.paths, card.paths)) fields.paths = parsed.paths;
	}
	if (op.priority !== undefined) {
		const parsed = normalizePriority(op.priority);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		if (parsed.priority !== priorityOf(card)) fields.priority = parsed.priority;
	}
	if (op.dependsOn !== undefined) {
		const parsed = normalizeDepends(op.dependsOn, card.id, board);
		if ("error" in parsed) return { ok: false, error: parsed.error };
		if (!sameList(parsed.dependsOn, dependsOf(card))) fields.dependsOn = parsed.dependsOn;
	}
	if (Object.keys(fields).length === 0) return { ok: true, card, changed: false };
	return { ok: true, card: write(card, actor, now, fields), changed: true };
}

function reclaim(card: Card, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; there is nothing to reclaim.` };
	if (card.owner === undefined) return { ok: false, error: `${cardRef(card.id)} has no owner to reclaim.` };
	return { ok: true, card: write(card, actor, now, { status: "todo", owner: undefined }), changed: true };
}

function drop(card: Card, actor: Actor, board: BoardIndex): OpResult {
	// A drop takes its id with it, so a card another one waits on cannot leave: the
	// remaining link would name nothing, and nothing on the board would say so.
	const depended = dependedOn(card.id, board);
	if (depended !== undefined) return { ok: false, error: depended };
	if (card.status === "todo" || card.status === "done") return { ok: true, card, changed: true };
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} It cannot be dropped while someone holds it.` };
	return { ok: true, card, changed: true };
}

/** Whether two string lists are the same list, in the same order. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * A card with `fields` applied and its write marks moved.
 *
 * This is the one place a lane change is observed, because it is the one place every
 * transition ends: a note, a plan, or an edit writes fields and leaves the lane alone,
 * while a claim, an assign, a release, a reclaim, and a move all name the new one. So
 * the log is appended from here rather than from each operation, and an operation added
 * later cannot forget it.
 */
function write(card: Card, actor: Actor, now: number, fields: Partial<Card>): Card {
	const status = fields.status;
	const transition =
		status !== undefined && status !== card.status ? appendTransition(card, status, actor, now) : undefined;
	const next: Card = { ...card, ...fields, ...transition, rev: card.rev + 1, updatedAt: now, by: actor.label };
	// `owner: undefined` must clear the field rather than store a key holding it, so a
	// released card reads back exactly like one that was never claimed. Only an
	// explicit `owner` in `fields` may delete it: every other write keeps the holder.
	if ("owner" in fields && fields.owner === undefined) delete next.owner;
	// The same for the block: a card that left `blocked` has no reason, and a key holding
	// undefined would be one more shape for a reader to know about.
	if ("blockedBy" in fields && fields.blockedBy === undefined) delete next.blockedBy;
	return next;
}

/** The owner recorded for an actor: the id only when this actor has one. */
function ownerOf(actor: Actor): CardOwner {
	return actor.id === undefined ? { label: actor.label } : { id: actor.id, label: actor.label };
}

/** The refusal for an operation on a card someone else holds. */
function heldBy(card: Card): string {
	return `${cardRef(card.id)} is held by ${card.owner?.label ?? "another session"}.`;
}
