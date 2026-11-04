/**
 * The signals the chat sees while its message waits: the typing indicator, the
 * one delayed acknowledgement, the "still working" line, and the "queued behind
 * the running turn" line.
 *
 * They are grouped here because they share the same timer bookkeeping: every
 * signal is a cancellable timer, every one is cleared when the turn settles, and
 * a reconnect drops all of them at once. WeChat notifies per bubble, so each
 * notice is bounded to one per wait episode. There is one conversation, so there
 * is one slot per signal rather than a map keyed by sender.
 */

import type { BotCredentials } from "../types.ts";
import type { WechatClient } from "../transport/client.ts";
import type { TurnState } from "./turn.ts";
import type { PeerLanguage } from "../text/format.ts";
import { notice } from "../text/notices.ts";
import type { ArmTimer } from "../timer.ts";

/** How long a fetched typing ticket is reused. */
const TYPING_TTL_MS = 5 * 60 * 1000;
/** How often the typing indicator is refreshed while the chat waits. */
const TYPING_KEEPALIVE_MS = 10_000;
/** Stop refreshing the indicator after this long; a wedged turn must not tick forever. */
const TYPING_LIMIT_MS = 15 * 60 * 1000;
/** Wait this long before telling a queued chat that its message is queued. */
const ACK_DELAY_MS = 4000;
/** Suppress a second acknowledgement inside this window. */
const ACK_REPEAT_MS = 60_000;
/** Say the running turn is still going after this long without a reply. */
const TURN_NOTICE_MS = 30_000;
/** Say `busy` when a message is still queued behind the running turn after this. */
const BUSY_NOTICE_MS = 60_000;

export interface PresenceDeps {
	typingIndicator: () => boolean;
	now: () => number;
	armTimer: ArmTimer;
	client: () => WechatClient | undefined;
	account: () => BotCredentials | undefined;
	signal: () => AbortSignal | undefined;
	/** The conversation's state, for the wait decisions. */
	statusOf: () => TurnState["status"];
	languageOf: () => PeerLanguage;
	/** Send one stock line to the chat (chunked by the bridge). */
	send: (contextToken: string | undefined, text: string) => Promise<unknown>;
	/** Whether the chat is waiting on a dialog, so "still working" would be noise. */
	promptPending: () => boolean;
}

export interface Presence {
	/** Start (or restart) the indicator and keep it alive while the chat waits. */
	keepTyping(contextToken: string | undefined): void;
	/** Turn the indicator off once a turn settles. */
	typingOff(): Promise<void>;
	/** Stop the keep-alive when there is nothing left to answer. */
	pruneTyping(): void;
	/** Stop the keep-alive without touching the indicator. */
	stopTyping(): void;
	/** Tell the chat once that its message is waiting. */
	armAck(contextToken: string | undefined): void;
	cancelAck(): void;
	/** Say once that this turn is taking a while. */
	armSlowNotice(contextToken: string | undefined): void;
	/** Say once why a message is still waiting behind another turn. */
	armBusyNotice(contextToken: string | undefined): void;
	stopSlowNotice(): void;
	stopBusyNotice(): void;
	/** Drop every timer and cached ticket (a new connection or a shutdown). */
	reset(): void;
}

