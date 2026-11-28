/**
 * The armed inbox watch: polling this session's own inbox and the queue of mail
 * that arrived and has not been reported yet.
 *
 * It announces and never consumes: `inbox` keeps sole ownership of deleting mail,
 * so a wake cannot eat a message the model did not read. The answer to "has this
 * one been reported" is the caller's to keep — the record's `seenMail`, which is
 * also the number a peer's unread count subtracts — so the watch holds no set of
 * its own, and cannot grow one for the life of the process. Nothing here knows
 * about the store, the repository, or the transcript: the runtime supplies one
 * read-only peek, the told set and its writer, and the timer, and the extension's
 * reporter supplies `onWake`.
 *
 * Polling rather than `fs.watch`, like the `watch` extension's tail: one readdir on
 * this session's own directory stands in for a platform event API.
 *
 * The state is one mode — off, on, or wake — because the pair a peer reads is a rendering
 * of it: `{armed, wake}` can spell "not armed, but waking", and a record that kept both
 * could come back from disk disagreeing with itself. The mode is the fact; `state()` is how
 * a reader sees it.
 */

import type { RepeatTimer } from "../../lib/timer.ts";
import { isWatchMode } from "../../lib/session-files.ts";
import type { BusMessage, InboxPeek, SessionRecord, WatchMode } from "./types.ts";

export interface MailWatchOptions {
	/**
	 * This session's inbox, read-only: up to a page of mail whose ids are not `known`, and
	 * the ids of every message still there. Nothing is consumed or marked.
	 */
	peek(known: ReadonlySet<string>): Promise<InboxPeek>;
	/**
	 * The ids this session has already been told about, where the caller keeps them: a record
	 * a peer can read. Asked afresh rather than held, so the watch cannot drift from it and a
	 * resumed session inherits the answer its own record already carries.
	 */
	told(): readonly string[];
	/** Record the told set: an announcement, or a poll that found the mail behind an id gone. */
	onTold(ids: readonly string[]): void;
	/** The repeating timer behind the poll. */
	interval: RepeatTimer;
	/** Poll interval; 0 disables the ticker (tests). */
	watchMs: number;
}

/** The pair a peer reads and a status line prints: a rendering of a {@link WatchMode}. */
export interface WatchingState {
	armed: boolean;
	wake: boolean;
}

/** The pair a mode spells, for the readers that predate it. */
export function watchPair(mode: WatchMode): WatchingState {
	return { armed: mode !== "off", wake: mode === "wake" };
}

/** Whether a value is a mode: the three words are the whole set, so a hand edit can miss it. */
/**
 * The mode a stored pair spells, for a record written before the mode existed.
 *
 * `{armed: false, wake: true}` is the pair the mode cannot express, and it reads as `off`: a
 * watch that is not armed delivers nothing, whatever its wake flag says. This build wrote no
 * such pair — `watch` always set both — so only a hand edit can produce one.
 */
export function watchModeOf(watching: WatchingState | undefined): WatchMode {
	if (watching === undefined || !watching.armed) return "off";
	return watching.wake ? "wake" : "on";
}

/**
 * The mode a record carries: its own field, or the pair an older build wrote beside it.
 *
 * A record whose field and pair disagree is read twice, by two audiences: this session adopts
 * the field, and a peer reads the pair. That is why writes derive one from the other. A field
 * that is not a mode is treated as absent — the same read falls back to the pair — because one
 * hand-edited word should cost the mode and not the session's record.
 */
export function storedWatchMode(record: Pick<SessionRecord, "watch" | "watching"> | undefined): WatchMode {
	const stored = record?.watch;
	if (isWatchMode(stored)) return stored;
	return watchModeOf(record?.watching);
}

/**
 * Write the mode a join settled on: the statement, then the pair a peer reads.
 *
 * The one writer of the record's watch is the door that asked the watch for a change, so the
 * pair cannot drift from the mode; a start adopts the mode and writes nothing.
 */
export function recordWatch(target: Pick<SessionRecord, "watch" | "watching">, state: WatchingState): void {
	const mode = watchModeOf(state);
	target.watch = mode;
	target.watching = watchPair(mode);
}

export interface MailWatch {
	/** Arm, disarm, or re-mode this session's inbox watch, as a door of its own asked. */
	watch(input: { wake?: boolean; stop?: boolean }): Promise<WatchingState>;
	/**
	 * Adopt the mode a record already carries, at start.
	 *
	 * Arms when the mode is not `off`, and stands down once a join in this run has decided. It
	 * writes nothing: the record's mode is `watch`'s to write, so a start cannot persist a mode
	 * nobody asked for in this run.
	 */
	restore(mode: WatchMode): Promise<void>;
	/** The current state, for the status line. */
	state(): WatchingState;
	/**
	 * The files still in this inbox, as the last poll read them; 0 while unarmed.
	 *
	 * The depth a turn-start line reads: the read is one the watch already made, so saying
	 * "mail is waiting" costs no second look at the directory.
	 */
	size(): number;
	/** Whether the armed watch asked for a triggered turn; the settle retry reads it. */
	wantsWake(): boolean;
	/** Read the inbox without consuming it, queueing what is new; no-op when unarmed. */
	poll(): Promise<void>;
	/**
	 * A poll whose failure costs the caller nothing.
	 *
	 * The standing line counts files, so the call that removed one refreshes the depth there and then
	 * rather than waiting for the tick: a failed refresh costs the line a turn, never the mail.
	 */
	refresh(): Promise<void>;
	/** Mail that arrived and has not been reported yet, oldest first. */
	pending(): BusMessage[];
	/** Mark mail as told — reported, or consumed — so no notice repeats it. */
	markReported(ids: readonly string[]): void;
	/** Release the ticker and the queue, on shutdown. */
	stop(): void;
	set onWake(callback: (() => void) | undefined);
}

