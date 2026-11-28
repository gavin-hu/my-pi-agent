/**
 * `/sessions forget`: a person's door to a stopped session's name, as policy.
 *
 * A label is reserved for as long as the bus keeps its record — the heartbeat window — because a
 * name is what a peer addresses and what `team.lead` is compared by. A session's own stop frees it
 * (`/team exit`), and a process that was killed has no door of its own, so this is the person's: it
 * removes a record the bus already reads as `gone`, with the claims a card is worked under, and
 * leaves the inbox for `drop`.
 *
 * `stateOf` arrives as a parameter rather than being re-derived: the door and the row must never
 * disagree about `gone`, and `runtime.ts` owns that rule. The removal is `releaseAll` then
 * `removeSession` — released first, so a failure costs claims that can be taken again rather than
 * paths orphaned by a missing owner.
 *
 * Loaded with `await import()` by the runtime, like `own-record.ts`: a session that never runs the
 * command pays nothing for it, and the entry's static graph does not move.
 */

import { labelKey } from "../../lib/session-label.ts";
import type { RosterState } from "../../lib/session-roster.ts";
import type { BusStore } from "./store.ts";
import type { ForgetResult, KeptForget, SessionRecord } from "./types.ts";

/** What the door reads: the records, their one liveness answer, and the writes that free a row. */
export interface ForgetSeams {
	store: Pick<BusStore, "sessions" | "releaseAll" | "removeSession">;
	/** The bus's one liveness answer — `rosterStateOf` over the record's own facts. */
	stateOf: (session: SessionRecord) => RosterState;
}

/**
 * Free every name the caller may: one answer per name, in the order given.
 *
 * A name is an id when it matches one exactly, else a label compared without case. A label with more
 * than one record is refused rather than guessed at, because a replicated store can hold two
 * machines' sessions under one name and the wrong guess would free the wrong one. A name typed
 * twice frees one row once.
 */
export async function forgetSessions(seams: ForgetSeams, names: readonly string[]): Promise<ForgetResult> {
	const { store, stateOf } = seams;
	const records = await store.sessions();
	const forgotten: ForgetResult["forgotten"] = [];
	const kept: KeptForget[] = [];
	const removed = new Set<string>();
	for (const name of names) {
		const [record, ...rest] = recordsNamed(records, name);
		if (record === undefined) {
			kept.push({ name, reason: "missing" });
			continue;
		}
		if (rest.length > 0) {
			kept.push({ name, reason: "ambiguous", holders: [record, ...rest].map((entry) => entry.id).sort() });
			continue;
		}
		if (stateOf(record) !== "gone") {
			kept.push({ name, reason: "held", holder: record.id });
			continue;
		}
		if (removed.has(record.id)) continue;
		const released = await store.releaseAll(record.id);
		await store.removeSession(record.id);
		removed.add(record.id);
		forgotten.push({ id: record.id, label: record.label, released });
	}
	return { forgotten, kept };
}

/** The records a name means: the one whose id it is, else every record it labels. */
function recordsNamed(records: readonly SessionRecord[], name: string): SessionRecord[] {
	const byId = records.find((record) => record.id === name);
	if (byId !== undefined) return [byId];
	const key = labelKey(name);
	return records.filter((record) => labelKey(record.label) === key);
}
