/**
 * The bus's mail, as files: paging an inbox, consuming it, dropping what no record holds, and
 * ending what the message TTL has taken. Counting is not here — `lib/session-mail.ts`'s ledger is
 * the one reader of "written and not told", so a number and the queue it describes agree.
 *
 * Split out of `store.ts` when that module reached the line bar, and reached through a deferred
 * import rather than a static one — that entry has exactly the static module budget it is allowed,
 * and one more evaluation fails `test/dependencies.test.ts`. Nothing here imports a module of this
 * extension: the layout and the writes come from `lib/session-files.ts`, which the entry loads
 * anyway, so this file is loaded only when the first read needs it.
 *
 * Pure I/O over one directory, as the store is: no state of its own, and no clock but the one a
 * caller passes in.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeLine } from "../../lib/format.ts";
import {
	busPaths,
	dropIfEmpty,
	dropStaleTemps,
	JSON_SUFFIX,
	listJson,
	readJsonAs,
	storedName,
} from "../../lib/session-files.ts";
import { type BusMessage, isBusMessage, listMessages } from "../../lib/session-mail.ts";
import type { BusStore } from "./store.ts";
import type { CleanResult, DropResult, KeptMail } from "./types.ts";

/**
 * The message id a file name holds.
 *
 * It lives here, beside its only caller, rather than with the readers in `lib/session-mail.ts`
 * where it started: this is the one use of the bus's suffix that is synchronous, so a static
 * import of `lib/session-files.ts` would keep the whole file layer in the registration graph of
 * every entry that loads the mail readers — which is the edge that module's deferral removes.
 * Do not move it back for tidiness: the module it would return to cannot defer the constant.
 */
export const idOfFile = (name: string): string => name.slice(0, -JSON_SUFFIX.length);

/** The half of the store that owns the inboxes. */
export type MailStore = Pick<BusStore, "peek" | "inbox"> & {
	/**
	 * End the mail past its TTL, in this session's inbox and in the ones no record holds — with the
	 * held inboxes given, because the records are the store's to read and this module never loads it.
	 */
	pruneMail(input: { now: number; messageTtlMs: number; own: string }, held: ReadonlySet<string>): Promise<void>;
	/**
	 * Clear this session's own inbox of the mail older than `olderThanMs`.
	 *
	 * One inbox, never a peer's: the door a person opens for mail that reached them and went unread.
	 */
	cleanInbox(input: { now: number; olderThanMs: number; own: string }): Promise<CleanResult>;
	/**
	 * Remove mail `ids` name from inboxes no record holds — with the holders given, because the
	 * records are the store's to read and this module never loads `store.ts`.
	 */
	dropUnaccounted(ids: readonly string[], held: ReadonlyMap<string, string>): Promise<DropResult>;
};

