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

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LivenessFn, StartTokenFn } from "../../lib/spawn.ts";
import type { RepeatTimer } from "../../lib/timer.ts";
import type { WatchingState } from "./mail-watch.ts";
import type { BusMessage, ClaimConflict, DeliveryFailure, InboxPeek, SessionStatus } from "./types.ts";

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
	start(ctx: ExtensionContext): Promise<void>;
	stop(): Promise<void>;
	status(): Promise<SessionStatus>;
	/** The live bus, read only: no record refresh, no prune. */
	snapshot(): Promise<SessionStatus>;
	/** This session's unread mail without consuming it, and the files this build cannot read. */
	peek(): Promise<InboxPeek>;
	/** Messages waiting in this session's inbox, counted by file — `peek` stops at its own cap. */
	unread(): Promise<number>;
	/** Release a claim by its stored repository-relative path. */
	releaseStored(path: string): Promise<boolean>;
	send(input: {
		to: string;
		text: string;
		kind?: string;
		paths?: unknown;
	}): Promise<{ delivered: string[]; failed: DeliveryFailure[]; messageId: string }>;
	inbox(limit?: number): Promise<BusMessage[]>;
	claim(paths: unknown): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	release(paths: unknown): Promise<{ released: string[]; notOwned: string[] }>;
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
	poll(): Promise<void> /** Mail that arrived and has not been reported yet, oldest first. */;
	pending(): BusMessage[];
	/** Drop mail from the pending queue, once reported or consumed. */
	markReported(ids: readonly string[]): void;
	/** Set what to call when new mail arrives and this session asked to be woken. */
	set onWake(callback: (() => void) | undefined);
}
