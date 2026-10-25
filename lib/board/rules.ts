/**
 * The card lifecycle: every transition, as a pure function of the card, the
 * operation, who asked, and the clock.
 *
 * One table decides who may do what — the tool, the router, and the page all
 * route through {@link applyOp} — so a lane change cannot be reachable from one
 * surface and refused from another. Nothing here touches the filesystem or the
 * bus: ownership is advisory (the bus's path claims are the lock), and the store
 * owns the compare-and-set that makes a concurrent writer lose.
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
	MAX_NOTES,
	normalizeNote,
	normalizePlanPath,
} from "./card.ts";

/** Who is attempting an operation: a session when it has one, and the label it is addressed by. */
export interface Actor {
	id?: string;
	label: string;
}

/** One named mutation of one card. */
export type CardOp =
	| { kind: "claim" }
	| { kind: "assign"; to: Actor }
	| { kind: "release" }
	| { kind: "move"; status: Exclude<CardStatus, "todo"> }
	// `text` and `path` are whatever the model sent: `card.ts` validates them, and the
	// refusal it produces is the one the caller shows.
	| { kind: "note"; text: unknown }
	| { kind: "plan"; path: unknown }
	| { kind: "reclaim" }
	| { kind: "drop" };

/** What an operation did: the new card, or the reason it was refused. */
export type OpResult = { ok: true; card: Card; changed: boolean } | { ok: false; error: string };

/** A card's first state: `todo`, no owner, one note at most. */
export function createCard(
	id: string,
	input: { title: string; paths: string[]; note?: string },
	actor: Actor,
	now: number,
): Card {
	return {
		v: 1,
		id,
		title: input.title,
		status: "todo",
		paths: [...input.paths],
		notes: input.note === undefined ? [] : [{ by: actor.label, at: now, text: input.note }],
		notesDropped: 0,
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
export function applyOp(card: Card, op: CardOp, actor: Actor, now: number): OpResult {
	switch (op.kind) {
		case "claim":
			return claim(card, actor, now);
		case "assign":
			return assign(card, op.to, actor, now);
		case "release":
			return release(card, actor, now);
		case "move":
			return move(card, op.status, actor, now);
		case "note":
			return note(card, op.text, actor, now);
		case "plan":
			return plan(card, op.path, actor, now);
		case "reclaim":
			return reclaim(card, actor, now);
		case "drop":
			return drop(card, actor);
	}
}

function claim(card: Card, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be claimed.` };
	if (holds(card, actor)) return { ok: true, card, changed: false };
	if (card.owner !== undefined) return { ok: false, error: heldBy(card) };
	return { ok: true, card: write(card, actor, now, { status: "doing", owner: ownerOf(actor) }), changed: true };
}

function assign(card: Card, to: Actor, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be assigned.` };
	if (card.owner !== undefined && !holds(card, to)) return { ok: false, error: heldBy(card) };
	if (holds(card, to) && card.status === "doing") return { ok: true, card, changed: false };
	return { ok: true, card: write(card, actor, now, { status: "doing", owner: ownerOf(to) }), changed: true };
}

function release(card: Card, actor: Actor, now: number): OpResult {
	if (card.owner === undefined) return { ok: false, error: `${cardRef(card.id)} is not claimed.` };
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} Release is the owner's decision.` };
	return { ok: true, card: write(card, actor, now, { status: "todo", owner: undefined }), changed: true };
}

function move(card: Card, status: Exclude<CardStatus, "todo">, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; it cannot be moved.` };
	if (card.owner === undefined) {
		return { ok: false, error: `${cardRef(card.id)} is unclaimed; claim it before moving it to ${status}.` };
	}
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} Only its owner can move it.` };
	if (card.status === status) return { ok: true, card, changed: false };
	return { ok: true, card: write(card, actor, now, { status }), changed: true };
}

function note(card: Card, raw: unknown, actor: Actor, now: number): OpResult {
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { ok: false, error: parsed.error };
	const notes = [...card.notes, { by: actor.label, at: now, text: parsed.text }];
	const overflow = Math.max(0, notes.length - MAX_NOTES);
	return {
		ok: true,
		card: write(card, actor, now, {
			notes: overflow === 0 ? notes : notes.slice(overflow),
			notesDropped: card.notesDropped + overflow,
		}),
		changed: true,
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

function reclaim(card: Card, actor: Actor, now: number): OpResult {
	if (card.status === "done") return { ok: false, error: `${cardRef(card.id)} is done; there is nothing to reclaim.` };
	if (card.owner === undefined) return { ok: false, error: `${cardRef(card.id)} has no owner to reclaim.` };
	return { ok: true, card: write(card, actor, now, { status: "todo", owner: undefined }), changed: true };
}

function drop(card: Card, actor: Actor): OpResult {
	if (card.status === "todo" || card.status === "done") return { ok: true, card, changed: true };
	if (!holds(card, actor)) return { ok: false, error: `${heldBy(card)} It cannot be dropped while someone holds it.` };
	return { ok: true, card, changed: true };
}

/** A card with `fields` applied and its write marks moved. */
function write(card: Card, actor: Actor, now: number, fields: Partial<Card>): Card {
	const next: Card = { ...card, ...fields, rev: card.rev + 1, updatedAt: now, by: actor.label };
	// `owner: undefined` must clear the field rather than store a key holding it, so a
	// released card reads back exactly like one that was never claimed. Only an
	// explicit `owner` in `fields` may delete it: every other write keeps the holder.
	if ("owner" in fields && fields.owner === undefined) delete next.owner;
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
