/**
 * The dependency graph: which card waits for which, answered over an index of the
 * whole board.
 *
 * A link is one id in the waiting card's own file — `#4 dependsOn ["2"]` — and the
 * reverse edge is never stored, because a second copy of one edge is a copy that can
 * drift. Questions that need the other cards (is this blocker finished, would this
 * link close a loop, who waits on this card) are answered here, and `rules.ts` calls
 * in with the index it was given, so the tool, the page, and `team` refuse the same
 * link for the same reason.
 *
 * The graph is bounded by the store, not here: a card file is read through `isCard`,
 * so every id is numeric and unique, and a dependency that names a card which is not
 * on the board is refused when the link is written — and a card cannot be dropped
 * while another waits on it.
 *
 * Pure: no I/O, no clock, and no state.
 */

import { type Card, type FieldError, cardRef, dependsOf, MAX_DEPENDS, normalizeCardId } from "./card.ts";

/** The board as the graph reads it: every card, by its unpadded id. */
export type BoardIndex = ReadonlyMap<string, Card>;

/** Index `cards` by id, which is what every graph question is asked against. */
export function indexOf(cards: readonly Card[]): BoardIndex {
	return new Map(cards.map((card) => [card.id, card]));
}

/**
 * The cards `card` waits for that are not finished, in the order it names them.
 *
 * A finished dependency is what a link is for: it has stopped explaining why the
 * card cannot start, so it stops counting here and the card reads as ready.
 */
export function blockersOf(card: Card, board: BoardIndex): Card[] {
	return dependsOf(card)
		.map((id) => board.get(id))
		.filter((other): other is Card => other !== undefined && other.lane !== "done");
}

/**
 * A list of cards as a reader meets it: `#2 (execute), #3 (blocked)`.
 *
 * The lane is what turns ids into a decision — a finished card is about to start, a
 * `execute` one is to leave alone — so it is never left out. One wording serves the
 * refusal sentence, the page's reason line, and the mirror question of what a card is
 * holding up: every one of them is a list of cards read to decide something, so a second
 * formatter would be a second way for the same list to read.
 */
export function lanesText(cards: readonly Card[]): string {
	return cards.map((card) => `${cardRef(card.id)} (${card.lane})`).join(", ");
}

/** The cards that wait on `id`, oldest id first, so a report reads in board order. */
export function dependentsOf(id: string, board: BoardIndex): Card[] {
	return [...board.values()].filter((card) => dependsOf(card).includes(id)).sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * The cards still waiting on `id`: the work this card is holding up.
 *
 * The mirror of {@link blockersOf}, and for the same reason — a finished dependent has
 * stopped waiting, so it stops counting here and a card whose only dependents are done
 * reads as one nothing waits on. `dependentsOf` keeps every edge, because the drop
 * refusal is about a link that would be stranded rather than about work that is held up.
 */
export function openDependentsOf(id: string, board: BoardIndex): Card[] {
	return dependentsOf(id, board).filter((card) => card.lane !== "done");
}

/** The sentence a claim, a move, or an assignment is refused with while `card` waits, or undefined. */
export function waitingOn(card: Card, board: BoardIndex): string | undefined {
	const blockers = blockersOf(card, board);
	if (blockers.length === 0) return undefined;
	return `${cardRef(card.id)} waits on ${lanesText(blockers)}.`;
}

/** The sentence a drop is refused with while another card waits on `id`, or undefined. */
export function dependedOn(id: string, board: BoardIndex): string | undefined {
	const dependents = dependentsOf(id, board);
	if (dependents.length === 0) return undefined;
	const named = dependents.map((card) => cardRef(card.id)).join(", ");
	const which = dependents.length === 1 ? "that card" : "those cards";
	return `${cardRef(id)} is waited on by ${named}; drop ${which} first.`;
}

/**
 * Whether making `id` wait on `dependsOn` would close a loop, and the sentence saying so.
 *
 * A loop is nothing a reader could act on: every card in it would wait forever, and
 * the rollup would keep calling the whole ring blocked. It is checked through the
 * existing edges rather than by counting depth, so a chain of any length is refused.
 */
export function wouldCycle(id: string, dependsOn: readonly string[], board: BoardIndex): string | undefined {
	for (const dependency of dependsOn) {
		if (reaches(dependency, id, board)) {
			return `${cardRef(id)} cannot wait on ${cardRef(dependency)}: that would make a loop.`;
		}
	}
	return undefined;
}

/**
 * The dependency list as stored: existing card ids, no repeats, no self, no loop.
 *
 * `[]` is a legal answer and means "waits on nothing", so an edit can remove a link
 * — the caller decides whether an absent list means "leave it alone" or "none".
 */
export function normalizeDepends(raw: unknown, id: string, board: BoardIndex): { dependsOn: string[] } | FieldError {
	if (!Array.isArray(raw)) return { error: "dependsOn must be a list of card ids." };
	const dependsOn: string[] = [];
	for (const entry of raw) {
		const parsed = normalizeCardId(entry);
		// The file name is the canonical spelling of an id, so `#04` and `4` are one card.
		const dependency = parsed === undefined ? undefined : String(Number(parsed));
		if (dependency === undefined) return { error: `${JSON.stringify(entry)} is not a card id.` };
		if (dependency === id) return { error: `${cardRef(id)} cannot wait on itself.` };
		if (!board.has(dependency)) return { error: `${cardRef(dependency)} does not exist.` };
		if (!dependsOn.includes(dependency)) dependsOn.push(dependency);
	}
	if (dependsOn.length > MAX_DEPENDS) return { error: `at most ${MAX_DEPENDS} dependencies are allowed.` };
	const loop = wouldCycle(id, dependsOn, board);
	if (loop !== undefined) return { error: loop };
	return { dependsOn };
}

/** Whether `from` reaches `target` along the graph's edges. */
function reaches(from: string, target: string, board: BoardIndex): boolean {
	const seen = new Set<string>();
	const pending = [from];
	while (pending.length > 0) {
		const id = pending.pop();
		if (id === undefined || seen.has(id)) continue;
		if (id === target) return true;
		seen.add(id);
		const card = board.get(id);
		if (card !== undefined) pending.push(...dependsOf(card));
	}
	return false;
}
