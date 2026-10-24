/**
 * The signals a peer sees while their message waits: the typing indicator, the
 * one delayed acknowledgement, the "still working" line, and the "queued behind
 * another conversation" line.
 *
 * They are grouped here because they share the same per-peer timer bookkeeping:
 * every entry is a cancellable timer, every one is cleared when the turn settles,
 * and a reconnect drops all of them at once. WeChat notifies per bubble, so each
 * notice is bounded to one per wait episode.
 */

import type { BotCredentials } from "../types.ts";
import type { WechatClient } from "../transport/client.ts";
import type { PeerState } from "./peer-worker.ts";
import type { PeerLanguage } from "../text/format.ts";
import { notice } from "../text/notices.ts";
import { createTimerMap, type ArmTimer } from "../timer.ts";

/** How long a fetched typing ticket is reused. */
const TYPING_TTL_MS = 5 * 60 * 1000;
/** How often the typing indicator is refreshed while a peer waits. */
const TYPING_KEEPALIVE_MS = 10_000;
/** Stop refreshing the indicator after this long; a wedged turn must not tick forever. */
const TYPING_LIMIT_MS = 15 * 60 * 1000;
/** Wait this long before telling a queued peer they are queued. */
const ACK_DELAY_MS = 4000;
/** Suppress a second acknowledgement inside this window. */
const ACK_REPEAT_MS = 60_000;
/** Say the running turn is still going after this long without a reply. */
const TURN_NOTICE_MS = 30_000;
/** Say `busy` when a message is still queued behind a running turn after this. */
const BUSY_NOTICE_MS = 60_000;

export interface PresenceDeps {
	typingIndicator: () => boolean;
	now: () => number;
	armTimer: ArmTimer;
	client: () => WechatClient | undefined;
	account: () => BotCredentials | undefined;
	signal: () => AbortSignal | undefined;
	/** The peer's conversation state, for the wait decisions. */
	statusOf: (peer: string) => PeerState["status"];
	languageOf: (peer: string) => PeerLanguage;
	/** Send one stock line to the peer (chunked by the bridge). */
	send: (peer: string, contextToken: string | undefined, text: string) => Promise<unknown>;
	/** A forwarded dialog is waiting; its own reminder covers the wait. */
	/** Whether that peer is waiting on a dialog, so "still working" would be noise. */
	promptPending: (peer: string) => boolean;
}

/** One message a notice refers to. */
export interface PresenceTarget {
	peer: string;
	contextToken?: string;
}

export interface Presence {
	/** Start (or restart) the indicator and keep it alive while the peer waits. */
	keepTyping(peer: string, contextToken: string | undefined): void;
	/** Turn the indicator off once a turn settles. */
	typingOff(peer: string): Promise<void>;
	/** Stop the keep-alive for peers with nothing left to answer. */
	pruneTyping(): void;
	/** Stop one peer's keep-alive without touching the indicator. */
	stopTyping(peer: string): void;
	/** Tell a queued peer once that their message is waiting. */
	armAck(target: PresenceTarget): void;
	cancelAck(peer: string): void;
	/** Say once that this turn is taking a while. */
	armSlowNotice(peer: string, contextToken: string | undefined): void;
	/** Say once why a message is still waiting behind another turn. */
	armBusyNotice(peer: string, contextToken: string | undefined): void;
	stopSlowNotice(peer: string): void;
	stopBusyNotice(peer: string): void;
	/** Drop every timer and cached ticket (a new connection or a shutdown). */
	reset(): void;
}

