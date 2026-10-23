/**
 * Shared shapes for the session bus.
 *
 * These describe the files and the tool result only; the file I/O lives in
 * `store.ts` and the lifecycle in `runtime.ts`.
 */

import type { MessageKind, SessionMode } from "./protocol.ts";

/** One registered Pi session. */
export interface SessionRecord {
	id: string;
	label: string;
	pid: number;
	/** Working directory of the session; the worktree root when there is one. */
	cwd: string;
	/** Repository root the session belongs to, for relative claims. */
	repoRoot: string;
	/** The mode the session was started in. */
	mode: SessionMode;
	startedAt: number;
	lastSeen: number;
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
	sessions: Array<SessionRecord & { unread: number }>;
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

/** Structured result carried in the `session` tool's details. */
export interface SessionDetails {
	action: "status" | "send" | "inbox" | "claim" | "release" | "watch";
	status?: SessionStatus;
	delivered?: string[];
	messageId?: string;
	messages?: BusMessage[];
	claimed?: string[];
	conflicts?: ClaimConflict[];
	released?: string[];
	notOwned?: string[];
	/** Whether the inbox watch is on, and whether it raises a turn. */
	watching?: { armed: boolean; wake: boolean };
	error?: string;
}
