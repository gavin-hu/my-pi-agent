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
 * - One turn at a time per peer, and by default one turn at a time overall
 *   (`concurrency`), so a forwarded dialog always has a single owning peer.
 * - A message that arrives while its peer is already waiting behind a turn is
 *   merged into the waiting one, so a burst is answered once, in order.
 * - A turn's answer is the text it produced. A requested `/stop` says `stopped`
 *   and drops the partial answer, a finished turn with no text says `noText`,
 *   and a thrown turn says `failed` — never silence.
 * - The session is opened lazily, reset on request, and disposed after an idle
 *   timeout, so a peer who stops writing does not keep a context alive.
 *
 * Value-only: every queue, timer, and session lives in the closure.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { messageOf } from "./errors.ts";
import type { PeerSession } from "./peer-session.ts";
import { createReplyPipeline } from "./reply-pipeline.ts";
import { defaultTimer, type ArmTimer } from "./timer.ts";

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
export type TurnFallback = "stopped" | "noText" | "failed" | "compacted";

export interface PeerWorkerDeps {
	/** Open (or resume) one peer's session; the bridge owns the directory layout. */
	openSession: (peer: string, options: { fresh: boolean }) => Promise<PeerSession>;
	/** Deliver one turn's text to the peer; false stops the rest of a stream. */
	send: (item: PeerItem, text: string) => Promise<boolean>;
	/** The fallback line for a turn that produced no text. */
	fallback: (item: PeerItem, reason: TurnFallback) => string;
	/** A turn started / finished for this item, for typing and notices. */
	onStart?: (item: PeerItem) => void;
	onSettled?: (item: PeerItem) => void;
	/** A session or turn failure worth showing on the terminal. */
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Turns running at once across peers. Default 1, so a dialog has one owner. */
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
	/** Queue one message; resolves as soon as it is queued or merged. */
	enqueue(item: PeerItem): void;
	/** Stop the running turn for `peer`; false when nothing was running. */
	abort(peer: string): boolean;
	/**
	 * Drop the peer's conversation so the next message starts a fresh session.
	 * Refused while a turn runs, and the queued messages go with it.
	 */
	reset(peer: string): boolean;
	/** The turn running right now, if any (one with the default concurrency). */
	current(): PeerItem | undefined;
	state(peer: string): PeerState;
	snapshot(): PeerSnapshot[];
	/** Drop every session; queued messages are dropped with them. */
	close(): Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface PeerEntry {
	queue: PeerItem[];
	/** Messages merged into the waiting item, so `queued` counts real messages. */
	merged: number;
	running?: PeerItem;
	/** Monotonic start time of the running turn, for `runningMs`. */
	startedAt?: number;
	session?: PeerSession;
	/** When the current session opened, for the doctor's session age. */
	sessionSince?: number;
	opening?: Promise<PeerSession>;
	disposeTimer?: () => void;
}

/** Merge a waiting item with a newer one from the same peer. */
function mergeItems(first: PeerItem, next: PeerItem): PeerItem {
	const images = [...(first.images ?? []), ...(next.images ?? [])];
	return {
		peer: first.peer,
		text: first.text && next.text ? `${first.text}\n${next.text}` : first.text || next.text,
		images: images.length > 0 ? images : undefined,
		// The first item's prefix still describes an attachment the model never saw.
		prefix: first.prefix,
		language: next.language,
		contextToken: next.contextToken ?? first.contextToken,
	};
}

export function createPeerWorker(deps: PeerWorkerDeps): PeerWorker {
	const now = deps.now ?? Date.now;
	const armTimer = deps.armTimer ?? defaultTimer;
	const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	const concurrency = Math.max(1, deps.concurrency ?? 1);
	const peers = new Map<string, PeerEntry>();
	/** Peers whose running turn the peer asked to stop, so it reads as stopped. */
	const aborted = new Set<string>();
	/** Peers whose next session must start empty (`/new`). */
	const fresh = new Set<string>();
	let running = 0;
	let currentItem: PeerItem | undefined;
	let closed = false;

	function entry(peer: string): PeerEntry {
		const existing = peers.get(peer);
		if (existing) return existing;
		const created: PeerEntry = { queue: [], merged: 0 };
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
				queued: target.queue.length + target.merged,
				runningMs: target.startedAt === undefined ? 0 : now() - target.startedAt,
				...sessionAge,
			};
		}
		const queued = target.queue.length + target.merged;
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
		}
		if (reason) await sendPart(deps.fallback(item, reason));
		if (compacted) await sendPart(deps.fallback(item, "compacted"));
	}

	/** The next peer with work, so a finished turn can hand its slot on. */
	function nextRunnable(): [string, PeerEntry] | undefined {
		for (const [peer, target] of peers) {
			if (!target.running && target.queue.length > 0) return [peer, target];
		}
		return undefined;
	}

	/** Start turns until the concurrency limit or the queues are empty. */
	function wake(): void {
		while (!closed && running < concurrency) {
			const next = nextRunnable();
			if (!next) return;
			const [peer, target] = next;
			const item = target.queue.shift() as PeerItem;
			target.merged = 0;
			target.running = item;
			target.startedAt = now();
			running += 1;
			currentItem = item;
			cancelIdleSweep(target);
			deps.onStart?.(item);
			void (async () => {
				try {
					const opened = await sessionFor(peer, target);
					await runTurn(item, opened);
				} catch (error) {
					deps.notify?.(`WeChat session failed for ${item.peer}: ${messageOf(error)}`, "error");
					await deps.send(item, deps.fallback(item, "failed"));
				} finally {
					target.running = undefined;
					target.startedAt = undefined;
					running -= 1;
					currentItem = undefined;
					deps.onSettled?.(item);
					armIdleSweep(target);
					wake();
				}
			})();
		}
	}

	return {
		enqueue(item: PeerItem): void {
			if (closed) return;
			const target = entry(item.peer);
			const tail = target.queue.at(-1);
			// A non-empty queue means this peer's turn has not started yet, so the
			// burst is answered once, in send order. The merged count keeps `queued`
			// honest so the bridge can cap a flood and the panel can report it.
			if (tail) {
				target.queue[target.queue.length - 1] = mergeItems(tail, item);
				target.merged += 1;
			} else {
				target.queue.push(item);
			}
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
				target.merged = 0;
				cancelIdleSweep(target);
			}
			return true;
		},

		current(): PeerItem | undefined {
			return currentItem;
		},

		state(peer: string): PeerState {
			return stateOf(peer);
		},

		snapshot(): PeerSnapshot[] {
			return [...peers.keys()].map((peer) => ({ peer, state: stateOf(peer) }));
		},

		async close(): Promise<void> {
			closed = true;
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
		},
	};
}
