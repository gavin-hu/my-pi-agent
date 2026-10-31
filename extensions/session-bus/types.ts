/**
 * Shared shapes for the session bus.
 *
 * These describe the files and the tool result only; the file I/O lives in
 * `store.ts` and the lifecycle in `runtime.ts`.
 */

import type { RosterState } from "../../lib/session-roster.ts";
import type { MessageKind, SessionMode } from "./protocol.ts";

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
	 * Whether this session is listening for mail, written when it joins.
	 *
	 * Absent means "not listening": a record written before this existed and a session
	 * that stopped listening read the same way, which is the honest answer for a peer
	 * deciding whether mail will reach it.
	 */
	watching?: { armed: boolean; wake: boolean };
}

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

/**
 * One read of a recipient's inbox.
 *
 * The watch and `inbox` ask two questions of the same directory — which mail is new,
 * and which mail is gone — and one readdir answers both, so a queue's health never
 * depends on what a single window happened to cover.
 */
export interface InboxPeek {
	/** The newest messages, oldest first, so a burst reads in the order it arrived. */
	mail: BusMessage[];
	/** Every id still in the inbox, whether or not this read returned it. */
	unread: ReadonlySet<string>;
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
	messageId?: string;
	messages?: BusMessage[];
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