/** Create the mail family over one repository's bus directory. */
export function createMailStore(dir: string): MailStore {
	const paths = busPaths(dir);
	const inboxRoot = paths.inbox;
	const inboxDir = paths.inboxOf;

	/**
	 * Up to `limit` messages from the front of a recipient's inbox, oldest first.
	 *
	 * The front is the queue, not a detail: consuming starts there so a limit never starves,
	 * and so does a read, because the caller names the ids it already has. The order is when
	 * the mail arrived, not the clock the sender stamped it with, so no peer's clock decides
	 * where its mail sits. A file name holds the id, so a skip costs no read — which is what
	 * lets a watch page a backlog one poll at a time without reading the same file twice.
	 *
	 * Only the consuming read deletes, and it deletes only what it read. A file this build
	 * cannot validate is named back to the caller instead: it may be mail a newer build can
	 * read — a renamed field, a stricter guard — and destroying it on the way past is how one
	 * build's parser silently eats another's message. The message TTL ends it through its
	 * mtime, so nothing it cannot read accumulates.
	 *
	 * The walk stops at `limit` messages, so the names it reports are the ones it reached: a
	 * refusal behind a full page is named once the mail in front of it is consumed. Reading
	 * every name to find one would cost the whole backlog on every poll, which is the read this
	 * store exists to page. A limit of zero walks nothing, in either read: the page is decided
	 * before the front is read, not after it.
	 */
	async function readMessages(
		directory: string,
		names: readonly string[],
		options: { limit: number; known?: ReadonlySet<string>; remove: boolean },
	): Promise<{ messages: BusMessage[]; unreadable: string[] }> {
		const { limit, known, remove } = options;
		const messages: BusMessage[] = [];
		const unreadable: string[] = [];
		for (const name of names) {
			if (messages.length >= limit) break;
			if (known?.has(idOfFile(name))) continue;
			const path = join(directory, name);
			const message = readJsonAs(path, isBusMessage);
			if (!message) {
				// Flattened at the read: the name is a peer's file, and the sentence that prints it
				// is the one body the page splices, so it may not sanitise for itself.
				unreadable.push(sanitizeLine(name));
				continue;
			}
			messages.push(message);
			if (remove) await rm(path, { force: true });
		}
		// In the order it walked: the page a read shows is the front it deleted, and a message's
		// own `at` cannot reorder it after the fact.
		return { messages, unreadable };
	}

	/**
	 * End the mail in one inbox that is older than `cutoffMs`, and answer how many files went.
	 *
	 * One body for both doors that remove mail by age: the heartbeat's TTL sweep, over this session's
	 * inbox and every inbox no record holds, and `clean`, which takes one inbox and a cutoff a person
	 * chose. A file with no readable `at` has no clock of its own, so its mtime is the one it gets:
	 * the cutoff still ends mail this build cannot read instead of keeping it forever.
	 */
	async function sweepInbox(directory: string, at: number, cutoffMs: number): Promise<number> {
		let removed = 0;
		for (const file of await listJson(directory)) {
			const path = join(directory, file);
			const message = readJsonAs(path, isBusMessage);
			const written = message ? message.at : await stat(path).then(
				(info) => info.mtimeMs,
				() => at,
			);
			if (at - written <= cutoffMs) continue;
			await rm(path, { force: true });
			removed++;
		}
		await dropStaleTemps(directory);
		await dropIfEmpty(directory);
		return removed;
	}

	return {
		async peek(id, options) {
			const directory = inboxDir(id);
			const names = await listMessages(directory);
			const { messages, unreadable } = await readMessages(directory, names, { ...options, remove: false });
			return { mail: messages, unread: new Set(names.map(idOfFile)), unreadable };
		},

		async inbox(id, limit) {
			const directory = inboxDir(id);
			return readMessages(directory, await listMessages(directory), { limit, remove: true });
		},

		/**
		 * Remove the mail `ids` name from the inboxes no record holds.
		 *
		 * Attribution is the store's own: an inbox is filed under the hash of its recipient's id, so
		 * hashing each record's id is the whole answer to "does anybody hold this mail" — no field a
		 * message could lie about, and no need to invert the hash of a directory's name. It is read
		 * by the caller at the delete rather than by the one that listed the mail: a session that
		 * resumed in between holds its mail again, and a listing is stale the moment its person reads
		 * it.
		 *
		 * An id a held inbox carries is refused and handed back with its holder's label. That is the
		 * one guard this door needs, because a mistaken id would otherwise destroy mail its session
		 * can still read; nothing else on the bus is this destructive and irreversible.
		 */
		async dropUnaccounted(ids: readonly string[], held: ReadonlyMap<string, string>): Promise<DropResult> {
			const wanted = new Set(ids);
			const dropped: string[] = [];
			const kept: KeptMail[] = [];
			if (wanted.size === 0) return { dropped, kept };
			const holders = new Map([...held].map(([id, label]) => [storedName(id), label]));
			for (const name of await readdir(inboxRoot).catch(() => [] as string[])) {
				const directory = join(inboxRoot, name);
				const holder = holders.get(name);
				let removed = false;
				for (const file of await listJson(directory)) {
					const id = idOfFile(file);
					if (!wanted.has(id)) continue;
					if (holder !== undefined) {
						if (!kept.some((entry) => entry.id === id)) kept.push({ id, reason: "held", holder });
						continue;
					}
					await rm(join(directory, file), { force: true });
					removed = true;
					if (!dropped.includes(id)) dropped.push(id);
				}
				// An inbox the drop emptied is gone, rather than kept as one empty directory per dead id.
				if (removed) await dropIfEmpty(directory);
			}
			for (const id of wanted) {
				if (!dropped.includes(id) && !kept.some((entry) => entry.id === id)) kept.push({ id, reason: "missing" });
			}
			return { dropped: dropped.sort(), kept: kept.sort((a, b) => a.id.localeCompare(b.id)) };
		},

		async pruneMail(
			{ now: at, messageTtlMs, own }: { now: number; messageTtlMs: number; own: string },
			held: ReadonlySet<string>,
		) {
			const mine = storedName(own);
			for (const name of await readdir(inboxRoot).catch(() => [] as string[])) {
				// This session's inbox, and every inbox no record holds: a live peer's is its own to
				// sweep, which is the ledger's "unheld" rule applied to the clock.
				if (name !== mine && held.has(name)) continue;
				await sweepInbox(join(inboxRoot, name), at, messageTtlMs);
			}
		},

		/**
		 * Clear this session's own inbox of the mail older than `olderThanMs`.
		 *
		 * The count left is read from the files that stayed, so the sentence a person reads is the
		 * inbox's next state rather than an echo of what the sweep meant to do.
		 */
		async cleanInbox({ now: at, olderThanMs, own }: { now: number; olderThanMs: number; own: string }) {
			const directory = inboxDir(own);
			const removed = await sweepInbox(directory, at, olderThanMs);
			const left = (await listJson(directory).catch(() => [] as string[])).length;
			return { removed, left };
		},
	};
}
