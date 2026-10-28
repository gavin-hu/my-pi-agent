/**
 * Driving a card through the board's gates, for the tests that are not about the gates.
 *
 * A card cannot reach `execute` without a contract somebody else approved, and cannot be
 * finished without a spot-check, so a suite that wants a card in a lane would otherwise
 * repeat four operations — and repeat them slightly differently. The helpers here perform
 * exactly what the tool does, through `store.mutate`, so a test that seeds a board cannot
 * seed a state the rules would refuse.
 */

import type { Actor } from "../../lib/board/rules.ts";
import type { Lane } from "../../lib/board/lanes.ts";
import type { BoardStore } from "../../lib/board/store.ts";

/** Who a seeded card belongs to, and who approves it: two sessions, as the gate requires. */
export interface Seeded {
	owner: Actor;
	reviewer: Actor;
	/** The commit a seed records on the way to `done`; absent leaves the card with none. */
	landed?: string;
}

/** A contract a test card can carry: three lines, and nothing about the feature. */
export const TEST_CONTRACT = {
	goal: "The feature does what the card says",
	acceptance: "A reader can tell it is done",
	scopeOut: "Everything the card does not name",
};

/**
 * Move `id` to `lane`, performing the gates on the way.
 *
 * The lane is a target, not a path: the helper reads where the card is and applies only the
 * operations that are still owed, so `advance(store, id, "done")` works from the pool or
 * from `execute`. A refusal is thrown rather than returned: a seed that the rules refuse is
 * a broken fixture, and a silent one would make every assertion after it a guess.
 */
export async function advance(store: BoardStore, id: string, lane: Lane, who: Seeded, now: number): Promise<void> {
	const fail = (error: string): never => {
		throw new Error(`seeding #${id} for ${lane}: ${error}`);
	};
	const read = async () => {
		const card = await store.read(id);
		if (card === undefined) throw new Error(`seeding #${id}: the card is not on the board`);
		return card;
	};
	const apply = async (op: Parameters<BoardStore["mutate"]>[1]): Promise<void> => {
		const result = await store.mutate(id, op, who.owner, now);
		if (!result.ok) fail(result.error);
	};

	if (lane === "backlog") return;
	if (lane === "blocked") {
		if ((await read()).lane === "backlog") await apply({ kind: "claim" });
		await apply({ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "a person has to decide" });
		return;
	}
	if ((await read()).lane === "backlog") await apply({ kind: "claim" });
	if (lane === "plan") return;
	const planned = await read();
	if (planned.contract === undefined) {
		await apply({ kind: "contract", path: `plans/${id}.md`, ...TEST_CONTRACT });
	}
	const written = await read();
	if (written.contract?.approved === undefined) {
		const result = await store.mutate(id, { kind: "approve" }, who.reviewer, now);
		if (!result.ok) fail(result.error);
	}
	if ((await read()).lane === "plan") await apply({ kind: "move", lane: "execute" });
	if (lane === "execute") return;
	if ((await read()).review === undefined) {
		const result = await store.mutate(id, { kind: "review" }, who.reviewer, now);
		if (!result.ok) fail(result.error);
	}
	// No commit unless the caller names one: a board outside a repository finishes cards
	// without one, and a test of that state must not be handed a fake.
	await apply(
		who.landed === undefined
			? { kind: "move", lane: "done" }
			: { kind: "move", lane: "done", landed: { commit: who.landed } },
	);
}
