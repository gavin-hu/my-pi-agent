/**
 * The session bus's mail, read as data.
 *
 * `session-bus` owns the mail: it writes one file per recipient, consumes what a
 * reader asked for, and prunes what nobody read. Two other readers need the same
 * shape without the bus's code — the terminal can be in a session whose bus never
 * started, and the Team tab draws a repository's whole mail queue from the files —
 * so the message's fields, the order a queue is read in, and the guard that says a
 * file is a message live here once, and `session-bus` imports them back.
 *
 * Ordering is the one rule worth stating twice: a message's own `at` is the
 * sender's clock, and a peer whose clock runs ahead would sort to the back of the
 * queue it just joined. A file's mtime is when the message landed here, which every
 * session shares — so the queue is ordered by arrival, and the file name settles a
 * tie that one filesystem tick produced.
 *
 * **Waiting is a read, never a take.** {@link waitingMail} looks at every inbox and
 * removes nothing: an inbox is its owner's to consume, and a page that deleted what
 * it drew would eat the mail it was describing.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { asRecord } from "./json.ts";
import { INBOX_DIR_NAME } from "./session-roster.ts";

/** What a message is for: a note, a broadcast, a question, or work handed over. */
export type MessageKind = "message" | "event" | "ask" | "handoff";

/** The kinds this build reads, in one list, so a guard and a label table cannot disagree. */
export const MESSAGE_KINDS: readonly MessageKind[] = ["message", "event", "ask", "handoff"];

/** One message waiting in a recipient's inbox. */
export interface BusMessage {
	id: string;
	from: string;
	fromLabel: string;
	/** Recipient session id. */
	to: string;
	toLabel: string;
	kind: MessageKind;
	text: string;
	paths?: string[];
	at: number;
}

/** The most mail one page draws: past six, a queue is a backlog with its own card. */
export const WAITING_LIMIT = 6;

/** One page of the waiting queue, and how much of the queue is past it. */
export interface WaitingPage {
	/** Oldest first, at most the reader's limit. */
	messages: WaitingMail[];
	/** How many more the bus holds: a queue read to the bottom says so rather than looking quiet. */
	dropped: number;
}

/** One message waiting anywhere on the bus, as the page shows it. */
export interface WaitingMail {
	/** The sender's message id; one value per message, however many inboxes hold it. */
	id: string;
	from: string;
	fromLabel: string;
	kind: MessageKind;
	/**
	 * The labels it is waiting for, in the order the files were read.
	 *
	 * A broadcast is one file per recipient sharing one id, so this is where the two
	 * shapes meet: one name is a message, more than one is the fan-out it really was.
	 */
	to: string[];
	/** The text, whole: the page wraps it in a tooltip rather than a row. */
	text: string;
	/** When the first copy landed, by file mtime — the clock every session shares. */
	at: number;
}

const MESSAGE_SUFFIX = ".json";

/** Whether a parsed file is a message this build can read. */
export function isBusMessage(value: unknown): value is BusMessage {
	const entry = asRecord(value);
	if (!entry) return false;
	return (
		typeof entry.id === "string" &&
		typeof entry.from === "string" &&
		typeof entry.fromLabel === "string" &&
		typeof entry.to === "string" &&
		typeof entry.toLabel === "string" &&
		typeof entry.kind === "string" &&
		typeof entry.text === "string" &&
		typeof entry.at === "number" &&
		(entry.paths === undefined || (Array.isArray(entry.paths) && entry.paths.every((path) => typeof path === "string")))
	);
}

/** The message id a file name holds, which is the id a reader compares against. */
export const idOfFile = (name: string): string => name.slice(0, -MESSAGE_SUFFIX.length);

/** One message file, and the moment it landed in the inbox it sits in. */
export interface Arrival {
	/** The file's name, which is where its message id is read from. */
	name: string;
	/** The file's mtime: when the message became this inbox's, on the clock every session shares. */
	at: number;
}

/**
 * One inbox's message files, in the order they arrived, each with the arrival it was ordered by.
 *
 * A file published between the readdir and the stat is already read by the next poll, so
 * a stat that fails drops the file rather than failing the page. Two files that landed in
 * one filesystem tick tie on the mtime, and the name settles it so the page is stable.
 *
 * The stamp is handed out rather than kept, because a queue read needs it: `waitingMail` draws the
 * age of every message and used to stat each file a second time for the one number this pass had
 * already read.
 */
