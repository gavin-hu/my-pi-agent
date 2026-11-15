/**
 * The read cursor: the mail this session has been told about.
 *
 * A peer's unread count is the mail a session has *not* been told about, and the one way that
 * number falls without deleting a body is a record of what was already announced. The record
 * carries it (`seenMail`), because a record already has a lifetime, a writer and a pruner — so a
 * cursor needs no file of its own. This module is that field's only owner: it adopts the cursor a
 * record left behind, writes what the watch announced, and trims what the inbox no longer holds.
 *
 * Writes go through one chain, because two writes to one JSON file can land in either order and
 * the cursor a peer reads is whichever landed last; and a write queued before `stop` finds the
 * record gone rather than resurrecting it.
 */

import type { BusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

export interface MailCursorOptions {
	store(): BusStore | undefined;
	record(): SessionRecord | undefined;
}

export interface MailCursor {
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
	/**
	 * Drop the ids whose mail the inbox no longer holds, without writing.
	 *
	 * The heartbeat calls this before its own write of the record, so a cursor trimmed here costs
	 * no second write — and a session that reads mail without listening cannot accumulate an id
	 * per message ever read.
	 */
	trim(): Promise<void>;
}

/** Whether two id lists name the same set, so a write with nothing new is not a write. */
function sameIds(left: readonly string[] | undefined, right: readonly string[]): boolean {
	const current = left ?? [];
	return current.length === right.length && right.every((id) => current.includes(id));
}

export function createMailCursor(options: MailCursorOptions): MailCursor {
	const { store, record } = options;
	let writing: Promise<void> = Promise.resolve();

	/** Queue one write: two cannot land out of order, and one after a release writes nothing. */
	function persist(target: SessionRecord): void {
		writing = writing
			.then(async () => {
				const bus = store();
				if (bus === undefined || record() !== target) return;
				await bus.writeSession(target);
			})
			.catch(() => {});
	}

	/** Set the field, and write only when it changed. */
	function set(target: SessionRecord, ids: readonly string[]): void {
		if (sameIds(target.seenMail, ids)) return;
		target.seenMail = ids.length === 0 ? undefined : [...ids];
		persist(target);
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
	};
}
