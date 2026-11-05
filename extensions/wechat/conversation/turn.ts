/**
 * The turn runner: one serial queue for the chat, driving this session's turn.
 *
 * This replaces the shared-session machinery the bridge used to need (`pump`,
 * `active`, `lastText`, `settle`, and the `isIdle` gate), which existed only
 * because WeChat turns had to wait for the terminal to be idle and replies were
 * captured from whatever run happened to finish. Here the chat's messages are
 * answered in order by this session's turn, one at a time.
 *
 * Contract:
 *
 * - One turn at a time, because there is one conversation: a message that
 *   arrives while a turn runs waits for its own turn and answer.
 * - Every message is its own turn, in arrival order. A message that arrives
 *   while a turn runs waits for its own turn and answer; nothing is merged.
 * - A turn's answer is the text it produced. A requested `/stop` says `stopped`
 *   and drops the partial answer, a finished turn with no text says `noText`,
 *   and a thrown turn says `failed` — never silence.
 * - A close that abandons the session says `abandoned` once per peer that still
 *   had work, after its turn stops and before its session goes. The turn's own
 *   line is suppressed then, and each notice carries its own deadline, so a
 *   connection that never answers cannot hold the exit.
 * - The session is opened lazily and disposed after an idle
 *   timeout, so a peer who stops writing does not keep a context alive.
 *
 * Value-only: every queue, timer, and session lives in the closure.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { messageOf } from "../../../lib/errors.ts";
import { sanitizeLine } from "../../../lib/format.ts";
import type { NoticeKind } from "../text/notices.ts";
import type { ChatTurn } from "../host/chat.ts";
import { createReplyPipeline, type ReplyPipeline } from "./reply-pipeline.ts";
import { defaultTimer, type ArmTimer } from "../timer.ts";

/** One admitted, media-resolved inbound message. */
export interface ChatItem {
	peer: string;
	/** The turn text: the peer's message, or its media description. */
	text: string;
	/** Inbound images, attached to the turn. */
	images?: ImageContent[];
	/** A peer-facing line to prepend to the answer (an unreadable attachment). */
	prefix?: string;
	/** The peer's language, for the fallback lines. */
	language: "en" | "zh";
	/** The reply token that was current when the message arrived. */
	contextToken?: string;
}

/** What the worker says to the peer when a turn ends without text of its own. */
export type TurnFallback = Extract<NoticeKind, "stopped" | "abandoned" | "noText" | "failed" | "compacted">;

export interface TurnRunnerDeps {
	/** Open this session as the chat's: the bridge owns the channel and the dialogs. */
	openChat: (peer: string) => Promise<ChatTurn>;
	/** Deliver one line to the peer; false stops the rest of a stream. */
	send: (item: ChatItem, text: string, options?: { signal?: AbortSignal }) => Promise<boolean>;
	/** The fallback line for a turn that produced no text. */
	fallback: (item: ChatItem, reason: TurnFallback) => string;
	/** A turn started / finished for this item, for typing and notices. */
	onStart?: (item: ChatItem) => void;
	onSettled?: (item: ChatItem) => void;
	/** A session or turn failure worth showing on the terminal. */
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Dispose an idle session after this long. `0` disables the idle sweep. */
	idleTimeoutMs?: number;
	/** Streamed part size and quiet window for the reply pipeline. */
	partChars?: number;
	quietMs?: number;
	now?: () => number;
	armTimer?: ArmTimer;
}

/** What a peer is doing right now, for the control screen. */
export interface TurnState {
	status: "idle" | "queued" | "running";
	queued: number;
	/** How long the running turn has been going, in milliseconds. */
	runningMs?: number;
	/** How long the chat's turn adapter has been open, when one is. */
	sessionAgeMs?: number;
}

