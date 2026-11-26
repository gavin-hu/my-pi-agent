/**
 * The name a session holds on the bus: who else has it, yielding it, publishing it, and how a
 * refusal names its holder.
 *
 * One job, so the runtime keeps its lifecycle and this keeps the vocabulary: a label is a send
 * target, a card's owner, and the name the bar draws, and every one of those is settled here. The
 * seams are the runtime's own facts handed over at the start that built them — the record this
 * process serves, the store it was written to, and the clock and TTL a name's window is measured in.
 *
 * Loaded with `await import()` by the start that needs it, like `own-record.ts`: a session that
 * never joins pays nothing for the name it would not have settled, and `session-bus`'s entry stays
 * at its module budget.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RosterState } from "../../lib/session-roster.ts";
import { labelKey, MAX_LABEL, SESSION_LABEL_CHANNEL } from "../../lib/session-label.ts";
import { shortId } from "./protocol.ts";
import type { BusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

/** A label with this session's short id appended, inside the label budget. */
function suffixLabel(label: string, id: string): string {
	const suffix = `-${shortId(id)}`;
	return `${label.slice(0, MAX_LABEL - suffix.length)}${suffix}`;
}

/** What the start knows about the name it just took, and what it may write it to. */
export interface LabelSeams {
	/** The host's event bus, and the call that names the transcript it holds. */
	pi: Pick<ExtensionAPI, "events">;
	/** The bus this session was written to. */
	store: BusStore;
	/** The record this process serves: the row a `/new` keeps. */
	record: SessionRecord;
	/** What one record says about its session, for a refusal's wording. */
	stateOf: (session: SessionRecord) => RosterState;
	now: () => number;
	/** How long a name stays its taker's, the window `store.pruneRecords` keeps a record for. */
	sessionTtlMs: number;
}

/** The name this session holds, and the four ways it is read or changed. */
export interface SessionLabels {
	/** The labels other sessions hold, and the record holding each. */
	taken(mine: string): Promise<Map<string, SessionRecord>>;
	/** Yield a name a rival already holds; answers whether it yielded. */
	settle(): Promise<boolean>;
	/** Tell the footer what peers address this session by. */
	publish(): void;
	/** The holder as a refusal names it: which session, and what it is now. */
	heldBy(holder: SessionRecord): string;
}

export function createLabels(seams: LabelSeams): SessionLabels {
	const { pi, store, record, stateOf, now, sessionTtlMs } = seams;

	async function taken(mine: string): Promise<Map<string, SessionRecord>> {
		const sessions = await store.sessions();
		const taken = new Map<string, SessionRecord>();
		// Every record the bus is still keeping, not only a live one. A label is what a session
		// is addressed by, and `team.lead` is a name whose signature decides whether a card may
		// be executed or finished — so a name stays its taker's while the bus remembers the
		// session, which is the same window `store.pruneRecords` keeps the record for. A session that
		// crashed a minute ago therefore holds its name instead of leaving it to whoever joins
		// next.
		//
		// The window is the pruner's own, asked here rather than read off `stateOf`: a record
		// past the TTL holds nothing, because the next read deletes it — and a session that
		// yielded to one would spend its life suffixed by a row that no longer exists.
		const at = now();
		for (const session of sessions) {
			if (session.id !== mine && at - session.lastSeen <= sessionTtlMs) taken.set(labelKey(session.label), session);
		}
		return taken;
	}

	/**
	 * A collision is settled by yielding, never by comparing session ids: a session
	 * that keeps the label does not look again, and two of them can each decide that.
	 * Every writer that observes a rival yields, and the record written last always
	 * observes the other, so a collision ends with two distinct labels.
	 *
	 * Answers whether this call yielded, which is the only thing that can change a label
	 * after it is settled — the heartbeat tick is where that happens.
	 */
	async function settle(): Promise<boolean> {
		let yields = 0;
		while (yields < 3 && (await taken(record.id)).has(labelKey(record.label))) {
			record.label = suffixLabel(record.label, record.id);
			yields += 1;
		}
		if (yields === 0) return false;
		record.lastSeen = now();
		await store.writeSession(record);
		return true;
	}

	/**
	 * Tell the footer what peers address this session by.
	 *
	 * Nothing else can say what a label is: the bus settles it, yields it on a collision, and
	 * gives it to a caller that asked for a name. The footer draws it in place of Pi's own
	 * session name, which the terminal knows but a card, a handoff, and `/team` do not.
	 */
	function publish(): void {
		// A host with no event bus has no listener: the footer it would feed keeps Pi's own name.
		pi.events?.emit(SESSION_LABEL_CHANNEL, { id: record.id, label: record.label });
	}

	/**
	 * The label's holder as a refusal names it: which session, and what it is now.
	 *
	 * A label held by a record that cannot answer reads as a bug unless the sentence says so —
	 * the name is kept because the bus still remembers the session, and it gives the name back
	 * when the heartbeat ages out and a read prunes the record.
	 */
	function heldBy(holder: SessionRecord): string {
		// Only two states can arrive: `taken` reserves a record inside the TTL the prune
		// goes by, so a holder is live or its process is gone.
		return stateOf(holder) === "gone"
			? `held by session ${holder.id}, which is not running — the bus forgets it when its heartbeat ages out`
			: `already in use by session ${holder.id}`;
	}

	return { taken, settle, publish, heldBy };
}
