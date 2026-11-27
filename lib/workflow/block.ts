/**
 * The block record: why a card sits in `blocked`, and the one line a person reads.
 *
 * Split out of `card.ts` beside `shelved.ts`, because the two are one family — a card set
 * aside, with the sentence a row can hold — and because the record module sits at the module
 * bar. Nothing here knows about lanes or ownership: this is the shape, its cap, the boundary
 * a `move`'s two parameters pass through, and the guard `isCard` applies.
 *
 * Value-only: no I/O, no state.
 */

import { overLimit, sanitizeLine } from "../format.ts";

/** Longest sentence saying what a blocked card is waiting on: one line, so it fits a row. */
export const MAX_BLOCKED = 200;

/**
 * Why a card is blocked: what a person has to read before it moves again.
 *
 * A block is not one thing: a contract that turned out wrong, a dependency, and a decision
 * a person owes the card are different errands. The kind is the card's own claim — the board
 * records it and draws it, and nothing here can verify that a "contract" block really is
 * one — so it explains the card rather than routing it: where a blocked card may go is
 * decided by what it has, not by what it was parked on.
 */
export const BLOCKERS = ["contract", "dependency", "decision"] as const;

/** One kind of block. */
export type BlockerKind = (typeof BLOCKERS)[number];

/**
 * Why a card is blocked: the kind, and the sentence a person reads.
 *
 * One record rather than two sibling keys, because one fact deserves one key. The kind is
 * absent only on a card written before it existed — a v1 block may hold the sentence alone
 * — and every block this build writes carries one, because the move into `blocked`
 * requires it. It says what kind of errand parked the card, and it is not a route: the way
 * out is the lane the card's contract lets it resume in.
 */
export interface CardBlock {
	/** Why it is blocked, when it was recorded. */
	kind?: BlockerKind;
	/** What it waits on, in one line; absent means the block was recorded without a sentence. */
	note?: string;
}

/**
 * The block a move records: one kind, and the sentence when one is given.
 *
 * The refusals name the tool's parameters (`blocker`, `blockedBy`) rather than the record's
 * fields, because this is the boundary the model's arguments pass, and the model wrote a
 * parameter. The kind is required here — a block this build writes always says what kind it
 * is — and the sentence is not: a card may be parked with nothing written down.
 */
export function normalizeBlock(rawKind: unknown, rawNote: unknown): { blocked: CardBlock } | { error: string } {
	const allowed = BLOCKERS.join(", ");
	const kind = typeof rawKind === "string" ? sanitizeLine(rawKind).trim().toLowerCase() : "";
	const known = BLOCKERS.find((entry) => entry === kind);
	if (known === undefined) return { error: `blocker must be one of ${allowed}.` };
	if (rawNote === undefined) return { blocked: { kind: known } };
	if (typeof rawNote !== "string") return { error: "blockedBy must be text." };
	const note = sanitizeLine(rawNote).trim();
	if (note === "") return { error: "blockedBy must say what the card waits on." };
	if (note.length > MAX_BLOCKED) return { error: overLimit("blockedBy", note.length, MAX_BLOCKED) };
	return { blocked: { kind: known, note } };
}

/**
 * A recorded block: a kind this build knows when one is there, and a sentence a row can
 * hold when one is there — at least one of the two, because an empty block says nothing.
 */
export function isBlock(value: unknown): value is CardBlock {
	if (typeof value !== "object" || value === null) return false;
	const block = value as Record<string, unknown>;
	if (block.kind !== undefined && !BLOCKERS.includes(block.kind as BlockerKind)) return false;
	if (block.note !== undefined) {
		if (typeof block.note !== "string" || block.note === "" || block.note.length > MAX_BLOCKED) return false;
	}
	return block.kind !== undefined || block.note !== undefined;
}
