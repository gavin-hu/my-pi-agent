/**
 * The pure rules' fixtures: three sessions, one board's settings, and cards at each gate.
 *
 * `rules.test.ts` and `signs.test.ts` are two suites over one state machine — the dispatch and
 * the lane matrix on one side, the two signatures on the other — and a builder copied into both
 * is how two suites end up proving different state machines. Everything here is value-only: a
 * call returns a fresh card, and no test shares one.
 *
 * The settings name `billing-lead` as the board's lead, because a pure test signs through the
 * same gate a session does; `card.ts`'s own record is `test/helpers/fixtures/board.ts`.
 */

import type { Card } from "../../../lib/board/card.ts";
import type { BoardConfig } from "../../../lib/board/config.ts";
import type { Contract } from "../../../lib/board/contract.ts";
import { DEFAULT_WIP } from "../../../lib/board/limits.ts";
import { indexOf } from "../../../lib/board/links.ts";
import { type Actor, applyOp as apply, createCard, mayOp as dryRun, type OpResult } from "../../../lib/board/rules.ts";

/** The session the gates take a signature from, and the one that owns nearly every card here. */
export const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
export const CORE: Actor = { id: "s-core", label: "billing-core" };
export const OTHER: Actor = { id: "s-other", label: "billing-other" };
export const NOW = 2_000;

/** The board's settings: `billing-lead` signs, and the lanes hold the default numbers. */
export const CONFIG: BoardConfig = { wip: DEFAULT_WIP, lead: LEAD.label };

/** The index one board is to an operation. */
export type Board = ReturnType<typeof indexOf>;

/** A board of these cards, which is the index every operation is checked against. */
export function boardOf(...cards: Card[]): Board {
	return indexOf(cards);
}

/** The accepted result, or a failure that names the refusal. */
export function accepted(result: OpResult): { card: Card; changed: boolean } {
	if (!result.ok) throw new Error(`expected acceptance, got: ${result.error}`);
	return { card: result.card, changed: result.changed };
}

/** The refusal's message, or a failure that names the card it wrongly returned. */
export function refusal(result: OpResult): string {
	if (result.ok) throw new Error("expected a refusal, got an accepted operation");
	return result.error;
}

/** One operation, applied with this board's settings: `billing-lead` signs, and the lanes hold. */
export function applyOp(
	card: Card,
	op: Parameters<typeof apply>[1],
	actor: Actor,
	now: number,
	index: Board,
	config = CONFIG,
): OpResult {
	return apply(card, op, actor, now, index, config);
}

/** The same decision without the write, with the same settings. */
export function mayOp(card: Card, op: Parameters<typeof dryRun>[1], actor: Actor, index: Board, config = CONFIG) {
	return dryRun(card, op, actor, index, config);
}

/** One step of a card's life, applied against a board holding just that card. */
export function stepOf(card: Card, op: Parameters<typeof apply>[1], actor: Actor, config: BoardConfig = CONFIG): Card {
	return accepted(applyOp(card, op, actor, NOW, boardOf(card), config)).card;
}

/** A card in the pool, its title the feature the suites are about. */
export function created(): Card {
	return createCard("4", { title: "Billing webhook accepts orders", paths: ["src/billing"] }, LEAD, 1_000);
}

/** A card somebody has pulled into `plan`. */
export function claimed(owner: Actor = CORE): Card {
	return stepOf(created(), { kind: "claim" }, owner);
}

/** The contract a test card carries: three lines, and nothing about the feature. */
export const CONTRACT = {
	goal: "A webhook order is stored once",
	acceptance: "A retried delivery leaves one order",
	scopeOut: "No refunds",
};

/**
 * The plan artifact a caller hands in once it has proved the file.
 *
 * The board's state machine decides; the tool is what touches the plan store, so a pure test
 * passes the fact the way the tool would and the path is only a string here.
 */
export function proved(path = "plans/webhook.md") {
	return { path };
}

/** The proof a move carries: bound to the record it was computed for. */
export function provedFor(card: Card) {
	const recorded = card.planPath ?? "plans/webhook.md";
	return { path: recorded, recorded };
}

/** A card whose contract is written, still in `plan`. */
export function written(owner: Actor = CORE, contract: Partial<Contract> = {}): Card {
	return stepOf(claimed(owner), { kind: "contract", artifact: proved(), ...CONTRACT, ...contract }, owner);
}

/** A card whose contract the lead has approved, still in `plan`. */
export function approved(owner: Actor = CORE, approver: Actor = LEAD): Card {
	return stepOf(written(owner), { kind: "approve" }, approver);
}

/** A card executing: past the contract gate. */
export function executing(card: Card = approved()): Card {
	return stepOf(card, { kind: "move", lane: "execute", artifact: provedFor(card) }, CORE);
}

/** A card whose work the lead has spot-checked, still in `execute`. */
export function reviewed(owner: Actor = CORE, reviewer: Actor = LEAD): Card {
	return stepOf(executing(approved(owner)), { kind: "review" }, reviewer);
}

/** A card in `plan` on one of `ids`, for the cases that need several at once. */
export function pulled(id: string, owner: Actor): Card {
	return stepOf(createCard(id, { title: `T${id}`, paths: [] }, LEAD, 1_000), { kind: "claim" }, owner);
}

/** A card in `plan` with its contract written and approved, ready for `execute`. */
export function ready(id: string, owner: Actor): Card {
	const card = stepOf(pulled(id, owner), { kind: "contract", artifact: proved(`plans/${id}.md`), ...CONTRACT }, owner);
	return stepOf(card, { kind: "approve" }, LEAD);
}
