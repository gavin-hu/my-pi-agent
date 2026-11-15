/**
 * The bus as a reader sees it: the rows a page or `session status` draws, and the numbers on them.
 *
 * One rule needs to live in one place: the number is the mail a session has not been told about,
 * so the row for the reading session comes from memory — its record on disk is the copy a peer
 * reads, and that copy lags the mail it was just told about — while every other row is read from
 * the file, because the file is all there is. A session's own count therefore falls in the call
 * that announced its mail; a peer's is one heartbeat behind, which is the same window its row
 * already has.
 *
 * The read writes nothing, so a board can ask every second: `liveOnly` only filters what it draws,
 * and the prune stays with the next tool or command call.
 */

import { unaccountedMail } from "../../lib/session-mail.ts";
import type { RosterState } from "../../lib/session-roster.ts";
import type { WatchingState } from "./mail-watch.ts";
import type { BusStore } from "./store.ts";
import type { SessionRecord, SessionStatus } from "./types.ts";
import { MAX_LIMIT } from "./protocol.ts";

export interface StatusReaderOptions {
	store(): BusStore | undefined;
	/** This session's own record, live in memory rather than as the file holds it. */
	record(): SessionRecord | undefined;
	/** How one record reads at a moment: live, quiet, or gone. */
	stateOf(session: SessionRecord, at?: number): RosterState;
	now(): number;
	/** The watch as this session has it; whether it was armed is the reader's to decide. */
	watching(): WatchingState;
}

export interface StatusReader {
	/**
	 * The bus as it stands, this session's own record included.
	 *
	 * `liveOnly` drops a session whose heartbeat went stale, and the claims of one whose process is
	 * gone, without writing or deleting anything, so a board can read it every second. A gone
	 * session stays listed — a lead needs a face for the paths it still holds — but its claims are
	 * nobody's, so they are not drawn.
	 */
	read(me: { id: string; label: string; onBus: boolean }, liveOnly: boolean): Promise<SessionStatus>;
}

export function createStatusReader(options: StatusReaderOptions): StatusReader {
	const { store, record, stateOf, now, watching } = options;

	/** One row per record, each counting the mail that record has not been told about. */
	async function withUnread(
		rows: readonly SessionRecord[],
	): Promise<Array<SessionRecord & { unread: number; state: RosterState }>> {
		const at = now();
		const bus = store();
		const mine = record();
		return Promise.all(
			rows.map(async (row) => {
				const session = mine !== undefined && row.id === mine.id ? mine : row;
				return {
					...session,
					unread: (await bus?.unread(session.id, new Set(session.seenMail))) ?? 0,
					state: stateOf(session, at),
				};
			}),
		);
	}

	return {
		async read(me, liveOnly) {
			const bus = store();
			if (!bus) throw new Error("session bus is not started.");
			const records = await bus.sessions();
			const sessions = liveOnly
				? records.filter((session) => session.id === record()?.id || stateOf(session) !== "quiet")
				: records;
			const ours = new Set(sessions.filter((session) => stateOf(session) !== "gone").map((session) => session.id));
			const claims = (await bus.claims()).filter((claim) => !liveOnly || ours.has(claim.owner));
			// Mail is counted per record, so a pruned record's messages have no row to hang a number on.
			// The ids read here are the *record* ids rather than the live ones: a gone record's mail is
			// still its own, and only a record the bus no longer holds leaves mail unaccounted for.
			// The board's read is the count alone — it draws a number once a second and would otherwise
			// parse every one of these files on each repaint — while the status read names the mail.
			const unaccounted = await unaccountedMail(bus.dir, new Set(records.map((session) => session.id)), {
				bodies: !liveOnly,
			});
			// The one thing a names-only count cannot say: a file this build cannot parse sits inside
			// it until its TTL. Asking costs a page read, which is why only the model's read asks.
			const refused = liveOnly ? [] : (await bus.peek(me.id, { limit: MAX_LIMIT })).unreadable;
			const watch = watching();
			return {
				me: { id: me.id, label: me.label },
				onBus: me.onBus,
				sessions: await withUnread(sessions),
				...(unaccounted.count > 0 ? { unaccounted } : {}),
				...(refused.length === 0 ? {} : { unreadable: refused }),
				claims,
				...(watch.armed ? { watching: watch } : {}),
			};
		},
	};
}
