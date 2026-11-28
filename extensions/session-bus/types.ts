/**
 * Shared shapes for the session bus.
 *
 * These describe the files and the tool result only; the file I/O lives in
 * `store.ts` and the lifecycle in `runtime.ts`.
 */

import type { RosterState } from "../../lib/session-roster.ts";
import type { ClaimRecord, SessionRecord } from "../../lib/session-files.ts";

/**
 * The mail shape is the bus's, and two readers outside the bus need it: the message's
 * fields, its guard, and the order a queue is read in live in `lib/session-mail.ts`, so the
 * page and the bus cannot hold two ideas of what a message is.
 */
import type { BusMessage, UnaccountedPage } from "../../lib/session-mail.ts";

export type { BusMessage, MessageKind, UnaccountedMessage, UnaccountedPage } from "../../lib/session-mail.ts";

/**
 * The record's own shapes, and the watch it names, come from the file layer.
 *
 * They moved there with the guard that tests them: `lib/` may not import an extension, and a
 * document's shape and the test that accepts it are one idea. This re-export is the same pattern
 * the line above uses for a message.
 */
export type { ClaimRecord, SessionMode, SessionRecord, WatchMode } from "../../lib/session-files.ts";

/**
 * One read of a recipient's inbox.
 *
 * The watch and `inbox` ask two questions of the same directory — which mail is new,
 * and which mail is gone — and one readdir answers both, so a queue's health never
 * depends on what a single page happened to cover.
 */
export interface InboxPeek {
	/** Up to one page of messages the caller has not seen, oldest first. */
	mail: BusMessage[];
	/**
	 * Every id whose file is still in the inbox, whether or not this read returned it.
	 *
	 * A file this build cannot read counts: it stays where it is until a sweep is past its TTL,
	 * so its id is never in `mail` while it is still here, and `unreadable` names it.
	 */
	unread: ReadonlySet<string>;
	/**
	 * Files in the inbox this build cannot validate, by name.
	 *
	 * They stay where they are — a newer build may read them — so a reader names them rather
	 * than passing them off as empty inbox space, and the sweep ends them through their mtime,
	 * which is the only age a file without a readable `at` has. The sweep is a joined session's
	 * heartbeat, so a bus nobody joins expires nothing. The list is what this
	 * walk reached: it stops at the page's `limit`, so a refusal behind a full page is named
	 * once the mail in front of it is consumed.
	 */
	unreadable: string[];
}

/** What a consuming read took, and what it refused to touch. */
export interface InboxRead {
	messages: BusMessage[];
	/** Files left on disk because this build cannot read them; a sweep past their TTL ends them. */
	unreadable: string[];
}

/**
 * What a prune took: the claims whose owners no longer hold them.
 *
 * An answer rather than a silence because the owner is the one session that cannot see a claim
 * lapse — a peer waits for the path, so it may take it, and nothing tells the session that slept
 * through it. `runtime.ts` says who may be told, in its own inbox.
 */
export interface LapsedClaims {
	/** The claims this prune removed, each as its file held it. */
	claims: ClaimRecord[];
	/**
	 * Records in `sessions/` this build could not read, by file name.
	 *
	 * Reported and left where they are: a newer build wrote them, so deleting one would destroy a
	 * record this reader only failed to understand. Saying the name is what stops it reading as a
	 * session that was never here, and it is the one place in the bus with room to say it.
	 */
	refused: string[];
}

/** What `session status` returns. */
export interface SessionStatus {
	me: { id: string; label: string };
	/** False while this session has only read the bus: it joins by naming itself. */
	onBus: boolean;
	sessions: Array<SessionRecord & { unread: number; state: RosterState }>;
	/**
	 * The mail on this bus whose recipient's record is not here, absent when there is none.
	 *
	 * A message names its recipient by session id, and the id outlives the record that lists it — so
	 * the roster, which counts mail per record, has no row to hang this mail on. It is named rather
	 * than counted because the name is what a person acts on: `/sessions drop <id>` discards one, and
	 * a count could neither be read nor cleared. It is not deleted when the record goes: a session
	 * resumed on that id can still read it, so only a person decides what is evidence no longer.
	 *
	 * The page's `count` is a file count and its `messages` are the ones this read parsed, so the
	 * number can exceed the names — a file a build cannot read is still a file nobody's record holds.
	 * The board asks for the count alone: its poll draws a number, and reading and parsing every one of
	 * these files on each repaint is the cost the read exists to avoid.
	 */
	unaccounted?: UnaccountedPage;
	claims: ClaimRecord[];
	/**
	 * Files in this session's inbox that this build cannot read, absent when there are none.
	 *
	 * They are counted as unread — the count is names alone — so the one read that can parse them
	 * names them beside it: a number a reader cannot act on is worse than a number and a file name.
	 * Only the status read fills this: the board draws once a second and reads no file to do it.
	 */
	unreadable?: string[];
	/** Present when a join asked for a watch — this run or an earlier one; a restart restores it. */
	watching?: { armed: boolean; wake: boolean };
}

/**
 * One id a drop was given and did not remove, and the reason it stayed.
 *
 * `held` is the guard: a person mistyping an id must not destroy a live session's unread mail, so
 * the file stays where its record's reader can still return it, and the sentence names that reader.
 * `missing` is an id the bus holds no unread file for under any record.
 */
export type KeptMail = { id: string; reason: "held"; holder: string } | { id: string; reason: "missing" };

/**
 * What dropping unaccounted mail did.
 *
 * An id can appear in both lists: a broadcast is one file per recipient, so dropping it removes the
 * copies no record holds and leaves the one a live session still has to read.
 */
export interface DropResult {
	dropped: string[];
	kept: KeptMail[];
}

/** A conflict returned by `session claim`. */
export interface ClaimConflict {
	path: string;
	owner: string;
	ownerLabel: string;
}

/**
 * One recipient a message could not be written for.
 *
 * A send is one file per inbox, so one failure does not undo the recipients already
 * written: the caller is told which peers hold the message and which do not.
 */
export interface DeliveryFailure {
	label: string;
	error: string;
}

/**
 * What the board reads in one poll: the bus as it stands, and this session's
 * unread mail. Peeking never consumes, so the notice and `inbox` are unaffected.
 */
export interface BoardSnapshot {
	status: SessionStatus;
	messages: BusMessage[];
}

/** Structured result carried in the `session` tool's details. */
export interface SessionDetails {
	action: "status" | "send" | "inbox" | "read" | "claim" | "release" | "join";
	status?: SessionStatus;
	delivered?: string[];
	/** With send: the recipients no message file could be written for. */
	failed?: DeliveryFailure[];
	messageId?: string;
	messages?: BusMessage[];
	/** With inbox: files this build cannot read, named in the text and left on disk. */
	unreadable?: string[];
	claimed?: string[];
	conflicts?: ClaimConflict[];
	released?: string[];
	notOwned?: string[];
	/** Whether the inbox watch is on, and whether it raises a turn; `join` reports it. */
	watching?: { armed: boolean; wake: boolean };
	/** With join: the label the bus settled on, which is what this session is called. */
	label?: string;
	error?: string;
}
