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
import type { BusMessage, UnaccountedPage } from "../../lib/session-mail.ts";

export type { BusMessage, MessageKind, UnaccountedMessage, UnaccountedPage } from "../../lib/session-mail.ts";

/** One registered Pi session. */
export interface SessionRecord {
	id: string;
	label: string;
	pid: number;
	/**
	 * The machine that wrote this record.
	 *
	 * A bus directory can live where a sync client replicates it, so a record read here may be the
	 * other machine's: this is what tells them apart, and what stops a stranger's pid being read as
	 * a local process. Absent is a record an older build wrote, which is always this machine's.
	 */
	host?: string;
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
	 * The watch this session asked for, in one word — the statement, written on every join.
	 *
	 * `off` is a door's `listen: false` and is never turned back on by another door; absent is a
	 * record written before this field existed. A start adopts it, so a restart restores what the
	 * user asked for instead of the mode the next join happens to spell.
	 */
	watch?: WatchMode;
	/**
	 * The same mode as the pair a peer reads, derived on every write.
	 *
	 * `armed: false` means the session is on the bus but no watch will wake it, which is the
	 * honest answer for a peer deciding whether mail will reach it; absent is only a record
	 * written before this field existed. It is a rendering of `watch`, not a second fact — the
	 * readers outside this extension still take this shape (#868 moves one of them).
	 */
	watching?: { armed: boolean; wake: boolean };
	/**
	 * The mail this session has been told about, by id — what a peer's unread count subtracts.
	 *
	 * A count of `N unread` is the mail a session has *not* been told about, so an announcement
	 * advances this and the number falls with no delete: `inbox` keeps sole ownership of removing
	 * a body. Pruned against the inbox on every poll, and on the heartbeat whether or not the watch
	 * is armed, so an id can outlive its file by one tick and no longer.
	 */
	seenMail?: string[];
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

/** One repository-relative claim. */
export interface ClaimRecord {
	path: string;
	owner: string;
	ownerLabel: string;
	at: number;
	/**
	 * The machine that made it.
	 *
	 * It is what the claim lapses on: a peer here judges its owner by the owner's record, and owns
	 * no pid on another machine — so the other machine's claim ends when *that machine* stops
	 * writing its heartbeat, not when a local pid happens to be missing. Absent is a claim an older
	 * build wrote, which claimed paths on this machine only.
	 */
	host?: string;
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
 * The watch as a session holds it: one mode, not a pair.
 *
 * `off` is no watch at all, `on` reports mail at the next turn, and `wake` raises a turn while
 * the session is idle. The pair a peer reads is `mail-watch.ts`'s rendering of this.
 */
export type WatchMode = "off" | "on" | "wake";

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