export async function listArrivals(dir: string): Promise<Arrival[]> {
	let names: string[];
	try {
		names = (await readdir(dir)).filter((name) => name.endsWith(MESSAGE_SUFFIX)).sort();
	} catch {
		return [];
	}
	const stamped = await Promise.all(
		names.map((name) =>
			stat(join(dir, name)).then(
				(info): Arrival | undefined => ({ name, at: info.mtimeMs }),
				() => undefined,
			),
		),
	);
	return stamped
		.filter((entry): entry is Arrival => entry !== undefined)
		.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

/**
 * One inbox's message files, in the order they arrived.
 *
 * The names alone, for the reader that opens each file anyway: `session-bus` reads the mail it is
 * about to consume, so the arrival `listArrivals` hands out would be paid for and thrown away.
 */
export async function listMessages(dir: string): Promise<string[]> {
	return (await listArrivals(dir)).map((arrival) => arrival.name);
}

/** The inbox directories under one repository's bus, hashed as the bus names them. */
async function inboxDirs(busDir: string): Promise<string[]> {
	try {
		const entries = await readdir(join(busDir, INBOX_DIR_NAME), { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
			.map((name) => join(busDir, INBOX_DIR_NAME, name));
	} catch {
		// No bus here, or no mail ever addressed: both are "nothing is waiting".
		return [];
	}
}

/**
 * Every message waiting on one repository's bus, oldest first, at most `limit` of them —
 * with a count of what the cap left out, so a busy queue cannot read like a quiet one.
 *
 * A broadcast lands as one file per recipient, so the files that share an id are one
 * message waiting on several people and are drawn once, with every name it waits for.
 * The age is the first copy's: the moment the message became somebody's to read.
 *
 * A file that does not parse is skipped, not thrown: it stays where it is for the TTL,
 * and one unreadable message does not hide the queue behind it.
 */
export async function waitingMail(busDir: string, limit = WAITING_LIMIT): Promise<WaitingPage> {
	const byId = new Map<string, WaitingMail>();
	for (const dir of await inboxDirs(busDir)) {
		for (const { name, at: landed } of await listArrivals(dir)) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(await readFile(join(dir, name), "utf-8"));
			} catch {
				continue;
			}
			if (!isBusMessage(parsed)) continue;
			const seen = byId.get(parsed.id);
			if (seen === undefined) {
				byId.set(parsed.id, {
					id: parsed.id,
					from: parsed.from,
					fromLabel: parsed.fromLabel,
					kind: parsed.kind,
					to: [parsed.toLabel],
					text: parsed.text,
					at: landed,
				});
				continue;
			}
			// The same message in a second inbox: one row, one more recipient, and the
			// earlier of the two arrivals, which is when it first became anyone's.
			if (!seen.to.includes(parsed.toLabel)) seen.to.push(parsed.toLabel);
			seen.at = Math.min(seen.at, landed);
		}
	}
	// Oldest first, then the cap: the front of a queue is the item waiting longest. What it
	// leaves out is counted, so a page that draws six rows can still say the queue is deeper.
	const all = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
	const messages = all.slice(0, Math.max(0, limit));
	return { messages, dropped: all.length - messages.length };
}

/**
 * How many unread messages on one repository's bus no session record accounts for.
 *
 * A message names its recipient by session id, and an inbox belongs to that id alone — but the id
 * outlives the *record* that lists it, and the roster counts mail per record. So once a record is
 * pruned its mail keeps both its reader's absence and its own silence: no row, no count, and no
 * way to consume it, until the message TTL ends it. A session resumed on that id can still read
 * it, which is why it is not deleted the moment the record goes.
 *
 * The recipient is read off the message rather than out of the inbox's name: the name is that id
 * as the writer hashed it, and a lib module cannot ask the store how. A file this build cannot
 * parse is skipped, the way the queue above skips it.
 */
export async function unattributedMail(busDir: string, known: ReadonlySet<string>): Promise<number> {
	let count = 0;
	for (const dir of await inboxDirs(busDir)) {
		for (const { name } of await listArrivals(dir)) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(await readFile(join(dir, name), "utf-8"));
			} catch {
				continue;
			}
			if (!isBusMessage(parsed)) continue;
			if (!known.has(parsed.to)) count += 1;
		}
	}
	return count;
}