export function createMailWatch(options: MailWatchOptions): MailWatch {
	const { peek, told, onTold, interval, watchMs } = options;

	let mode: WatchMode = "off";
	let stopTicker: (() => void) | undefined;
	let pendingMail: BusMessage[] = [];
	/** Files in the inbox at the last read, which is the depth a standing line reports. */
	let inboxSize = 0;
	/** One read at a time: a poll that arrives while another is reading is dropped, not queued. */
	let polling = false;
	let onWake: (() => void) | undefined;

	function dropFromPending(ids: ReadonlySet<string>): void {
		pendingMail = pendingMail.filter((message) => !ids.has(message.id));
	}

	/**
	 * Add the ids an announcement carried to the told set, and drop them from the queue.
	 *
	 * Written through the caller, so the record is the only copy: a watch armed, disarmed, and
	 * armed again over the same session re-announces nothing, because the answer came from the
	 * record rather than from a set the watch was holding.
	 */
	function markReported(ids: readonly string[]): void {
		const next = new Set(told());
		for (const id of ids) next.add(id);
		onTold([...next]);
		dropFromPending(new Set(ids));
	}

	/**
	 * Queue what this watch has not announced, once, and wake a turn when this session
	 * asked for one.
	 *
	 * The queue and the told set are pruned by what is still on disk, so neither is bounded by
	 * a count: an id that leaves the inbox leaves both, and no id still on disk can be
	 * forgotten while it is there. A count was how a backlog larger than one read made the
	 * watch forget an id it had already announced and announce it again.
	 *
	 * One read at a time, and the page is judged by the state it came back to. The ticker,
	 * an explicit `poll`, and a poll slower than the interval can all be in flight at once,
	 * and each of them would read the same `known` and append the same mail; a second reader
	 * is dropped instead, like the board's own reader. Between the peek and the append, `inbox`
	 * can consume and report what this page carries, and a `stop` can clear the queue, so the
	 * answer is filtered by the told set as it stands after the read — `known` is what the store
	 * was asked, not what it is still allowed to queue.
	 */
	/**
	 * Whether the watch is reading for anything.
	 *
	 * Read through a call rather than narrowed inline: a `stop` can land during the peek, and the
	 * mode the function started with is not the one it returns to.
	 */
	const armed = (): boolean => mode !== "off";

	async function pollOnce(): Promise<void> {
		if (!armed() || polling) return;
		polling = true;
		try {
			const known = new Set(told());
			for (const message of pendingMail) known.add(message.id);
			const { mail, unread } = await peek(known);
			if (!armed()) return;
			// Files, not unread: `read` marks told but keeps them, and a line that vanished on a
			// peek would stop saying what `inbox` still has to consume.
			inboxSize = unread.size;
			// The read names everything still in the inbox, which is a different question from
			// what one page covered: a message that expired or was consumed leaves the queue and
			// the told set with its file.
			pendingMail = pendingMail.filter((message) => unread.has(message.id));
			const announced = told();
			const live = announced.filter((id) => unread.has(id));
			if (live.length !== announced.length) onTold(live);
			// Read after the peek, for the same reason: the page is stale for exactly the mail this
			// session already has, and what it has can change while the read is in flight.
			const knownNow = new Set(live);
			const fresh = mail.filter((message) => !knownNow.has(message.id));
			if (fresh.length === 0) return;
			pendingMail = [...pendingMail, ...fresh];
			if (mode === "wake") onWake?.();
		} finally {
			polling = false;
		}
	}

	function disarm(): void {
		stopTicker?.();
		stopTicker = undefined;
		mode = "off";
		pendingMail = [];
		inboxSize = 0;
	}

	/** Arm from off: the first read, then the ticker behind it. */
	async function arm(next: WatchMode): Promise<void> {
		mode = next;
		await pollOnce();
		if (watchMs > 0) stopTicker = interval(watchMs, () => void pollOnce().catch(() => {}));
	}

	async function watch(input: { wake?: boolean; stop?: boolean }): Promise<WatchingState> {
		if (input.stop) {
			disarm();
			return watchPair(mode);
		}
		if (mode === "off") {
			await arm(input.wake === true ? "wake" : "on");
			return watchPair(mode);
		}
		// The mode is a setting, not an arm-time flag: an explicit `wake` changes it
		// under a queued notice, and an omitted one keeps it, so bare `watch` never
		// demotes an armed session.
		if (input.wake !== undefined) mode = input.wake ? "wake" : "on";
		// Asking for wake over mail already queued is a request for that burst too;
		// mid-turn it is suppressed here and retried once the run settles.
		if (mode === "wake" && pendingMail.length > 0) onWake?.();
		return watchPair(mode);
	}

	async function restore(next: WatchMode): Promise<void> {
		// A join in this run has already decided: the record it wrote is newer than the one the
		// start read, and adopting over it would undo the door that just spoke.
		if (mode !== "off" || next === "off") return;
		await arm(next);
	}

	return {
		watch,
		restore,
		state: () => watchPair(mode),
		size: () => inboxSize,
		wantsWake: () => mode === "wake",
		poll: pollOnce,
		refresh: () => pollOnce().catch(() => {}),
		pending: () => [...pendingMail],
		markReported,
		stop: disarm,
		set onWake(callback: (() => void) | undefined) {
			onWake = callback;
		},
	};
}
