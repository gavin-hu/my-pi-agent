/**
 * Inbound messages: admission, the slash commands a message may carry, and the hand-off to
 * the sender's own session.
 *
 * This is the path a message takes from the poll loop to a turn, and it is the one part of
 * the bridge that is a *sequence of decisions* rather than wiring: who is refused, what is
 * a replay, what is a command, what is an answer to a pending prompt, and what is queued or
 * turned away. The bridge keeps the connection lifecycle and the status snapshot; it hands
 * this module the live state it reads, and nothing here touches the client or the lock.
 *
 * Every dependency whose value changes across a connection is a function, because a
 * reconnect replaces the account, the state, and the worker rather than mutating them.
 */

import type { AdmissionQueue, TurnBudget } from "./peer/admission.ts";
import type { PeerWorker } from "./peer/peer-worker.ts";
import type { Presence } from "./peer/presence.ts";
import type { PeerChannels } from "./dialog/channels.ts";
import { messageOf } from "./errors.ts";
import { findPeer, recordInbound, rememberMessage, seenMessage } from "./state/state.ts";
import { parseInbound, peerKey, peerLabel, peerLanguage, type PeerLanguage } from "./text/format.ts";
import { notice } from "./text/notices.ts";
import {
	expandSnippet,
	findSlashCommand,
	parseSlash,
	slashControls,
	type SlashCommand,
	type SlashContext,
} from "./commands/slash.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { MessageTarget } from "./transport/deliver.ts";
import type { WechatConfig } from "./config.ts";

/**
 * Whether `peer` may drive the agent: the owner, or an explicit extra. Either id
 * form is accepted (with or without `@im.wechat`), so a label copied from the
 * control screen is not silently refused.
 */
export function isAllowedPeer(peer: string, owner: string | undefined, allowedPeers: string[]): boolean {
	const key = peerKey(peer);
	if (owner !== undefined && peerKey(owner) === key) return true;
	return allowedPeers.some((allowed) => peerKey(allowed) === key);
}

/** True when a message is inbound from a human (not the bot's own echo). */
export function isInboundMessage(message: WeixinMessage): message is WeixinMessage & { from_user_id: string } {
	return message.message_type !== 2 && typeof message.from_user_id === "string" && message.from_user_id !== "";
}

/** Inbound messages held while a turn runs; beyond this the peer is told to wait. */
export const MAX_QUEUE = 8;

/** Senders refused since the connection opened, capped so a spam run cannot fill the list. */
const REFUSED_LABEL_CAP = 5;

/**
 * The peer's language: from this text, else the last one they wrote.
 *
 * A Chinese message is evidence of Chinese. Its absence is not evidence of English, or a
 * short reply ("ok", "1") would flip an established conversation back; English is the
 * fallback, so it needs no record of its own.
 */
export function createLanguageOf(languages: Map<string, PeerLanguage>): (peer: string, text?: string) => PeerLanguage {
	return (peer, text) => {
		if (text && peerLanguage(text) === "zh") languages.set(peer, "zh");
		return languages.get(peer) ?? "en";
	};
}

/** Drop a peer's cached reply token, so the next inbound message replaces it. */
export function createForgetToken(deps: {
	state: () => WechatState;
	saveState: (state: WechatState) => void;
}): (peer: string) => void {
	return (peer) => {
		const state = deps.state();
		const entry = findPeer(state, peer);
		if (!entry?.lastContextToken) return;
		delete entry.lastContextToken;
		deps.saveState(state);
	};
}

/** A counter two modules share: this one bumps it, the status snapshot reads it. */
export interface Counter {
	value: number;
}

/** Everything the inbound path reads, as the bridge hands it in. */
export interface IntakeDeps {
	/** The live state: replaced when a re-login changes the owner. */
	state: () => WechatState;
	saveState: (state: WechatState) => void;
	/** The live account, for the owner a message is compared against. */
	account: () => BotCredentials | undefined;
	config: WechatConfig;
	now: () => number;
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
	/** The live worker: a connect or disconnect replaces it. */
	worker: () => PeerWorker | undefined;
	channels: PeerChannels;
	presence: Presence;
	budget: TurnBudget;
	admission: AdmissionQueue;
	languageOf: (peer: string, text?: string) => PeerLanguage;
	/** Send one bubble to a peer for the bridge's own notices. */
	reply: (target: MessageTarget, text: string) => Promise<boolean>;
	readHistory: (peer: string, count: number) => Promise<string>;
	/** Senders refused since the connection opened, and their labels. */
	refused: Counter;
	refusedPeers: Set<string>;
	/** Peers already told the queue is full, until it drains. */
	overflow: Set<string>;
	slashCommands: readonly SlashCommand[];
}

/**
 * The inbound path: one function per message, with the command runner and the language
 * lookup it needs beside it.
 */
