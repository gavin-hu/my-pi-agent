/**
 * Driving a card through the board's gates, for the tests that are not about the gates.
 *
 * A card cannot reach `execute` without the lead's approval, and cannot be finished without the
 * lead's spot-check, so a suite that wants a card in a lane would otherwise repeat four
 * operations — and repeat them slightly differently. The helpers here perform exactly what the
 * tool does, through `store.mutate`, so a test that seeds a board cannot seed a state the rules
 * would refuse. Both signatures are the person at the keyboard's, which is the one actor no board
 * has to be configured to accept; a suite that means a session's signature drives the tool
 * instead. The plan proof is the one fact a helper cannot mint for the tool: a suite that seeds
 * here and then drives `board move` passes `planPath` inside its own plan directory, because the
 * tool re-checks that the file is there.
 */

import { personActor } from "../../lib/board/lead.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { Lane } from "../../lib/board/lanes.ts";
import type { BoardStore } from "../../lib/board/store.ts";

/** Who a seeded card belongs to. */
export interface Seeded {
	owner: Actor;
	/** The commit a seed records on the way to `done`; absent leaves the card with none. */
	landed?: string;
	/**
	 * The plan file the seed records, proved as the tool proves it.
	 *
	 * Absent means `<id>.md` — a plan name, which the store resolves inside itself, so the
	 * record has the shape `contract` accepts even though no file is there. A suite that
	 * lets the tool re-check the store passes a path inside its own plan directory.
	 */
	planPath?: string;
}

/** A contract a test card can carry: three lines, and nothing about the feature. */
export const TEST_CONTRACT = {
	goal: "The feature does what the card says",
	acceptance: "A reader can tell it is done",
	scopeOut: "Everything the card does not name",
};

/**
 * Move `id` to `lane`, performing the gates on the way, as the person signs them.
 *
 * The lane is a target, not a path: the helper reads where the card is and applies only the
 * operations that are still owed, so `advance(store, id, "done")` works from the pool or
 * from `execute`. A refusal is thrown rather than returned: a seed that the rules refuse is
 * a broken fixture, and a silent one would make every assertion after it a guess.
 */
export async function advance(store: BoardStore, id: string, lane: Lane, who: Seeded, now: number): Promise<void> {
	const plan = who.planPath ?? `${id}.md`;
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
		// The artifact is the fact the tool proves; a seed records the path it names.
		await apply({ kind: "contract", artifact: { path: plan }, ...TEST_CONTRACT });
	}
	const written = await read();
	if (written.contract?.approved === undefined) {
		const result = await store.mutate(id, { kind: "approve" }, personActor(), now);
		if (!result.ok) fail(result.error);
	}
	const contract = (await read()).planPath;
	if ((await read()).lane === "plan") {
		await apply({ kind: "move", lane: "execute", artifact: { path: contract ?? plan } });
	}
	if (lane === "execute") return;
	if ((await read()).review === undefined) {
		const result = await store.mutate(id, { kind: "review" }, personActor(), now);
		if (!result.ok) fail(result.error);
	}
	// No commit unless the caller names one: a board outside a repository finishes cards
	// without one, and a test of that state must not be handed a fake.
	await apply(
		who.landed === undefined
			? { kind: "move", lane: "done", artifact: { path: contract ?? plan } }
			: {
					kind: "move",
					lane: "done",
					landed: { commit: who.landed },
					artifact: { path: contract ?? plan },
				},
	);
}
