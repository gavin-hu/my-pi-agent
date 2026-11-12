/**
 * The turn: whether a session is inside an agent run right now.
 *
 * A heartbeat answers "is this session still there", which is a different question
 * from the one a lead asks of a teammate — "is it in the middle of something, or
 * free to take this card". So the bus records the turn as well: `agent_start` stamps
 * `turnAt` on the record and `agent_settled` takes it off again, each written at once
 * rather than on the next heartbeat, because a row that lags ten seconds behind a
 * turn is a row that says "working" about a session which just answered.
 *
 * Two facts, one field: absent is "not in a turn", and a stamp needs a fresh
 * heartbeat to be believed — a process that died mid-turn wrote `turnAt` and then
 * stopped, so a reader pairs it with the liveness rule (`lib/session-roster.ts`)
 * rather than trusting the stamp alone.
 *
 * Nothing here joins: a session that never joined has no record to stamp, and the
 * turn is a field on it rather than a second file.
 */

import type { BusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

/** What the turn needs of the runtime, all of it the runtime's own state. */
export interface TurnDeps {
	/** The bus store, once this session has started one. */
	store: () => BusStore | undefined;
	/** This session's record. */
	record: () => SessionRecord | undefined;
	/** Whether the record is the bus's yet: a turn before a join stamps nobody. */
	joined: () => boolean;
	now: () => number;
}

/** The two edges of one turn. */
export interface Turn {
	/** A run began: stamp the record and write it now. */
	start(): Promise<void>;
	/** The run settled, aborted or not: drop the stamp and write it now. */
	settle(): Promise<void>;
}

export function createTurn(deps: TurnDeps): Turn {
	/** The one write both edges make: the stamp, then the record as it stands. */
	async function write(stamp: number | undefined): Promise<void> {
		if (!deps.joined()) return;
		const record = deps.record();
		const store = deps.store();
		if (record === undefined || store === undefined) return;
		if (stamp === undefined) delete record.turnAt;
		else record.turnAt = stamp;
		await store.writeSession(record);
	}

	return {
		// A failure is the caller's to swallow: an edge that cannot be written must not
		// turn a run that is otherwise fine into one that reports an error.
		start: () => write(deps.now()),
		settle: () => write(undefined),
	};
}
