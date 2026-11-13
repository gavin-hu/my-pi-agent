/**
 * Shared shapes for the session bus.
 *
 * These describe the files and the tool result only; the file I/O lives in
 * `store.ts` and the lifecycle in `runtime.ts`.
 */

import type { RosterState } from "../../lib/session-roster.ts";
import type { SessionMode } from "./protocol.ts";

/**
 * The mail shape is the bus's, and two readers outside the bus need it: the message's
 * fields, its guard, and the order a queue is read in live in `lib/session-mail.ts`, so the
 * page and the bus cannot hold two ideas of what a message is.
 */
import type { BusMessage } from "../../lib/session-mail.ts";

export type { BusMessage, MessageKind } from "../../lib/session-mail.ts";

/** One registered Pi session. */
export interface SessionRecord {
	id: string;
	label: string;
	pid: number;
	/**
	 * That process's start time, when the host can name one.
	 *
	 * It is what tells the record's process apart from an unrelated one that has since
	 * been given the same pid, so `gone` does not have to wait for the heartbeat to age.
	 * Absent on a platform without `ps`, and on a record written before this existed.
	 */
	startToken?: string;
	/** Working directory of the session; the worktree root when there is one. */
	cwd: string;
	/** Repository root the session belongs to, for relative claims. */
	repoRoot: string;
	/** The mode the session was started in. */
	mode: SessionMode;
	startedAt: number;
	lastSeen: number;
	/**
	 * When this session began the turn it is in, absent outside one.
	 *
	 * The heartbeat says whether a session is there; this says whether it is busy, which is
	 * the other half of a teammate's row. Written on both edges of a run rather than on the
	 * heartbeat, so it does not lag the turn it describes — and read only beside a fresh
	 * heartbeat, because a process that died mid-turn left the stamp behind.
	 */
	turnAt?: number;
	/**
	 * Whether this session is listening for mail, written on every join.
	 *
	 * `armed: false` means the session is on the bus but no watch will wake it, which is the
	 * honest answer for a peer deciding whether mail will reach it; absent is only a record
	 * written before this field existed.
	 */
	watching?: { armed: boolean; wake: boolean };
}

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
	 * A file this build cannot read counts: it stays where it is and the prune TTL is what
	 * ends it, so its id is never in `mail` while it is still here, and `unreadable` names it.
	 */
	unread: ReadonlySet<string>;
	/**
	 * Files in the inbox this build cannot validate, by name.
	 *
	 * They stay where they are — a newer build may read them — so a reader names them rather
	 * than passing them off as empty inbox space, and the message TTL ends them through their
	 * mtime, which is the only age a file without a readable `at` has. The list is what this
	 * walk reached: it stops at the page's `limit`, so a refusal behind a full page is named
	 * once the mail in front of it is consumed.
	 */
	unreadable: string[];
}

/** What a consuming read took, and what it refused to touch. */
export interface InboxRead {
	messages: BusMessage[];
	/** Files left on disk because this build cannot read them; the TTL ends them. */
	unreadable: string[];
}

/** One repository-relative claim. */
export interface ClaimRecord {
	path: string;
	owner: string;
	ownerLabel: string;
	at: number;
}

/** What `session status` returns. */
export interface SessionStatus {
	me: { id: string; label: string };
	/** False while this session has only read the bus: it joins by naming itself. */
	onBus: boolean;
	sessions: Array<SessionRecord & { unread: number; state: RosterState }>;
	/**
	 * Unread mail whose recipient's record is not on this bus, absent when there is none.
	 *
	 * A message names its recipient by session id, and the id outlives the record that lists it —
	 * so the roster, which counts mail per record, has no row to hang this mail on. It is reported
	 * rather than deleted: a session resumed on that id can still read it, and the message TTL is
	 * what ends it otherwise.
	 */
	unattributed?: number;
	claims: ClaimRecord[];
	/** Present only when this session armed its inbox watch. */
	watching?: { armed: boolean; wake: boolean };
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
	action: "status" | "send" | "inbox" | "claim" | "release" | "join";
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
