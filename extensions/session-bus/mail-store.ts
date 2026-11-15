/**
 * The bus's mail, as files: paging an inbox, counting it, consuming it, dropping what no record
 * holds, and ending what the message TTL has taken.
 *
 * Split out of `store.ts` when that module reached the line bar, and reached through a deferred
 * import rather than a static one — that entry has exactly the static module budget it is allowed,
 * and one more evaluation fails `test/dependencies.test.ts`. The same fact shapes this file: nothing
 * here imports a module of this extension, because the file layer it needs arrives as {@link
 * MailStoreDeps}, so it can only ever be loaded by the store that already holds one.
 *
 * Pure I/O over one directory, as the store is: no state of its own, and no clock but the one a
 * caller passes in.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type BusMessage, idOfFile, isBusMessage, listMessages } from "../../lib/session-mail.ts";
import { INBOX_DIR_NAME, storedName } from "../../lib/session-roster.ts";
import type { BusStore } from "./store.ts";
import type { KeptMail, SessionRecord } from "./types.ts";

/**
 * What the mail family needs of the store's file layer, given rather than imported.
 *
 * Six functions and the directory, because the alternative is importing `store.ts` — a static edge
 * back into the module that loads this one, which costs the budget row and makes a cycle.
 */
export interface MailStoreDeps {
	/** The repository bus directory, e.g. `<agent-dir>/session-bus/<key>`. */
	dir: string;
	readSessions(): Promise<SessionRecord[]>;
	readTyped<T>(path: string, guard: (value: unknown) => value is T): T | undefined;
	listFiles(dir: string): Promise<string[]>;
	dropIfEmpty(dir: string): Promise<void>;
	dropStaleTemps(dir: string): Promise<void>;
}

/** The half of the store that owns the inboxes. */
export type MailStore = Pick<BusStore, "peek" | "inbox" | "unread" | "dropUnaccounted" | "pruneMail">;

/** Create the mail family over one repository's bus directory. */
export function createMailStore(deps: MailStoreDeps): MailStore {
	const { readSessions, readTyped, listFiles, dropIfEmpty, dropStaleTemps } = deps;
	const inboxRoot = join(deps.dir, INBOX_DIR_NAME);
	const inboxDir = (id: string): string => join(inboxRoot, storedName(id));

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
			const message = readTyped(path, isBusMessage);
			if (!message) {
				unreadable.push(name);
				continue;
			}
			messages.push(message);
			if (remove) await rm(path, { force: true });
		}
		// In the order it walked: the page a read shows is the front it deleted, and a message's
		// own `at` cannot reorder it after the fact.
		return { messages, unreadable };
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

		async unread(id, told) {
			return (await listFiles(inboxDir(id))).filter((name) => !told?.has(idOfFile(name))).length;
		},

		/**
		 * Remove the mail `ids` name from the inboxes no record holds.
		 *
		 * Attribution is the store's own: an inbox is filed under the hash of its recipient's id, so
		 * hashing each record's id is the whole answer to "does anybody hold this mail" — no field a
		 * message could lie about, and no need to invert the hash of a directory's name. It is read
		 * here, at the delete, rather than by the caller that listed the mail: a session that resumed
		 * in between holds its mail again, and a listing is stale the moment its person reads it.
		 *
		 * An id a held inbox carries is refused and handed back with its holder's label. That is the
		 * one guard this door needs, because a mistaken id would otherwise destroy mail its session
		 * can still read; nothing else on the bus is this destructive and irreversible.
		 */
		async dropUnaccounted(ids) {
			const wanted = new Set(ids);
			const dropped: string[] = [];
			const kept: KeptMail[] = [];
			if (wanted.size === 0) return { dropped, kept };
			const holders = new Map<string, string>();
			for (const session of await readSessions()) holders.set(storedName(session.id), session.label);
			for (const name of await readdir(inboxRoot).catch(() => [] as string[])) {
				const directory = join(inboxRoot, name);
				const holder = holders.get(name);
				let removed = false;
				for (const file of await listFiles(directory)) {
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

		async pruneMail({ now: at, messageTtlMs }) {
			for (const name of await readdir(inboxRoot).catch(() => [] as string[])) {
				const directory = join(inboxRoot, name);
				for (const file of await listFiles(directory)) {
					const path = join(directory, file);
					const message = readTyped(path, isBusMessage);
					if (message) {
						if (at - message.at > messageTtlMs) await rm(path, { force: true });
						continue;
					}
					// A file with no readable `at` has no clock of its own, so its mtime is the one it
					// gets: the TTL still ends mail this build cannot read instead of keeping it forever.
					const written = await stat(path).then(
						(info) => info.mtimeMs,
						() => at,
					);
					if (at - written > messageTtlMs) await rm(path, { force: true });
				}
				await dropStaleTemps(directory);
				await dropIfEmpty(directory);
			}
		},
	};
}
