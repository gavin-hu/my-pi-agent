/**
 * The per-peer worker: one serial queue per WeChat peer, driving that peer's own
 * session.
 *
 * This replaces the shared-session machinery the bridge used to need (`pump`,
 * `active`, `lastText`, `settle`, and the `isIdle` gate), which existed only
 * because WeChat turns had to wait for the terminal to be idle and replies were
 * captured from whatever run happened to finish. Here a peer's messages are
 * answered in order by that peer's session, independent of the terminal and of
 * other peers.
 *
 * Contract:
 *
 * - One turn at a time per peer; messages queued behind it are answered after.
 * - A turn's answer is the text it produced. An aborted turn says `stopped`, a
 *   turn that produced no text says `noText` — never silence.
 * - A turn that throws (a model error, an extension error surfaced by `prompt`)
 *   is reported and answered with `failed`; the queue keeps moving.
 * - The session is opened lazily and disposed after an idle timeout, so a peer
 *   who stops writing does not keep a context alive.
 *
 * Value-only: every queue, timer, and session lives in the closure.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { PeerSession } from "./peer-session.ts";

/** One admitted, media-resolved inbound message. */
export interface PeerItem {
	peer: string;
	/** The turn text: the peer's message, or its media description. */
	text: string;
	/** Inbound images, attached to the turn. */
	images?: ImageContent[];
	/** The peer's language, for the fallback lines. */
	language: "en" | "zh";
	/** The reply token that was current when the message arrived. */
	contextToken?: string;
}

/** What the worker says to the peer when a turn ends without text of its own. */
export type TurnFallback = "stopped" | "noText" | "failed";

export interface PeerWorkerDeps {
	/** Open (or resume) one peer's session; the bridge owns the directory layout. */
	openSession: (peer: string) => Promise<PeerSession>;
	/** Deliver one turn's text to the peer, in whatever parts the transport wants. */
	send: (item: PeerItem, text: string) => Promise<void>;
	/** The fallback line for a turn that produced no text. */
	fallback: (item: PeerItem, reason: TurnFallback) => string;
	/** A turn started / finished for this item, for typing and notices. */
	onStart?: (item: PeerItem) => void;
	onSettled?: (item: PeerItem) => void;
	/** A session or turn failure worth showing on the terminal. */
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Dispose an idle session after this long. `0` disables the idle sweep. */
	idleTimeoutMs?: number;
	now?: () => number;
	armTimer?: (ms: number, fn: () => void) => () => void;
}

/** What a peer is doing right now, for the control screen. */
export interface PeerState {
	status: "idle" | "queued" | "running";
	queued: number;
	/** How long the running turn has been going, in milliseconds. */
	runningMs?: number;
}

export interface PeerWorker {
	/** Queue one message; resolves as soon as it is queued. */
	enqueue(item: PeerItem): void;
	/** Stop the running turn for `peer`; false when nothing was running. */
	abort(peer: string): boolean;
	state(peer: string): PeerState;
	/** Drop every session; queued messages are dropped with them. */
	close(): Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface PeerEntry {
	queue: PeerItem[];
	running?: PeerItem;
	/** Monotonic start time of the running turn, for `runningMs`. */
	startedAt?: number;
	session?: PeerSession;
	opening?: Promise<PeerSession>;
	disposeTimer?: () => void;
}

export function createPeerWorker(deps: PeerWorkerDeps): PeerWorker {
	const now = deps.now ?? Date.now;
	const armTimer =
		deps.armTimer ??
		((ms, fn) => {
			const timer = setTimeout(fn, ms);
			(timer as { unref?: () => void }).unref?.();
			return () => clearTimeout(timer);
		});
	const idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	const peers = new Map<string, PeerEntry>();
	/** Peers whose running turn the peer asked to stop, so it reads as stopped. */
	const aborted = new Set<string>();
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

	/** Drop everything for a peer: the session, its listeners, its queue. */
	function release(peer: string): void {
		const target = peers.get(peer);
		if (!target) return;
		peers.delete(peer);
		aborted.delete(peer);
		cancelIdleSweep(target);
		target.session?.dispose();
		target.session = undefined;
		target.opening = undefined;
		target.queue = [];
		target.running = undefined;
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
			target.opening = deps
				.openSession(peer)
				.then((opened) => {
					target.session = opened;
					return opened;
				})
				.finally(() => {
					target.opening = undefined;
				});
		}
		return target.opening;
	}

	/** Run one turn and turn its outcome into exactly one peer-facing message. */
	async function runTurn(item: PeerItem, opened: PeerSession): Promise<void> {
		const session = opened.session;
		let reason: TurnFallback | undefined;
		let text: string | undefined;
		try {
			await session.prompt(item.text, item.images ? { images: item.images } : undefined);
			if (aborted.delete(item.peer)) {
				// `prompt` resolves for an aborted run too, so the request is what decides
				// the outcome; a partial answer is not sent after `/stop`.
				reason = "stopped";
			} else {
				text = session.getLastAssistantText();
				if (!text) reason = "noText";
			}
		} catch (error) {
			// A rejection is either the peer's own `/stop` or a real failure.
			const wasAborted = aborted.delete(item.peer);
			reason = wasAborted ? "stopped" : "failed";
			if (!wasAborted) {
				deps.notify?.(
					`WeChat turn failed for ${item.peer}: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		}
		const body = text && text.trim() !== "" ? text : deps.fallback(item, reason ?? "noText");
		await deps.send(item, body);
	}

	/** Drain one peer's queue; a second call while draining is a no-op. */
	async function drain(peer: string): Promise<void> {
		const target = entry(peer);
		if (target.running) return;
		while (!closed && target.queue.length > 0) {
			const item = target.queue.shift() as PeerItem;
			target.running = item;
			target.startedAt = now();
			cancelIdleSweep(target);
			deps.onStart?.(item);
			try {
				const opened = await sessionFor(peer, target);
				await runTurn(item, opened);
			} catch (error) {
				deps.notify?.(
					`WeChat session failed for ${item.peer}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				await deps.send(item, deps.fallback(item, "failed"));
			} finally {
				target.running = undefined;
				target.startedAt = undefined;
				deps.onSettled?.(item);
			}
		}
		armIdleSweep(target);
	}

	return {
		enqueue(item: PeerItem): void {
			if (closed) return;
			const target = entry(item.peer);
			target.queue.push(item);
			void drain(item.peer);
		},

		abort(peer: string): boolean {
			const target = peers.get(peer);
			if (!target?.running || !target.session) return false;
			aborted.add(peer);
			void target.session.session.abort();
			return true;
		},

		state(peer: string): PeerState {
			const target = peers.get(peer);
			if (!target) return { status: "idle", queued: 0 };
			if (target.running) {
				return {
					status: "running",
					queued: target.queue.length,
					runningMs: target.startedAt === undefined ? 0 : now() - target.startedAt,
				};
			}
			return { status: target.queue.length > 0 ? "queued" : "idle", queued: target.queue.length };
		},

		async close(): Promise<void> {
			closed = true;
			const running = [...peers.values()]
				.filter((target) => target.session)
				.map((target) => target.session?.session.abort());
			await Promise.allSettled(running);
			for (const peer of [...peers.keys()]) release(peer);
		},
	};
}
