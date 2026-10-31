/**
 * The armed inbox watch: polling this session's own inbox and the queue of mail
 * that arrived and has not been reported yet.
 *
 * It announces and never consumes: `inbox` keeps sole ownership of deleting mail,
 * so a wake cannot eat a message the model did not read. Nothing here knows about
 * the store, the repository, or the transcript — the runtime supplies one read-only
 * peek and the timer, and the extension's reporter supplies `onWake`.
 *
 * Polling rather than `fs.watch`, like the `watch` extension's tail: one readdir on
 * this session's own directory stands in for a platform event API.
 */

import type { RepeatTimer } from "../../lib/timer.ts";
import type { BusMessage, InboxPeek } from "./types.ts";

export interface MailWatchOptions {
	/**
	 * This session's inbox, read-only: up to a page of mail whose ids are not `known`, and
	 * the ids of every message still there. Nothing is consumed or marked.
	 */
	peek(known: ReadonlySet<string>): Promise<InboxPeek>;
	/** The repeating timer behind the poll. */
	interval: RepeatTimer;
	/** Poll interval; 0 disables the ticker (tests). */
	watchMs: number;
}

/** Whether the watch is on, and whether it raises a turn. */
export interface WatchingState {
	armed: boolean;
	wake: boolean;
}

export interface MailWatch {
	/** Arm or disarm this session's inbox watch. */
	watch(input: { wake?: boolean; stop?: boolean }): Promise<WatchingState>;
	/** The current state, for the status line. */
	state(): WatchingState;
	/** Whether the armed watch asked for a triggered turn; the settle retry reads it. */
	wantsWake(): boolean;
	/** Read the inbox without consuming it, queueing what is new; no-op when unarmed. */
	poll(): Promise<void>;
	/** Mail that arrived and has not been reported yet, oldest first. */
	pending(): BusMessage[];
	/** Drop mail from the pending queue, once reported or consumed. */
	markReported(ids: readonly string[]): void;
	/** Release the ticker and the queue, on shutdown. */
	stop(): void;
	set onWake(callback: (() => void) | undefined);
}

export function createMailWatch(options: MailWatchOptions): MailWatch {
	const { peek, interval, watchMs } = options;

	let armed = false;
	let wake = false;
	let stopTicker: (() => void) | undefined;
	let pendingMail: BusMessage[] = [];
	/**
	 * Ids already queued, reported, or consumed — pruned by what is still on disk, so it
	 * holds exactly the announced mail an `inbox` call has not removed yet.
	 */
	let reported = new Set<string>();
	let onWake: (() => void) | undefined;

	function dropFromPending(ids: ReadonlySet<string>): void {
		pendingMail = pendingMail.filter((message) => !ids.has(message.id));
	}

	function markReported(ids: readonly string[]): void {
		for (const id of ids) reported.add(id);
		dropFromPending(new Set(ids));
	}

	/**
	 * Queue what this watch has not announced, once, and wake a turn when this session
	 * asked for one.
	 *
	 * The queue and the memory are pruned by what is still on disk, so `reported` is
	 * bounded by the inbox rather than by a count: an id that leaves the inbox leaves the
	 * set, and no id still on disk can be forgotten while it is there. A count was how a
	 * backlog larger than one read made the watch forget an id it had already announced and
	 * announce it again.
	 */
	async function pollOnce(): Promise<void> {
		if (!armed) return;
		const known = new Set(reported);
		for (const message of pendingMail) known.add(message.id);
		const { mail, unread } = await peek(known);
		// The read names everything still in the inbox, which is a different question from
		// what one page covered: a message that expired or was consumed leaves the queue and
		// the memory with its file.
		for (const id of reported) if (!unread.has(id)) reported.delete(id);
		pendingMail = pendingMail.filter((message) => unread.has(message.id));
		if (mail.length === 0) return;
		pendingMail = [...pendingMail, ...mail];
		if (wake) onWake?.();
	}

	function disarm(): void {
		stopTicker?.();
		stopTicker = undefined;
		armed = false;
		wake = false;
		pendingMail = [];
	}

	async function watch(input: { wake?: boolean; stop?: boolean }): Promise<WatchingState> {
		if (input.stop) {
			disarm();
			return { armed: false, wake: false };
		}
		if (!armed) {
			armed = true;
			wake = input.wake === true;
			await pollOnce();
			if (watchMs > 0) stopTicker = interval(watchMs, () => void pollOnce().catch(() => {}));
			return { armed, wake };
		}
		// The mode is a setting, not an arm-time flag: an explicit `wake` changes it
		// under a queued notice, and an omitted one keeps it, so bare `watch` never
		// demotes an armed session.
		if (input.wake !== undefined) wake = input.wake;
		// Asking for wake over mail already queued is a request for that burst too;
		// mid-turn it is suppressed here and retried once the run settles.
		if (wake && pendingMail.length > 0) onWake?.();
		return { armed, wake };
	}

	return {
		watch,
		state: () => ({ armed, wake }),
		wantsWake: () => armed && wake,
		poll: pollOnce,
		pending: () => [...pendingMail],
		markReported,
		stop: disarm,
		set onWake(callback: (() => void) | undefined) {
			onWake = callback;
		},
	};
}