export interface TurnRunner {
	/** Queue one message; it is never merged into another. */
	enqueue(item: ChatItem): void;
	/**
	 * Stop the running turn, including one whose session is still opening; false when
	 * nothing was running.
	 */
	abort(): boolean;
	/** The turn running right now, if any. */
	running(): ChatItem | undefined;
	/** Flush buffered assistant text before a prompt or a file. */
	flush(): Promise<void>;
	state(): TurnState;
	/** Drop every session; queued messages are dropped with them. */
	close(options?: { abandon?: boolean }): Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** How long a shutdown waits for its one notice per peer before giving up. */
const ABANDON_NOTICE_MS = 5000;

interface PeerEntry {
	queue: ChatItem[];
	running?: ChatItem;
	/** Monotonic start time of the running turn, for `runningMs`. */
	startedAt?: number;
	session?: ChatTurn;
	/** When the current session opened, for the doctor's session age. */
	sessionSince?: number;
	opening?: Promise<ChatTurn>;
	disposeTimer?: () => void;
}

/**
 * The sender's id as a notice names it. It is wire-authored, so it is sanitized here
 * rather than at each of the four notices that print it.
 */
function senderOf(item: ChatItem | undefined): string {
	return sanitizeLine(item?.peer ?? "");
}

export function createTurnRunner(deps: TurnRunnerDeps): TurnRunner {
	const now = deps.now ?? Date.now;
	const armTimer = deps.armTimer ?? defaultTimer;
	const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	/** The conversation: one queue, one session, one owner. */
	let conversation: PeerEntry | undefined;
	/** The id the owner's turn belongs to, for the session and the reply target. */
	let chatPeer: string | undefined;
	/** The reply pipeline of the turn in flight, so a dialog can flush its text first. */
	let activePipeline: ReplyPipeline | undefined;
	/** Whether the chat asked to stop its running turn, so it reads as stopped. */
	let aborted = false;
	let closed = false;

	function entry(peer: string): PeerEntry {
		chatPeer = peer;
		conversation ??= { queue: [] };
		return conversation;
	}

	function cancelIdleSweep(target: PeerEntry): void {
		target.disposeTimer?.();
		target.disposeTimer = undefined;
	}

	function stateOf(): TurnState {
		const target = conversation;
		if (!target) return { status: "idle", queued: 0 };
		const sessionAge =
			target.sessionSince === undefined ? undefined : { sessionAgeMs: Math.max(0, now() - target.sessionSince) };
		if (target.running) {
			return {
				status: "running",
				queued: target.queue.length,
				runningMs: target.startedAt === undefined ? 0 : now() - target.startedAt,
				...sessionAge,
			};
		}
		const queued = target.queue.length;
		return { status: queued > 0 ? "queued" : "idle", queued, ...sessionAge };
	}

	/**
	 * Let go of the chat's session adapter: nothing per-session was opened for it, so
	 * `session_start` are told it is over, then the session itself goes. The entry
	 * forgets the session at once, so no turn can be handed one that is shutting down.
	 */
	function disposeSession(target: PeerEntry): Promise<void> {
		cancelIdleSweep(target);
		const opened = target.session;
		target.session = undefined;
		target.sessionSince = undefined;
		target.opening = undefined;
		return opened ? opened.dispose() : Promise.resolve();
	}

	/** Drop the conversation's session. */
	function releaseSession(): Promise<void> {
		return conversation ? disposeSession(conversation) : Promise.resolve();
	}

	/** Dispose an idle session so N peers do not keep N contexts warm. */
	function armIdleSweep(target: PeerEntry): void {
		cancelIdleSweep(target);
		if (idleTimeoutMs <= 0) return;
		target.disposeTimer = armTimer(idleTimeoutMs, () => {
			target.disposeTimer = undefined;
			if (target.running || target.queue.length > 0) return;
			void disposeSession(target);
		});
	}

	async function sessionFor(peer: string, target: PeerEntry): Promise<ChatTurn> {
		if (target.session) return target.session;
		if (!target.opening) {
			target.opening = deps
				.openChat(peer)
				.then(async (opened) => {
					// The bridge may have closed (or reset this peer) while the session
					// was being built; dispose it instead of leaking it.
					if (closed || conversation !== target) {
						await opened.dispose();
						throw new Error("The WeChat bridge closed while opening the session.");
					}
					target.session = opened;
					target.sessionSince = now();
					return opened;
				})
				.finally(() => {
					target.opening = undefined;
				});
		}
		return target.opening;
	}

	/**
	 * Run one turn, streaming its text to the peer as it arrives.
	 *
	 * The pipeline owns the boundary decisions (paragraph, quiet period, size) and
	 * the serialization, so parts cannot overtake each other. The outcome is
	 * decided once the run ends: an abort drops the unsent remainder, a finished
	 * turn sends it, and a turn that produced nothing at all says so.
	 */
	async function runTurn(item: ChatItem, opened: ChatTurn): Promise<void> {
		const session = opened.session;
		let prefixed = false;
		/** Once a part is rejected, the rest of the answer would fail too. */
		let blocked = false;
		/** The media/attachment line rides on the first part only. */
		const sendPart = async (part: string): Promise<void> => {
			if (blocked) return;
			const body = prefixed || !item.prefix ? part : `${item.prefix}\n\n${part}`;
			prefixed = true;
			blocked = !(await deps.send(item, body));
		};
		// A stop that arrived while the session was opening: the prompt never runs, and the
		// peer still hears it stopped, its attachment line included. Nothing is awaited
		// between the open and this check, so a mark here is always one made while opening.
		if (aborted) {
			aborted = false;
			if (!closed) await sendPart(deps.fallback(item, "stopped"));
			return;
		}
		const pipeline = createReplyPipeline({
			sendPart,
			armTimer,
			partChars: deps.partChars,
			quietMs: deps.quietMs,
		});
		activePipeline = pipeline;
		/** The session compacted this turn, so the peer is told its older detail is fuzzy. */
		let compacted = false;
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "compaction_end" && !event.aborted) {
				compacted = true;
				return;
			}
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				pipeline.push(event.assistantMessageEvent.delta);
			}
		});

		let reason: TurnFallback | undefined;
		try {
			await session.prompt(item.text, item.images ? { images: item.images } : undefined);
			if (aborted) {
				aborted = false;
				// The peer asked to stop: drop what was not sent yet and say so.
				pipeline.drop();
				reason = "stopped";
			} else {
				// A provider that does not stream gives no deltas; use its final text.
				if (pipeline.text() === "") {
					const final = session.getLastAssistantText();
					if (final) pipeline.push(final);
				}
				await pipeline.finish();
				if (pipeline.sent() === "") reason = "noText";
			}
		} catch (error) {
			// A rejection is either the peer's own `/stop` or a real failure.
			pipeline.drop();
			const wasAborted = aborted;
			aborted = false;
			reason = wasAborted ? "stopped" : "failed";
			if (!wasAborted) {
				deps.notify?.(`WeChat turn failed for ${senderOf(item)}: ${messageOf(error)}`, "warning");
			}
		} finally {
			unsubscribe();
			activePipeline = undefined;
		}
		// A closing worker has already said, once, that the session ended.
		if (closed) return;
		if (reason) await sendPart(deps.fallback(item, reason));
		if (compacted) await sendPart(deps.fallback(item, "compacted"));
	}

	/** Start the queued turn, if the conversation is free. */
	function wake(): void {
		for (let target = conversation; !closed && target && !target.running && target.queue.length > 0; ) {
			const peer = chatPeer ?? "";
			const item = target.queue.shift() as ChatItem;
			target.running = item;
			target.startedAt = now();
			cancelIdleSweep(target);
			deps.onStart?.(item);
			void (async () => {
				try {
					const opened = await sessionFor(peer, target);
					await runTurn(item, opened);
				} catch (error) {
					deps.notify?.(`WeChat session failed for ${senderOf(item)}: ${messageOf(error)}`, "error");
					// A closing worker says one line of its own instead: the peer does not need
					// two reasons, and the second send may well fail on the dying connection.
					if (!closed) await deps.send(item, deps.fallback(item, "failed"));
				} finally {
					target.running = undefined;
					target.startedAt = undefined;
					// A stop is only ever meant for the turn that was running, and this is the
					// last moment `abort` can record one: a mark made during the answer's
					// delivery, or the line after it, must not turn the peer's next turn into a
					// "stopped" that never prompted.
					aborted = false;
					deps.onSettled?.(item);
					armIdleSweep(target);
					wake();
				}
			})();
		}
	}

	/** One abandon notice; true when the deadline, not the transport, gave up on it. */
	async function announce(item: ChatItem): Promise<boolean> {
		const controller = new AbortController();
		const cancel = armTimer(ABANDON_NOTICE_MS, () => controller.abort());
		try {
			await deps.send(item, deps.fallback(item, "abandoned"), { signal: controller.signal });
			return controller.signal.aborted;
		} catch (error) {
			// A send the deadline cancelled rejects like any aborted request; that is the
			// deadline's report. Anything else is the transport's own failure.
			if (controller.signal.aborted) return true;
			deps.notify?.(`WeChat could not tell ${senderOf(item)} the session ended: ${messageOf(error)}`, "warning");
			return false;
		} finally {
			cancel();
		}
	}

	/**
	 * Tell every peer that still had work that the session ended.
	 *
	 * One line per peer, sent after the turns have stopped and before the sessions
	 * go. Each send carries its own deadline, so a connection that never answers
	 * cannot hold the exit; a deadline is reported here because the deliverer keeps
	 * an aborted send quiet — an abort is normally the peer's own `/stop`.
	 */
	async function announceAbandoned(items: readonly ChatItem[]): Promise<void> {
		const gaveUp = await Promise.all(items.map((item) => announce(item)));
		for (const [index, timedOut] of gaveUp.entries()) {
			if (!timedOut) continue;
			deps.notify?.(
				`WeChat could not tell ${senderOf(items[index])} the session ended: no reply in ${ABANDON_NOTICE_MS / 1000} s.`,
				"warning",
			);
		}
	}

	return {
		enqueue(item: ChatItem): void {
			if (closed) return;
			const target = entry(item.peer);
			// One message, one turn: a queued item is never folded into another.
			target.queue.push(item);
			wake();
		},

		abort(): boolean {
			const target = conversation;
			if (!target?.running) return false;
			// The intent is recorded even before the session exists: `wake` acts on it as
			// soon as the open settles, so a stop inside the opening window is not lost.
			aborted = true;
			void target.session?.session.abort();
			return true;
		},

		running(): ChatItem | undefined {
			return conversation?.running;
		},

		async flush(): Promise<void> {
			await activePipeline?.flush();
		},

		state(): TurnState {
			return stateOf();
		},

		async close(options?: { abandon?: boolean }): Promise<void> {
			closed = true;
			// Captured before the teardown forgets it: a running turn and a queue that
			// never started are both an answer the peer will not get.
			const abandoned: ChatItem[] = [];
			const closing = conversation;
			if (options?.abandon && closing) {
				const item = closing.running ?? closing.queue[0];
				if (item) abandoned.push(item);
			}
			activePipeline = undefined;
			await Promise.allSettled(closing?.session ? [closing.session.session.abort()] : []);
			// The extensions let go of their per-session resources before a close reports done,
			// so a `session_shutdown` handler that never returns holds `/wechat stop`.
			const releasing = releaseSession();
			conversation = undefined;
			chatPeer = undefined;
			await releasing;
			aborted = false;
			await announceAbandoned(abandoned);
		},
	};
}
