/**
 * The bus as its owner and its callers name it: the shapes, and nothing that runs.
 *
 * `runtime.ts` is the lifecycle and the operations, and it was carrying the two interfaces
 * that describe them as well — a hundred lines of declaration over a module already past the
 * line bar. They live here for the same reason the store's shapes live in `types.ts`: a
 * shape is read by `commands.ts`, by the request modules, and by a test, and none of them
 * needs the runtime to be loaded to say what the bus answers.
 *
 * Types only: no value, no import that is not a type, and so nothing on the registration
 * graph.
 */

import type { ExtensionContext, SessionShutdownEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { HostIdentity } from "../../lib/session-files.ts";
import type { LivenessFn, StartTokenFn } from "../../lib/spawn.ts";
import type { RepeatTimer } from "../../lib/timer.ts";
import type { WatchingState } from "./mail-watch.ts";
import type { BusMessage, ClaimConflict, DeliveryFailure, DropResult, InboxPeek, SessionStatus } from "./types.ts";

export interface SessionBusOptions {
	now?: () => number;
	/** Test seam: use this bus directory instead of the agent-dir layout. */
	dir?: string;
	/** Test seam: the process id this runtime registers as, so two can share one session id. */
	pid?: number;
	/** Test seam: whether a pid is running, so a suite never depends on the host's pids. */
	alive?: LivenessFn;
	/** Test seam: the start-time seam the record is stamped with. */
	startTokenFn?: StartTokenFn;
	/**
	 * Test seam: this machine's identity, as `presence/host.json` holds it.
	 *
	 * The product reads it, making it on first use. A caller that names its own `dir` names its host
	 * too; one that names neither writes records and claims an older build would have written.
	 */
	host?: HostIdentity;
	/** Test seam: skip git and use this repository identity, saying whether git would have resolved it. */
	repo?: { root: string; key: string; fromGit?: boolean };
	/** Heartbeat interval; 0 disables it (tests). */
	heartbeatMs?: number;
	/** Inbox-watch poll interval; 0 disables it (tests). */
	watchMs?: number;
	/** Test seam: the repeating timer behind the heartbeat and the poll. */
	interval?: RepeatTimer;
	sessionTtlMs?: number;
	messageTtlMs?: number;
}

export interface SessionBus {
	/**
	 * Load this session's records, serving the row a `/new` left behind.
	 *
	 * The event is optional because a caller that is not the host's lifecycle has no reason to
	 * give: a join request, a suite, a command. Without one, nothing is served and a record is
	 * minted, which is what every one of those callers wants.
	 */
	start(ctx: ExtensionContext, event?: SessionStartEvent): Promise<void>;
	/**
	 * Release this session's resources.
	 *
	 * `"new"` keeps the record and its claims, because the process goes on serving them under a
	 * new transcript; every other reason ends the session and removes what it held.
	 */
	stop(event?: SessionShutdownEvent): Promise<void>;
	status(): Promise<SessionStatus>;
	/** The live bus, read only: no record refresh, no prune. */
	snapshot(): Promise<SessionStatus>;
	/** This session's unread mail without consuming it, and the files this build cannot read. */
	peek(): Promise<InboxPeek>;
	/**
	 * The files still in this inbox, as the last poll read them; 0 while the watch is off.
	 *
	 * A turn-start line reads this rather than the inbox: the count is already paid for by the
	 * watch, and a session that is not listening has nothing to say.
	 */
	inboxDepth(): number;
	/**
	 * Remove unaccounted mail by message id — the one door `/sessions drop` opens.
	 *
	 * No tool action calls this: a person clears evidence, a session does not. The store refuses any
	 * id a record's inbox holds, so a mistaken id costs a sentence rather than somebody's mail.
	 */
	dropUnaccounted(ids: readonly string[]): Promise<DropResult>;
	/** Release a claim by its stored repository-relative path. */
	releaseStored(path: string): Promise<boolean>;
	send(input: {
		to: string;
		text: string;
		kind?: string;
		/** A name for this message: a resend of the same body folds into the copy still waiting. */
		key?: unknown;
		/** The message or ask this one answers, as one word. */
		replyTo?: unknown;
		/**
		 * What the message is about: the sender's own spelling for it — a card's `#673`, a branch, a
		 * phrase — in one line of at most 64 characters.
		 */
		about?: unknown;
		paths?: unknown;
	}): Promise<{ delivered: string[]; failed: DeliveryFailure[]; messageId: string }>;
	inbox(limit?: number): Promise<BusMessage[]>;
	/**
	 * Show up to `limit` messages without deleting them, marking what it shows as told.
	 *
	 * The door for a burst a notice only previewed: the count falls because the mail reached the
	 * model, and `inbox` stays the one call that removes a body.
	 */
	read(limit?: number): Promise<InboxPeek>;
	claim(paths: unknown): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	/**
	 * Release this session's claims, or — with `holder` — move a live peer's claims to this session.
	 *
	 * The second form is the seat's move, and it answers in the same two lists: what changed hands
	 * and what the named peer did not hold (#835).
	 */
	release(paths: unknown, holder?: string): Promise<{ released: string[]; notOwned: string[] }>;
	/**
	 * Join the team: join the bus, name this session when given a label, and listen for
	 * mail unless `listen` is false. One action, because they are one act — a session on
	 * the bus that will not hear mail is on it, but not on the team.
	 */
	join(input: {
		label?: string;
		wake?: boolean;
		listen?: boolean;
	}): Promise<{ label: string; watching: WatchingState }>;
	/** Whether the armed watch asked for a triggered turn; the settle retry reads it. */
	wantsWake(): boolean;
	/** A run began: stamp the record, so a peer reads this session as at work. */
	turnStart(): Promise<void>;
	/** The run settled: take the stamp off, aborted or not. */
	turnSettled(): Promise<void>;
	/** Read the inbox without consuming it, queueing what is new; no-op when unarmed. */
	poll(): Promise<void>;
	/** Mail that arrived and has not been reported yet, oldest first. */
	pending(): BusMessage[];
	/** Drop mail from the pending queue, once reported or consumed. */
	markReported(ids: readonly string[]): void;
	/** Set what to call when new mail arrives and this session asked to be woken. */
	set onWake(callback: (() => void) | undefined);
}
