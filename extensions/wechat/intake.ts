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

import type { AdmissionQueue, TurnBudget } from "./conversation/admission.ts";
import type { TurnRunner } from "./conversation/turn.ts";
import type { Presence } from "./conversation/presence.ts";
import type { WechatInteractionChannel } from "./dialog/interaction.ts";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { ownerRecord, recordInbound, rememberMessage, seenMessage } from "./state/state.ts";
import { codePointSlice, parseInbound, peerKey, peerLabel, peerLanguage, type PeerLanguage } from "./text/format.ts";
import { notice } from "./text/notices.ts";
import { resolveSlash, slashControls, type SlashCommand, type SlashContext } from "./commands/slash.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { MessageTarget } from "./transport/deliver.ts";
import type { WechatConfig } from "./config.ts";

/**
 * Whether `peer` may drive the agent: the account's owner, and nobody else. Either
 * id form is accepted (with or without `@im.wechat`), so a label copied from the
 * control screen is not silently refused.
 */
export function isAccountOwner(peer: string, owner: string | undefined): boolean {
	return owner !== undefined && peerKey(owner) === peerKey(peer);
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

/** Drop the cached reply token, so the next inbound message replaces it. */
export function createForgetToken(deps: {
	state: () => WechatState;
	saveState: (state: WechatState) => void;
}): () => void {
	return () => {
		const state = deps.state();
		if (!state.owner?.lastContextToken) return;
		delete state.owner.lastContextToken;
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
	worker: () => TurnRunner | undefined;
	/** Stop the running turn, and the dialog that turn was waiting on with it. */
	stopTurn: () => boolean;
	/** The chat's one interaction channel: a reply answers its prompt, a command names it. */
	channel: () => WechatInteractionChannel | undefined;
	presence: Presence;
	budget: TurnBudget;
	admission: AdmissionQueue;
	languageOf: (peer: string, text?: string) => PeerLanguage;
	/** Send one bubble to a peer for the bridge's own notices. */
	reply: (target: MessageTarget, text: string) => Promise<boolean>;
	readHistory: (count: number, lang?: PeerLanguage) => Promise<string>;
	/** Whether plan mode is on for this session, for `/status`; the branch's flag. */
	planMode: () => boolean;
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
	const { config, channel, presence, budget, admission, languageOf, notify } = deps;

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
			activeTurn: worker?.state().status === "running",
			language: languageOf(target.peer),
			session: slashControls(target.peer, {
				state: () => worker?.state() ?? { status: "idle", queued: 0 },
				prompt: () => channel()?.pendingInfo()?.title,
				stop: () => deps.stopTurn(),
				// The channel is the one that withdraws, because a withdrawal is a turn's
				// bubble and not a bridge notice: it flushes the answer so far, then settles
				// the dialog cancelled under the turn that asked it.
				cancel: () => {
					const pending = channel();
					if (pending?.hasPending() !== true) return false;
					void pending.cancel();
					return true;
				},
				history: (_peer, count) => deps.readHistory(count, languageOf(target.peer)),
				planMode: () => deps.planMode(),
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
		if (!isAccountOwner(peer, owner)) {
			deps.refused.value += 1;
			const label = peerLabel(peer);
			// Name a new sender once, so the terminal can show who knocked; the cap
			// keeps a spam run from filling the list.
			if (deps.refusedPeers.size < REFUSED_LABEL_CAP && !deps.refusedPeers.has(label)) {
				deps.refusedPeers.add(label);
				notify(
					`WeChat refused a message from ${sanitizeLine(label)}: only the account's owner is answered.`,
					"warning",
				);
			}
			return;
		}
		// A server replay of an already handled message must not answer twice. The
		// id is persisted, so a reload or reconnect cannot resurrect it.
		const messageId = message.message_id;
		if (typeof messageId === "number" && messageId !== 0 && seenMessage(state, messageId)) return;

		let text = rawText;
		const cap = config.maxInboundChars;
		if (text.length > cap) {
			// Counted and cut in code points: a unit count over-reports astral text and
			// a unit cut can split a pair, so the note would name a character it broke.
			const { slice, total } = codePointSlice(text, cap);
			if (total > cap) {
				text = `${slice}\n[WeChat message truncated: showing ${cap} of ${total} characters]`;
				notify(`WeChat message truncated to ${cap} characters.`, "warning");
			}
		}

		const now = deps.now();
		recordInbound(state, message.context_token, now);
		if (typeof messageId === "number" && messageId !== 0) rememberMessage(state, messageId, now);
		// Every outcome but a hand-off is final inside this call, so it is written down before
		// the return. A queued message is written by the hand-off instead, because marking it
		// seen before the media download would make a kill unrecoverable: the cursor would not
		// replay it and the seen id would refuse it.
		const commit = () => deps.saveState(state);

		const target = { peer, contextToken: message.context_token ?? ownerRecord(state)?.lastContextToken };
		// A command is not an answer: while a dialog waits the model is blocked on it,
		// so /stop, /cancel and /status must reach their handlers or the peer's only way
		// out is the prompt timing out. A message with media is never a command, and an
		// unknown command falls through to the model as ordinary text.
		const command = media.length === 0 ? resolveSlash(deps.slashCommands, text) : undefined;
		if (command) {
			void runSlashAction(command.command, target, command.args);
			commit();
			return;
		}
		// A reply to a pending prompt is consumed here, before queueing, so it never
		// starts a turn of its own. A duplicate answer was stopped by the id check.
		if (channel()?.handleInbound(text) === true) {
			commit();
			return;
		}
		const language = languageOf(peer, text);
		const item: InboundItem = { ...target, text, media, language };
		if (!text && media.length === 0) {
			// Nothing to read. A voice note without a transcript or a video is
			// answered, so the peer knows it did not reach the agent.
			if (unsupported > 0) void deps.reply(item, notice("unsupported", language));
			commit();
			return;
		}
		// A slot is reserved here, before the download, so a burst of media cannot
		// all pass the check and then enqueue together.
		if (!budget.allow()) {
			void deps.reply(item, notice("budget", language));
			commit();
			return;
		}
		const busy = (worker?.state().queued ?? 0) + admission.pending();
		if (busy >= MAX_QUEUE) {
			// Refuse rather than grow without bound; one notice per episode, not per
			// dropped message.
			if (!deps.overflow.has(peer)) {
				deps.overflow.add(peer);
				void deps.reply(item, notice("overflow", language));
			}
			commit();
			return;
		}
		presence.keepTyping(item.contextToken);
		presence.armAck(item.contextToken);
		admission.enqueue(item);
	}

	return { handleMessage };
}