export function createPresence(deps: PresenceDeps): Presence {
	/** The cached typing ticket, fetched on first use and reused for its lifetime. */
	let typingTicket: { ticket?: string; checkedAt: number } | undefined;
	const typing = { cancel: undefined as (() => void) | undefined };
	const ack = { cancel: undefined as (() => void) | undefined };
	const busy = { cancel: undefined as (() => void) | undefined };
	const slow = { cancel: undefined as (() => void) | undefined };
	/** When the chat was last acknowledged, so a chatty sender is not spammed. */
	let ackedAt: number | undefined;
	/** Whether the chat was told the turn is still running, until that turn ends. */
	let busyNotified = false;

	const hasWork = (): boolean => deps.statusOf() !== "idle";
	const isRunning = (): boolean => deps.statusOf() === "running";

	/** The typing ticket, fetched on first use and cached. */
	async function typingTicketFor(contextToken: string | undefined): Promise<string | undefined> {
		const now = deps.now();
		if (typingTicket && now - typingTicket.checkedAt < TYPING_TTL_MS) return typingTicket.ticket;
		const client = deps.client();
		const account = deps.account();
		if (!client || !account) return undefined;
		try {
			const response = await client.getConfig(account, { ilinkUserId: chatPeer(), contextToken }, deps.signal());
			typingTicket = { ticket: response?.typingTicket, checkedAt: now };
			return response?.typingTicket;
		} catch {
			typingTicket = { ticket: undefined, checkedAt: now };
			return undefined;
		}
	}

	/** The sender whose chat this is: the stored account's owner. */
	function chatPeer(): string {
		return deps.account()?.ilinkUserId ?? "";
	}

	async function typingOn(contextToken: string | undefined): Promise<void> {
		const client = deps.client();
		const account = deps.account();
		if (!deps.typingIndicator() || !client || !account) return;
		const ticket = await typingTicketFor(contextToken);
		if (!ticket) return;
		const request = { ilinkUserId: chatPeer(), typingTicket: ticket };
		try {
			await client.sendTyping(account, { ...request, typing: true }, deps.signal());
			// The work may have finished while the ticket round-trip was in flight;
			// cancel immediately so the indicator cannot get stuck on.
			if (!hasWork()) await client.sendTyping(account, { ...request, typing: false }, deps.signal());
		} catch {
			// Typing is best-effort.
		}
	}

	async function typingOff(): Promise<void> {
		const client = deps.client();
		const account = deps.account();
		if (!deps.typingIndicator() || !client || !account) return;
		const ticket = typingTicket?.ticket;
		if (!ticket) return;
		try {
			await client.sendTyping(account, { ilinkUserId: chatPeer(), typingTicket: ticket, typing: false }, deps.signal());
		} catch {
			// Typing is best-effort.
		}
	}

	function stopTyping(): void {
		typing.cancel?.();
		typing.cancel = undefined;
	}

	/**
	 * Start the typing indicator and keep it alive while the chat waits. The chat
	 * window is the only channel, and WeChat drops the indicator after a few
	 * seconds, so a long turn needs the refresh to look alive at all.
	 */
	function keepTyping(contextToken: string | undefined): void {
		if (!deps.typingIndicator()) return;
		stopTyping();
		void typingOn(contextToken);
		const started = deps.now();
		const refresh = (): void => {
			if (!hasWork() || deps.now() - started >= TYPING_LIMIT_MS) {
				stopTyping();
				return;
			}
			void typingOn(contextToken);
			typing.cancel = deps.armTimer(TYPING_KEEPALIVE_MS, refresh);
		};
		typing.cancel = deps.armTimer(TYPING_KEEPALIVE_MS, refresh);
	}

	function stopSlowNotice(): void {
		slow.cancel?.();
		slow.cancel = undefined;
	}

	function stopBusyNotice(): void {
		busy.cancel?.();
		busy.cancel = undefined;
		busyNotified = false;
	}

	function armSlowNotice(contextToken: string | undefined): void {
		stopSlowNotice();
		slow.cancel = deps.armTimer(TURN_NOTICE_MS, () => {
			slow.cancel = undefined;
			if (!isRunning()) return;
			// A turn waiting on an unanswered dialog is not "still working": the prompt
			// itself nudges, and saying both reads as noise.
			if (deps.promptPending()) return;
			void deps.send(contextToken, notice("stillWorking", deps.languageOf()));
		});
	}

	function armBusyNotice(contextToken: string | undefined): void {
		if (busyNotified || busy.cancel) return;
		busy.cancel = deps.armTimer(BUSY_NOTICE_MS, () => {
			busy.cancel = undefined;
			if (!hasWork() || busyNotified) return;
			busyNotified = true;
			void deps.send(contextToken, notice("busy", deps.languageOf()));
		});
	}

	function cancelAck(): void {
		ack.cancel?.();
		ack.cancel = undefined;
	}

	/**
	 * Tell the chat, once, that its message is waiting. A turn that starts within
	 * {@link ACK_DELAY_MS} cancels this, because the typing indicator says the same
	 * thing without spending a bubble.
	 */
	function armAck(contextToken: string | undefined): void {
		if (ack.cancel) return;
		if (ackedAt !== undefined && deps.now() - ackedAt < ACK_REPEAT_MS) return;
		ack.cancel = deps.armTimer(ACK_DELAY_MS, () => {
			ack.cancel = undefined;
			if (!hasWork()) return;
			ackedAt = deps.now();
			void deps.send(contextToken, notice("ack", deps.languageOf()));
			// Still waiting after a minute behind the running turn: say why.
			armBusyNotice(contextToken);
		});
	}

	return {
		keepTyping,
		typingOff,
		pruneTyping() {
			if (!hasWork()) stopTyping();
		},
		armAck,
		cancelAck,
		armSlowNotice,
		armBusyNotice,
		stopSlowNotice,
		stopBusyNotice,
		stopTyping,
		reset() {
			stopTyping();
			cancelAck();
			stopBusyNotice();
			stopSlowNotice();
			typingTicket = undefined;
			ackedAt = undefined;
			busyNotified = false;
		},
	};
}
