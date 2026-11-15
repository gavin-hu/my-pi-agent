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
 * **Waiting is a read, never a take.** {@link readMailLedger} looks at every inbox and
 * removes nothing: an inbox is its owner's to consume, and a page that deleted what
 * it drew would eat the mail it was describing.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { asRecord } from "./json.ts";
import { busPaths, JSON_SUFFIX, listJson, readJsonAs, storedName } from "./session-files.ts";

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
	/**
	 * The sender's name for this message, when it gave one.
	 *
	 * A key is how a resend folds into the copy still waiting instead of arriving as a second one;
	 * it is not an identity, so every delivery keeps its own id — a reused id would be a file the
	 * recipient's cursor already names, and a message nobody is ever told about.
	 */
	key?: string;
	paths?: string[];
	/**
	 * The id of the message this one answers, when it answers one — an ask's id in the workflow's use.
	 *
	 * Not the same as `key`: a key folds a resend, and this is a link a reader can follow. The bus
	 * keeps it opaque; `session` prints it as `re: <id>` and a caller decides what it means.
	 */
	replyTo?: string;
	/**
	 * What this message is about, as the sender's own word — a card id, in the workflow's use.
	 *
	 * Opaque to the bus for the same reason `replyTo` is: the transport carries a reference, and
	 * the domain that made it is the one that reads it.
	 */
	about?: string;
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

/**
 * One session a message is waiting for.
 *
 * The id is the identity: an inbox belongs to it, and `presenceOf` answers by it alone, so a name a
 * later session took cannot lend this row that session's liveness. The label is the sentence the row
 * prints, recorded when the message was sent.
 */
export interface WaitingRecipient {
	/** The session this copy was addressed to, which is also whose inbox it sits in. */
	id: string;
	/** The name the sender addressed it by, as display text. */
	label: string;
}

/** One message waiting anywhere on the bus, as the page shows it. */
export interface WaitingMail {
	/** The sender's message id; one value per message, however many inboxes hold it. */
	id: string;
	from: string;
	fromLabel: string;
	kind: MessageKind;
	/**
	 * The recipients it is waiting for, in the order the files were read.
	 *
	 * A broadcast is one file per recipient sharing one id, so this is where the two
	 * shapes meet: one recipient is a message, more than one is the fan-out it really was.
	 * Folded by id rather than by name, so two sessions that share a label stay two, and one
	 * session's copy in two inboxes stays one.
	 */
	to: WaitingRecipient[];
	/** The text, whole: the page wraps it in a tooltip rather than a row. */
	text: string;
	/** When the first copy landed, by file mtime — the clock every session shares. */
	at: number;
}

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
		(entry.key === undefined || typeof entry.key === "string") &&
		(entry.replyTo === undefined || typeof entry.replyTo === "string") &&
		(entry.about === undefined || typeof entry.about === "string") &&
		(entry.paths === undefined || (Array.isArray(entry.paths) && entry.paths.every((path) => typeof path === "string")))
	);
}

/** The message id a file name holds, which is the id a reader compares against. */
export const idOfFile = (name: string): string => name.slice(0, -JSON_SUFFIX.length);

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
 * The stamp is handed out rather than kept, because a queue read needs it: the ledger draws the
 * age of every message and used to stat each file a second time for the one number this pass had
 * already read.
 */