export function createIntake(deps: IntakeDeps): { handleMessage: (message: WeixinMessage) => void } {
	const { config, channels, presence, budget, admission, languageOf, notify } = deps;

	/** Run a slash action out-of-band and reply to the sender; never starts a turn. */
	async function runSlashAction(command: SlashCommand, target: MessageTarget, args: string): Promise<void> {
		if (!command.run) return;
		const worker = deps.worker();
		const ctx: SlashContext = {
			args,
			peer: target.peer,
			reply: async (text) => {
				await deps.reply(target, text);
			},
			activeTurn: worker?.state(target.peer).status === "running",
			language: languageOf(target.peer),
			session: slashControls(target.peer, {
				state: (peer) => worker?.state(peer) ?? { status: "idle", queued: 0 },
				prompt: (peer) => channels.pendingFor(peer)?.title,
				reset: (peer) => {
					worker?.reset(peer);
				},
				stop: (peer) => worker?.abort(peer) ?? false,
				history: (peer, count) => deps.readHistory(peer, count),
			}),
		};
		try {
			await command.run(ctx);
		} catch (error) {
			notify(`WeChat command /${command.name} failed: ${messageOf(error)}`, "warning");
			await deps.reply(target, `Command /${command.name} failed.`);
		}
	}

	function handleMessage(message: WeixinMessage): void {
		if (!isInboundMessage(message)) return;
		const state = deps.state();
		const worker = deps.worker();
		const peer = message.from_user_id;
		const { text: rawText, media, unsupported } = parseInbound(message.item_list);
		const owner = state.ownerId ?? deps.account()?.ilinkUserId;
		// Admission comes first: a refused sender never reaches the state file, a
		// pending prompt, or the queue.
		if (!isAllowedPeer(peer, owner, config.allowedPeers)) {
			deps.refused.value += 1;
			const label = peerLabel(peer);
			// Name a new sender once, so the operator can allowlist it from the
			// terminal; the cap keeps a spam run from filling the list.
			if (deps.refusedPeers.size < REFUSED_LABEL_CAP && !deps.refusedPeers.has(label)) {
				deps.refusedPeers.add(label);
				notify(`WeChat refused a message from ${label}. Add it to allowedPeers to admit.`, "warning");
			}
			return;
		}
		// A server replay of an already handled message must not answer twice. The
		// id is persisted, so a reload or reconnect cannot resurrect it.
		const messageId = message.message_id;
		if (typeof messageId === "number" && messageId !== 0 && seenMessage(state, peer, messageId)) return;

		let text = rawText;
		const cap = config.maxInboundChars;
		if (text.length > cap) {
			const total = text.length;
			text = `${text.slice(0, cap)}\n[WeChat message truncated: showing ${cap} of ${total} characters]`;
			notify(`WeChat message truncated to ${cap} characters.`, "warning");
		}

		const now = deps.now();
		recordInbound(state, peer, message.context_token, now);
		if (typeof messageId === "number" && messageId !== 0) rememberMessage(state, peer, messageId, now);
		deps.saveState(state);

		const target = { peer, contextToken: message.context_token ?? findPeer(state, peer)?.lastContextToken };
		// A command is not an answer: while a dialog waits the model is blocked on it,
		// so /stop and /status must reach their handlers or the peer's only way out is
		// the prompt timing out. A message with media is never a command, and an
		// unknown command falls through to the model as ordinary text.
		const slash = media.length === 0 ? parseSlash(text) : undefined;
		const command = slash ? findSlashCommand(deps.slashCommands, slash.name) : undefined;
		if (command && slash) {
			if (command.ownerOnly && peerKey(peer) !== peerKey(owner ?? "")) {
				deps.refused.value += 1;
				return;
			}
			if (command.kind === "snippet") {
				text = expandSnippet(command, slash.args);
			} else {
				void runSlashAction(command, target, slash.args);
				return;
			}
		}
		// A reply to a pending prompt is consumed here, before queueing, so it never
		// starts a turn of its own. A duplicate answer was stopped by the id check.
		if (channels.handleInbound(peer, text)) return;
		const language = languageOf(peer, text);
		const item: InboundItem = { ...target, text, media, language };
		if (!text && media.length === 0) {
			// Nothing to read. A voice note without a transcript or a video is
			// answered, so the peer knows it did not reach the agent.
			if (unsupported > 0) void deps.reply(item, notice("unsupported", language));
			return;
		}
		// A slot is reserved here, before the download, so a burst of media cannot
		// all pass the check and then enqueue together.
		if (!budget.allow(peer)) {
			void deps.reply(item, notice("budget", language));
			return;
		}
		const busy = (worker?.state(peer).queued ?? 0) + admission.pending(peer);
		if (busy >= MAX_QUEUE) {
			// Refuse rather than grow without bound; one notice per episode, not per
			// dropped message.
			if (!deps.overflow.has(peer)) {
				deps.overflow.add(peer);
				void deps.reply(item, notice("overflow", language));
			}
			return;
		}
		presence.keepTyping(peer, item.contextToken);
		presence.armAck(item);
		admission.enqueue(item);
	}

	return { handleMessage };
}
