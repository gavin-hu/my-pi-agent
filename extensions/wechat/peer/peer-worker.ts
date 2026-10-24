/**
 * The per-peer worker: one serial queue per WeChat peer, driving that peer's own
 * session.
 *
 * This replaces the shared-session machinery the bridge used to need (`pump`,
 * `active`, `lastText`, `settle`, and the `isIdle` gate), which existed only
 * because WeChat turns had to wait for the terminal to be idle and replies were
 * captured from whatever run happened to finish. Here a peer's messages are
 * answered in order by that peer's session, independent of the terminal.
 *
 * Contract:
 *
 * - One turn at a time per peer, and by default two peers' turns at once
 *   (`PEER_CONCURRENCY`), so each answered peer owns its dialog through its own
 *   interaction channel. A third peer waits for a slot and is told so.
 * - Every message is its own turn, in arrival order. A message that arrives
 *   while a turn runs waits for its own turn and answer; nothing is merged.
 * - A turn's answer is the text it produced. A requested `/stop` says `stopped`
 *   and drops the partial answer, a finished turn with no text says `noText`,
 *   and a thrown turn says `failed` — never silence.
 * - A close that abandons the session says `abandoned` once per peer that still
 *   had work, after its turn stops and before its session goes. The turn's own
 *   line is suppressed then, and each notice carries its own deadline, so a
 *   connection that never answers cannot hold the exit.
 * - The session is opened lazily, reset on request, and disposed after an idle
 *   timeout, so a peer who stops writing does not keep a context alive.
 *
 * Value-only: every queue, timer, and session lives in the closure.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { messageOf } from "../errors.ts";
import type { NoticeKind } from "../text/notices.ts";
import type { PeerSession } from "./peer-session.ts";
import { createReplyPipeline, type ReplyPipeline } from "./reply-pipeline.ts";
import { defaultTimer, type ArmTimer } from "../timer.ts";

/** One admitted, media-resolved inbound message. */
export interface PeerItem {
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

export interface PeerWorkerDeps {
	/** Open (or resume) one peer's session; the bridge owns the directory layout. */
	openSession: (peer: string, options: { fresh: boolean }) => Promise<PeerSession>;
	/** Deliver one line to the peer; false stops the rest of a stream. */
	send: (item: PeerItem, text: string, options?: { signal?: AbortSignal }) => Promise<boolean>;
	/** The fallback line for a turn that produced no text. */
	fallback: (item: PeerItem, reason: TurnFallback) => string;
	/** A turn started / finished for this item, for typing and notices. */
	onStart?: (item: PeerItem) => void;
	onSettled?: (item: PeerItem) => void;
	/** A session or turn failure worth showing on the terminal. */
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Turns running at once across peers. Defaults to {@link PEER_CONCURRENCY}. */
	concurrency?: number;
	/** Dispose an idle session after this long. `0` disables the idle sweep. */
	idleTimeoutMs?: number;
	/** Streamed part size and quiet window for the reply pipeline. */
	partChars?: number;
	quietMs?: number;
	now?: () => number;
	armTimer?: ArmTimer;
}

/** What a peer is doing right now, for the control screen. */
export interface PeerState {
	status: "idle" | "queued" | "running";
	queued: number;
	/** How long the running turn has been going, in milliseconds. */
	runningMs?: number;
	/** How long the peer's session has been open, when one is open. */
	sessionAgeMs?: number;
}

export interface PeerSnapshot {
	peer: string;
	state: PeerState;
}

export interface PeerWorker {
	/** Queue one message; it is never merged into another. */
	enqueue(item: PeerItem): void;
	/** Stop the running turn for `peer`; false when nothing was running. */
	abort(peer: string): boolean;
	/**
	 * Drop the peer's conversation so the next message starts a fresh session.
	 * Refused while a turn runs, and the queued messages go with it.
	 */
	reset(peer: string): boolean;
	/** The turn running for this peer, if any. */
	running(peer: string): PeerItem | undefined;
	/** Flush buffered assistant text for a running peer before a prompt/file. */
	flush(peer: string): Promise<void>;
	state(peer: string): PeerState;
	snapshot(): PeerSnapshot[];
	/** Drop every session; queued messages are dropped with them. */
	close(options?: { abandon?: boolean }): Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Peers whose turns run at once.
 *
 * Two, because a phone chat rarely has more than two conversations in flight and
 * every concurrent turn is a full model run on the user's budget; the rest wait
 * in a fair queue and are acknowledged, exactly as a second peer waits today.
 */
export const PEER_CONCURRENCY = 2;

/** How long a shutdown waits for its one notice per peer before giving up. */
const ABANDON_NOTICE_MS = 5000;

interface PeerEntry {
	queue: PeerItem[];
	running?: PeerItem;
	/** Monotonic start time of the running turn, for `runningMs`. */
	startedAt?: number;
	session?: PeerSession;
	/** When the current session opened, for the doctor's session age. */
	sessionSince?: number;
	opening?: Promise<PeerSession>;
	disposeTimer?: () => void;
}

export function createPeerWorker(deps: PeerWorkerDeps): PeerWorker {
	const now = deps.now ?? Date.now;
	const armTimer = deps.armTimer ?? defaultTimer;
	const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	const concurrency = Math.max(1, deps.concurrency ?? PEER_CONCURRENCY);
	const peers = new Map<string, PeerEntry>();
	/** Active reply pipelines, so a dialog can flush buffered text first. */
	const pipelines = new Map<string, ReplyPipeline>();
	/** Peers whose running turn the peer asked to stop, so it reads as stopped. */
	const aborted = new Set<string>();
	/** Peers whose next session must start empty (`/new`). */
	const fresh = new Set<string>();
	let running = 0;
	/** When each queued item arrived, so the next free slot goes to the oldest wait. */
	const arrived = new WeakMap<PeerItem, number>();
	let arrivals = 0;
	let closed = false;

	function entry(peer: string): PeerEntry {
		const existing = peers.get(peer);
		if (existing) return existing;
		const created: PeerEntry = { queue: [] };
		peers.set(peer, created);
		return created;
	}

	function cancelIdleSweep(target: PeerEntry): void {
		target.disposeTimer?.();
		target.disposeTimer = undefined;
	}

	function stateOf(peer: string): PeerState {
		const target = peers.get(peer);
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

	/** Drop the peer's session and queue. */
	function releaseSession(peer: string): void {
		const target = peers.get(peer);
		if (!target) return;
		cancelIdleSweep(target);
		target.session?.dispose();
		target.session = undefined;
		target.sessionSince = undefined;
		target.opening = undefined;
	}

	/** Dispose an idle session so N peers do not keep N contexts warm. */
	function armIdleSweep(target: PeerEntry): void {
		cancelIdleSweep(target);
		if (idleTimeoutMs <= 0) return;
		target.disposeTimer = armTimer(idleTimeoutMs, () => {
			target.disposeTimer = undefined;
			if (target.running || target.queue.length > 0) return;
			target.session?.dispose();
			target.session = undefined;
			target.opening = undefined;
		});
	}

	async function sessionFor(peer: string, target: PeerEntry): Promise<PeerSession> {
		if (target.session) return target.session;
		if (!target.opening) {
			const startFresh = fresh.delete(peer);
			target.opening = deps
				.openSession(peer, { fresh: startFresh })
				.then((opened) => {
					// The bridge may have closed (or reset this peer) while the session
					// was being built; dispose it instead of leaking it.
					if (closed || peers.get(peer) !== target) {
						opened.dispose();
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
	async function runTurn(item: PeerItem, opened: PeerSession): Promise<void> {
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
		const pipeline = createReplyPipeline({
			sendPart,
			armTimer,
			partChars: deps.partChars,
			quietMs: deps.quietMs,
		});
		pipelines.set(item.peer, pipeline);
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
			if (aborted.delete(item.peer)) {
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
			const wasAborted = aborted.delete(item.peer);
			reason = wasAborted ? "stopped" : "failed";
			if (!wasAborted) {
				deps.notify?.(`WeChat turn failed for ${item.peer}: ${messageOf(error)}`, "warning");
			}
		} finally {
			unsubscribe();
			pipelines.delete(item.peer);
		}
		// A closing worker has already said, once, that the session ended.
		if (closed) return;
		if (reason) await sendPart(deps.fallback(item, reason));
		if (compacted) await sendPart(deps.fallback(item, "compacted"));
	}

	/** The next peer with work, so a finished turn can hand its slot on. */
	/** The next peer with work, oldest queued message first so no peer starves. */
	function nextRunnable(): [string, PeerEntry] | undefined {
		let picked: [string, PeerEntry] | undefined;
		for (const [peer, target] of peers) {
			if (target.running || target.queue.length === 0) continue;
			const waiting = target.queue[0];
			const oldest = picked?.[1].queue[0];
			if (!picked || (waiting && oldest && (arrived.get(waiting) ?? 0) < (arrived.get(oldest) ?? 0))) {
				picked = [peer, target];
			}
		}
		return picked;
	}

	/** Start turns until the concurrency limit or the queues are empty. */
	function wake(): void {
		while (!closed && running < concurrency) {
			const next = nextRunnable();
			if (!next) return;
			const [peer, target] = next;
			const item = target.queue.shift() as PeerItem;
			target.running = item;
			target.startedAt = now();
			running += 1;
			cancelIdleSweep(target);
			deps.onStart?.(item);
			void (async () => {
				try {
					const opened = await sessionFor(peer, target);
					await runTurn(item, opened);
				} catch (error) {
					deps.notify?.(`WeChat session failed for ${item.peer}: ${messageOf(error)}`, "error");
					// A closing worker says one line of its own instead: the peer does not need
					// two reasons, and the second send may well fail on the dying connection.
					if (!closed) await deps.send(item, deps.fallback(item, "failed"));
				} finally {
					target.running = undefined;
					target.startedAt = undefined;
					running -= 1;
					deps.onSettled?.(item);
					armIdleSweep(target);
					wake();
				}
			})();
		}
	}

	/** One abandon notice; true when the deadline, not the transport, gave up on it. */
	async function announce(item: PeerItem): Promise<boolean> {
		const controller = new AbortController();
		const cancel = armTimer(ABANDON_NOTICE_MS, () => controller.abort());
		try {
			await deps.send(item, deps.fallback(item, "abandoned"), { signal: controller.signal });
			return controller.signal.aborted;
		} catch (error) {
			// A send the deadline cancelled rejects like any aborted request; that is the
			// deadline's report. Anything else is the transport's own failure.
			if (controller.signal.aborted) return true;
			deps.notify?.(`WeChat could not tell ${item.peer} the session ended: ${messageOf(error)}`, "warning");
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
	async function announceAbandoned(items: readonly PeerItem[]): Promise<void> {
		const gaveUp = await Promise.all(items.map((item) => announce(item)));
		for (const [index, timedOut] of gaveUp.entries()) {
			if (!timedOut) continue;
			deps.notify?.(
				`WeChat could not tell ${items[index]?.peer ?? ""} the session ended: no reply in ${ABANDON_NOTICE_MS / 1000} s.`,
				"warning",
			);
		}
	}

	return {
		enqueue(item: PeerItem): void {
			if (closed) return;
			const target = entry(item.peer);
			// One message, one turn: a queued item is never folded into another.
			arrivals += 1;
			arrived.set(item, arrivals);
			target.queue.push(item);
			wake();
		},

		abort(peer: string): boolean {
			const target = peers.get(peer);
			if (!target?.running || !target.session) return false;
			aborted.add(peer);
			void target.session.session.abort();
			return true;
		},

		reset(peer: string): boolean {
			const target = peers.get(peer);
			if (target?.running) return false;
			fresh.add(peer);
			releaseSession(peer);
			if (target) {
				target.queue = [];
				cancelIdleSweep(target);
			}
			return true;
		},

		running(peer: string): PeerItem | undefined {
			return peers.get(peer)?.running;
		},

		async flush(peer: string): Promise<void> {
			await pipelines.get(peer)?.flush();
		},

		state(peer: string): PeerState {
			return stateOf(peer);
		},

		snapshot(): PeerSnapshot[] {
			return [...peers.keys()].map((peer) => ({ peer, state: stateOf(peer) }));
		},

		async close(options?: { abandon?: boolean }): Promise<void> {
			closed = true;
			// Captured before the teardown forgets it: a running turn and a queue that
			// never started are both an answer the peer will not get.
			const abandoned: PeerItem[] = [];
			if (options?.abandon) {
				for (const target of peers.values()) {
					const item = target.running ?? target.queue[0];
					if (item) abandoned.push(item);
				}
			}
			pipelines.clear();
			const runningAborts = [...peers.values()]
				.filter((target) => target.session)
				.map((target) => target.session?.session.abort());
			await Promise.allSettled(runningAborts);
			for (const peer of [...peers.keys()]) {
				releaseSession(peer);
				peers.delete(peer);
			}
			aborted.clear();
			fresh.clear();
			await announceAbandoned(abandoned);
		},
	};
}