export function createPresence(deps: PresenceDeps): Presence {
	const typingCache = new Map<string, { ticket?: string; checkedAt: number }>();
	/** Per-peer keep-alive cancellers for the typing indicator. */
	const typing = createTimerMap(deps.armTimer);
	/** Per-peer pending acknowledgement timers. */
	const acks = createTimerMap(deps.armTimer);
	/** When each peer was last acknowledged, so a chatty peer is not spammed. */
	const ackedAt = new Map<string, number>();
	/** Peers told that a turn is still running, until that turn ends. */
	const busyNotified = new Set<string>();
	/** Per-peer `busy` and `stillWorking` timers. */
	const busyTimers = createTimerMap(deps.armTimer);
	const slowTimers = createTimerMap(deps.armTimer);

	const hasWork = (peer: string): boolean => deps.statusOf(peer) !== "idle";
	const isRunning = (peer: string): boolean => deps.statusOf(peer) === "running";

	/** The typing ticket for a peer, fetched on first use and cached. */
	async function typingTicket(peer: string, contextToken: string | undefined): Promise<string | undefined> {
		const cached = typingCache.get(peer);
		const now = deps.now();
		if (cached && now - cached.checkedAt < TYPING_TTL_MS) return cached.ticket;
		const client = deps.client();
		const account = deps.account();
		if (!client || !account) return undefined;
		try {
			const response = await client.getConfig(account, { ilinkUserId: peer, contextToken }, deps.signal());
			typingCache.set(peer, { ticket: response?.typingTicket, checkedAt: now });
			return response?.typingTicket;
		} catch {
			typingCache.set(peer, { ticket: undefined, checkedAt: now });
			return undefined;
		}
	}

	async function typingOn(peer: string, contextToken: string | undefined): Promise<void> {
		const client = deps.client();
		const account = deps.account();
		if (!deps.typingIndicator() || !client || !account) return;
		const ticket = await typingTicket(peer, contextToken);
		if (!ticket) return;
		try {
			await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: true }, deps.signal());
			// The peer's work may have finished while the ticket round-trip was in
			// flight; cancel immediately so the indicator cannot get stuck on.
			if (!hasWork(peer)) {
				await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: false }, deps.signal());
			}
		} catch {
			// Typing is best-effort.
		}
	}

	async function typingOff(peer: string): Promise<void> {
		const client = deps.client();
		const account = deps.account();
		if (!deps.typingIndicator() || !client || !account) return;
		const ticket = typingCache.get(peer)?.ticket;
		if (!ticket) return;
		try {
			await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: false }, deps.signal());
		} catch {
			// Typing is best-effort.
		}
	}

	function stopTyping(peer: string): void {
		typing.stop(peer);
	}

	/**
	 * Start the typing indicator for a peer and keep it alive while they wait.
	 * The chat window is the peer's only channel, and WeChat drops the indicator
	 * after a few seconds, so a long turn needs the refresh to look alive at all.
	 */
	function keepTyping(peer: string, contextToken: string | undefined): void {
		if (!deps.typingIndicator()) return;
		stopTyping(peer);
		void typingOn(peer, contextToken);
		const started = deps.now();
		const refresh = (): void => {
			if (!hasWork(peer) || deps.now() - started >= TYPING_LIMIT_MS) {
				typing.stop(peer);
				return;
			}
			void typingOn(peer, contextToken);
			typing.arm(peer, TYPING_KEEPALIVE_MS, refresh);
		};
		typing.arm(peer, TYPING_KEEPALIVE_MS, refresh);
	}

	function stopSlowNotice(peer: string): void {
		slowTimers.stop(peer);
	}

	function stopBusyNotice(peer: string): void {
		busyTimers.stop(peer);
		busyNotified.delete(peer);
	}

	function armSlowNotice(peer: string, contextToken: string | undefined): void {
		slowTimers.arm(peer, TURN_NOTICE_MS, () => {
			if (!isRunning(peer)) return;
			// A turn waiting on an unanswered dialog is not "still working": the
			// prompt itself nudges, and saying both reads as noise.
			if (deps.promptPending(peer)) return;
			void deps.send(peer, contextToken, notice("stillWorking", deps.languageOf(peer)));
		});
	}

	function armBusyNotice(peer: string, contextToken: string | undefined): void {
		if (busyNotified.has(peer) || busyTimers.has(peer)) return;
		busyTimers.arm(peer, BUSY_NOTICE_MS, () => {
			if (!hasWork(peer) || busyNotified.has(peer)) return;
			busyNotified.add(peer);
			void deps.send(peer, contextToken, notice("busy", deps.languageOf(peer)));
		});
	}

	function cancelAck(peer: string): void {
		acks.stop(peer);
	}

	/**
	 * Tell a queued peer, once, that their message is waiting. A turn that starts
	 * within {@link ACK_DELAY_MS} cancels this, because the typing indicator says
	 * the same thing without spending a bubble.
	 */
	function armAck(target: PresenceTarget): void {
		// A message can be queued behind a running turn; it still gets one
		// acknowledgement after the delay, but not one per message.
		if (acks.has(target.peer)) return;
		const last = ackedAt.get(target.peer);
		if (last !== undefined && deps.now() - last < ACK_REPEAT_MS) return;
		acks.arm(target.peer, ACK_DELAY_MS, () => {
			if (!hasWork(target.peer)) return;
			ackedAt.set(target.peer, deps.now());
			void deps.send(target.peer, target.contextToken, notice("ack", deps.languageOf(target.peer)));
			// Still waiting after a minute behind another turn: say why.
			armBusyNotice(target.peer, target.contextToken);
		});
	}

	return {
		keepTyping,
		typingOff,
		pruneTyping() {
			for (const peer of typing.keys()) {
				if (!hasWork(peer)) typing.stop(peer);
			}
		},
		armAck,
		cancelAck,
		armSlowNotice,
		armBusyNotice,
		stopSlowNotice,
		stopBusyNotice,
		stopTyping,
		reset() {
			typing.clear();
			acks.clear();
			busyTimers.clear();
			slowTimers.clear();
			typingCache.clear();
			ackedAt.clear();
			busyNotified.clear();
		},
	};
}