export async function listArrivals(dir: string): Promise<Arrival[]> {
	const names = await listJson(dir);
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

/** Whether two messages are the same send: everything but the delivery's own id, recipient and time. */
function sameSend(a: unknown, b: BusMessage): boolean {
	if (!isBusMessage(a) || a.key === undefined) return false;
	return (
		a.key === b.key &&
		a.from === b.from &&
		a.kind === b.kind &&
		a.text === b.text &&
		(a.paths ?? []).join("\u0000") === (b.paths ?? []).join("\u0000")
	);
}

/**
 * Whether one inbox already holds this message: the same body, from the same sender, under the
 * same key.
 *
 * A send gets a fresh id every time, so a duplicate is found by what the message says rather than
 * by its name. That is what keeps a keyed resend folding into the copy still waiting while a
 * resend after that copy was consumed is a new message its recipient is told about — the same id
 * would be a file the recipient's cursor already names, and so mail nobody hears of.
 *
 * The delivery is not part of the comparison: `at` differs on every send, the recipient is the
 * inbox this asks, and `fromLabel` may have been renamed since — none of them changes the message.
 */
export async function holdsMessage(dir: string, message: BusMessage): Promise<boolean> {
	if (message.key === undefined) return false;
	for (const { name } of await listArrivals(dir)) {
		if (sameSend(readJsonAs(join(dir, name), isBusMessage), message)) return true;
	}
	return false;
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
		const entries = await readdir(busPaths(busDir).inbox, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
			.map((name) => join(busPaths(busDir).inbox, name));
	} catch {
		// No bus here, or no mail ever addressed: both are "nothing is waiting".
		return [];
	}
}

/** What the ledger needs of one bus record: who it is, what it is called, and what it was told. */
export interface MailRecord {
	id: string;
	label: string;
	/** Message ids its cursor names: the mail it already heard of. */
	told: readonly string[];
}

/** One inbox, as one pass over the bus found it. */
export interface InboxMail {
	/** The session it belongs to: the record's id when one holds it, else the id its mail names. */
	id: string;
	/** The record's label, or the one the mail was addressed by when no record holds it. */
	label: string;
	/** Whether a record holds this inbox: mail in one no record names is unaccounted for. */
	held: boolean;
	/** Every message file in it, in arrival order, with the arrival it was ordered by. */
	mail: Array<{ message: BusMessage; at: number }>;
	/** Files this build cannot read: counted in `untold`, and named rather than drawn. */
	unreadable: string[];
	/** The message ids its owner has been told about. */
	told: ReadonlySet<string>;
	/** Files written that its owner has not been told about: the number every surface draws. */
	untold: number;
}

/** One repository's bus, read once. */
export interface MailLedger {
	/** Every inbox the bus holds, in the order their directories sort. */
	inboxes: InboxMail[];
	/** Every message waiting anywhere, folded by id, oldest first, uncapped. */
	messages: WaitingMail[];
	/** What the inboxes a record holds add up to: the one number a row, a chip or a count draws. */
	untold: number;
}

/**
 * One repository's bus, read once: every inbox, every message, and the number each owner is owed.
 *
 * The records are the caller's, not read here, because the two questions a page asks — who is on
 * the bus, and how much mail is waiting — come from the same files, and a page that read the
 * records twice would pay for the second read on every frame. A record's `told` is what makes the
 * count "written and not told": a file whose id the cursor names is mail its owner already heard
 * of, so it is neither drawn as waiting nor counted.
 *
 * The count is what the record can *read*: a file this build cannot parse is named in
 * `unreadable` and left out of the number, because a row that counted it would promise its reader
 * mail no line explains and no read clears. The file itself stays where it is until its TTL — it
 * may be mail a newer build can read.
 *
 * Nothing is removed: an inbox is its owner's to consume, and a page that deleted what it drew
 * would eat the mail it was describing.
 */
export async function readMailLedger(busDir: string, records: readonly MailRecord[]): Promise<MailLedger> {
	const held = new Map(records.map((record) => [storedName(record.id), record]));
	const byId = new Map<string, WaitingMail>();
	const inboxes: InboxMail[] = [];
	let untold = 0;
	for (const dir of await inboxDirs(busDir)) {
		const record = held.get(basename(dir));
		const inbox: InboxMail = {
			id: record?.id ?? basename(dir),
			label: record?.label ?? basename(dir),
			held: record !== undefined,
			mail: [],
			unreadable: [],
			told: new Set(record?.told ?? []),
			untold: 0,
		};
		for (const { name, at } of await listArrivals(dir)) {
			const message = readJsonAs(join(dir, name), isBusMessage);
			if (message === undefined) {
				inbox.unreadable.push(name);
				continue;
			}
			// The inbox is the identity, not the file: a message's own `to` is what the sender
			// addressed, while an inbox belongs to one session id and its record names it. An inbox
			// no record holds still says whose mail it is through the files inside it, which is the
			// id a resumed session can adopt.
			const recipient = { id: record?.id ?? message.to, label: record?.label ?? message.toLabel };
			if (record === undefined) {
				inbox.id = recipient.id;
				inbox.label = recipient.label;
			}
			if (!inbox.told.has(message.id)) inbox.untold += 1;
			inbox.mail.push({ message, at });
			const seen = byId.get(message.id);
			if (seen === undefined) {
				byId.set(message.id, {
					id: message.id,
					from: message.from,
					fromLabel: message.fromLabel,
					kind: message.kind,
					to: [recipient],
					text: message.text,
					at,
				});
				continue;
			}
			// The same message in a second inbox: one row, one more recipient, and the
			// earlier of the two arrivals, which is when it first became anyone's. The id
			// decides, so a name a second session took is a second line and not the same one.
			if (!seen.to.some((each) => each.id === recipient.id)) seen.to.push(recipient);
			seen.at = Math.min(seen.at, at);
		}
		if (inbox.held) untold += inbox.untold;
		inboxes.push(inbox);
	}
	// Oldest first: the front of a queue is the item waiting longest, and the id settles a tie
	// that one filesystem tick produced.
	const messages = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
	return { inboxes, messages, untold };
}

/** How much mail one session's inbox holds that its record has not been told about. */
export function untoldIn(ledger: MailLedger, id: string): number {
	return ledger.inboxes.find((inbox) => inbox.id === id)?.untold ?? 0;
}

/**
 * One page of a ledger's queue: the oldest `limit` of it, and how many that left behind.
 *
 * A broadcast lands as one file per recipient, so the files that share an id are one
 * message waiting on several people and are drawn once, with every recipient it waits for —
 * folded by session id, because the name it was addressed by may have been taken since.
 * The age is the first copy's: the moment the message became somebody's to read.
 */
export function pageOf(ledger: MailLedger, limit = WAITING_LIMIT): WaitingPage {
	const messages = ledger.messages.slice(0, Math.max(0, limit));
	return { messages, dropped: ledger.messages.length - messages.length };
}

/**
 * One message file whose recipient no session record holds, and when it landed.
 *
 * The arrival is the file's mtime rather than the sender's `at`, for the reason the queue's order
 * is: the sender's clock is theirs, while the file landed here on the clock every session shares.
 * `message.to` is the id this mail was addressed to, and the inbox it sits in is named after that
 * id, which is the record the bus no longer holds.
 */
export interface UnaccountedMessage {
	message: BusMessage;
	/** When the file landed, by mtime. */
	at: number;
}

/**
 * One read of the mail no record holds: the messages a reader draws, and how many files there are.
 *
 * `count` is every message file in those inboxes, whether or not this build can read it: a file
 * that does not parse counts here and is not among `messages`, so a page's number can exceed what
 * it names. That is the honest number for the door that clears it — `/sessions drop` addresses a
 * file by the id in its name — and it is the number a poll can answer without opening anything.
 */
export interface UnaccountedPage {
	/** Oldest first; empty when the caller asked for the count alone. */
	messages: UnaccountedMessage[];
	/** Every message file in the inboxes no record holds. */
	count: number;
}

/**
 * The mail on one repository's bus that no session record accounts for, oldest first.
 *
 * A message names its recipient by session id, and an inbox belongs to that id alone — but the id
 * outlives the *record* that lists it, and the roster counts mail per record. So once a record is
 * pruned its mail keeps both its reader's absence and its own silence: no row, no count, and no way
 * to consume it, until the message TTL ends it. A session resumed on that id can still read it,
 * which is why it is not deleted the moment the record goes.
 *
 * An inbox is named after the session it serves, and the bus files both with one rule
 * (`storedName`), so the answer is the inboxes no record names: those files are read, and a
 * bus where every record is still on disk costs one directory read. A file this build
 * cannot parse is skipped, the way the queue above skips it.
 *
 * Its `count` is every file in those inboxes, readable or not, while `messages` names only what
 * this build can read — the door that clears them addresses a file by the id in its name.
 */
export async function unaccountedMail(busDir: string, held: ReadonlySet<string>): Promise<UnaccountedPage> {
	// The held ids, as the records the ledger needs: a caller that knows only the ids asks about
	// mail nobody holds, so what those records were told about is not part of the question.
	const records = [...held].map((id): MailRecord => ({ id, label: id, told: [] }));
	return unaccountedOf(await readMailLedger(busDir, records));
}

/** The unaccounted page a ledger already answers: a projection, so no reader walks the bus twice. */
export function unaccountedOf(ledger: MailLedger): UnaccountedPage {
	const unheld = ledger.inboxes.filter((inbox) => !inbox.held);
	// Every file there, readable or not: the door that clears them addresses a file by the id in
	// its name, so a count that dropped the ones it cannot read would understate what it ends.
	const count = unheld.reduce((total, inbox) => total + inbox.mail.length + inbox.unreadable.length, 0);
	const found = unheld.flatMap((inbox) => inbox.mail.map(({ message, at }) => ({ message, at })));
	// Oldest first, so the message that has waited longest is the one a reader meets first.
	return { messages: found.sort((a, b) => a.at - b.at || a.message.id.localeCompare(b.message.id)), count };
}
