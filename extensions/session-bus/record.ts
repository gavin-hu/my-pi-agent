/**
 * The session's record: one file, one writer.
 *
 * A record is one JSON document that the heartbeat, both turn edges, a join, a rename, a label
 * settle and the mail cursor all change. Each of them used to write it itself, and
 * `writeJsonAtomic` orders files rather than writes: a writer that serialized an older snapshot
 * could rename after a newer one and put a stale `seenMail`, `turnAt` or `lastSeen` back. This
 * module is the record's only writer, so every change follows one chain and the flush reads the
 * record when it runs — a change is never overwritten by a snapshot of the state before it.
 *
 * The two fields it owns were modules of their own: the cursor (the mail this session has been
 * told about) and the turn (whether it is inside a run). Neither had a reason to write the file,
 * and one chain is the whole of both.
 *
 * `close()` is the other half of the same rule: the row is removed on the way out, and a write
 * still queued at that moment would re-create it — an atomic write even makes the directory. So
 * both doors that end a membership drain first, and `open()` is what lets a `leave` followed by a
 * join write the same id again.
 */

import type { BusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

export interface RecordWriterOptions {
	store(): BusStore | undefined;
	record(): SessionRecord | undefined;
	/** Whether the record is the bus's yet: a turn before a join stamps nobody. */
	joined(): boolean;
}

/** The record as its one writer: the cursor's fields, the turn, and the one write. */
export interface RecordWriter {
	/** The told ids, as the record holds them — what the watch asks before it queues anything. */
	ids(): readonly string[];
	/**
	 * Adopt the cursor the record on disk already carries.
	 *
	 * A record outlives the process that wrote it, and a session resumed on that id is the same
	 * session: its transcript still holds the notice, so adopting the cursor is what keeps its
	 * old mail out of the count instead of announcing it a second time.
	 */
	adopt(): Promise<void>;
	/** Record what an announcement carried, and write it for the peer that counts. */
	told(ids: readonly string[]): void;
	/** Drop the ids whose mail the inbox no longer holds, without writing: the caller saves. */
	trim(): Promise<void>;
	/**
	 * Write the record as it stands when the write runs.
	 *
	 * The answer is the whole chain, so a caller that awaits it has its own write on disk — the
	 * join and the prune both need the row before they read the bus again.
	 */
	save(): Promise<void>;
	/** A run began, or settled: the turn's two edges, one field. */
	writeTurn(at: number | undefined): Promise<void>;
	/** Stop accepting writes and drain what is queued, before the row can be removed. */
	close(): Promise<void>;
	/** Accept writes again: a `leave` followed by a join serves the same id. */
	open(): void;
}

/** Whether two id lists name the same set, so a write with nothing new is not a write. */
function sameIds(left: readonly string[] | undefined, right: readonly string[]): boolean {
	const current = left ?? [];
	return current.length === right.length && right.every((id) => current.includes(id));
}

export function createRecordWriter(options: RecordWriterOptions): RecordWriter {
	const { store, record, joined } = options;
	let writing: Promise<void> = Promise.resolve();
	let accepting = true;

	/**
	 * Queue one write of the record as it stands when the write runs.
	 *
	 * Reading it late is the point: a mutation made after this call still lands, because the
	 * flush has serialized nothing yet. Two writes cannot land out of order for the same reason —
	 * the second is not issued until the first has finished. Nothing ever rejects: a write that
	 * fails costs the frame it describes, never the run or the membership it was written for.
	 */
	function flush(): Promise<void> {
		if (!accepting) return Promise.resolve();
		writing = writing
			.then(async () => {
				const bus = store();
				const target = record();
				if (bus === undefined || target === undefined) return;
				await bus.writeSession(target);
			})
			.catch(() => {});
		return writing;
	}

	/** Set the field, and write only when it changed. */
	function set(target: SessionRecord, ids: readonly string[]): void {
		if (sameIds(target.seenMail, ids)) return;
		target.seenMail = ids.length === 0 ? undefined : [...ids];
		void flush();
	}

	return {
		ids: () => record()?.seenMail ?? [],

		async adopt() {
			const target = record();
			const bus = store();
			if (target === undefined || bus === undefined) return;
			const survived = await bus.session(target.id);
			if (survived?.seenMail !== undefined) target.seenMail = [...survived.seenMail];
		},

		told(ids) {
			const target = record();
			if (target !== undefined) set(target, ids);
		},

		async trim() {
			const target = record();
			const bus = store();
			if (target === undefined || bus === undefined) return;
			const { unread } = await bus.peek(target.id, { limit: 0 });
			const kept = (target.seenMail ?? []).filter((id) => unread.has(id));
			if (kept.length === (target.seenMail ?? []).length) return;
			target.seenMail = kept.length === 0 ? undefined : kept;
		},

		save: flush,

		async writeTurn(at) {
			// A session that never joined stamps nobody: the same gate the turn's own write had,
			// kept because this is the field's only door now.
			if (!joined()) return;
			const target = record();
			if (target === undefined || store() === undefined) return;
			if (at === undefined) delete target.turnAt;
			else target.turnAt = at;
			await flush();
		},

		async close() {
			accepting = false;
			await writing;
		},

		open() {
			accepting = true;
		},
	};
}
