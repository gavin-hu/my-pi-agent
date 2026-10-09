/**
 * The bridge: long-poll WeChat, inject inbound text as a user turn, and send the
 * assistant's reply back.
 *
 * The live Pi session is the agent, so this is a thin loop. Because injected
 * messages carry no correlation id, the bridge serializes its own turns: it
 * records the peer when it injects, captures the final assistant text of that
 * run, and flushes the reply on `agent_settled` before draining the queue.
 */

import { isSessionExpired, WechatError, type WechatClient } from "./client.ts";
import { chunkText, sanitizeInbound } from "./format.ts";
import { defaultSleep } from "./login.ts";
import { recordInbound } from "./state.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { WechatConfig } from "./config.ts";

const BACKOFF_MS = 2000;

/** Extract the text of a user message, or `""` when it has none. */
export function messageText(message: WeixinMessage): string {
	for (const item of message.item_list ?? []) {
		if (item.type === 1 && typeof item.text_item?.text === "string") return item.text_item.text;
	}
	return "";
}

/** Extract the concatenated text blocks of an assistant message. */
export function assistantText(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return undefined;
	const parts: string[] = [];
	for (const block of candidate.content) {
		if (!block || typeof block !== "object") continue;
		const typed = block as { type?: unknown; text?: unknown };
		if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
	}
	return parts.join("\n");
}

/** Whether `peer` may drive the agent: the owner, or an explicit extra. */
export function isAllowedPeer(peer: string, owner: string | undefined, allowedPeers: string[]): boolean {
	return peer === owner || allowedPeers.includes(peer);
}

/** True when a message is inbound from a human (not the bot's own echo). */
export function isInboundMessage(message: WeixinMessage): boolean {
	return message.message_type !== 2 && typeof message.from_user_id === "string" && message.from_user_id !== "";
}

export interface BridgeDeps {
	config: WechatConfig;
	now: () => number;
	/** Whether the live session has no active run. Defaults to always idle. */
	isIdle?: () => boolean;
	/** Inject a user turn into the live session. */
	sendUserMessage: (text: string) => void;
	loadAccount: () => BotCredentials | undefined;
	loadState: () => WechatState;
	saveState: (state: WechatState) => void;
	createClient: (account: BotCredentials) => WechatClient;
	acquireLock: () => boolean;
	refreshLock: () => void;
	releaseLock: () => void;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Called when the server reports an expired token. */
	onExpired?: () => void;
}

export interface BridgeStatus {
	open: boolean;
	owner?: string;
	peerCount: number;
	queued: number;
	refused: number;
}

export interface Bridge {
	open(): void;
	close(): Promise<void>;
	shutdown(): Promise<void>;
	setBusy(busy: boolean): void;
	capture(message: unknown): void;
	settle(): void;
	status(): BridgeStatus;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Create the bridge over an injected environment. */
export function createBridge(deps: BridgeDeps): Bridge {
	const sleep = deps.sleep ?? defaultSleep;
	let running = false;
	let busy = false;
	let abort: AbortController | undefined;
	let loopPromise: Promise<void> | undefined;
	let client: WechatClient | undefined;
	let account: BotCredentials | undefined;
	let state: WechatState = { cursor: "", peers: {} };
	let queue: InboundItem[] = [];
	let active: InboundItem | undefined;
	let lastText = "";
	let refused = 0;

	const isIdle = deps.isIdle ?? (() => true);

	function notify(message: string, kind: "info" | "warning" | "error" = "info"): void {
		deps.notify?.(message, kind);
	}

	function handleExpired(): void {
		running = false;
		deps.onExpired?.();
		notify("WeChat session expired. Run /wechat login again.", "warning");
	}

	async function reply(item: InboundItem, text: string): Promise<void> {
		if (!client || !account) return;
		for (const chunk of chunkText(text, deps.config.maxReplyChars)) {
			try {
				const response = await client.sendMessage(
					account,
					{ to: item.peer, text: chunk, contextToken: item.contextToken },
					abort?.signal,
				);
				if (isSessionExpired(response)) {
					handleExpired();
					return;
				}
			} catch (error) {
				if (abort?.signal.aborted) return;
				notify(`WeChat reply failed: ${messageOf(error)}`, "warning");
				return;
			}
		}
	}

	function pump(): void {
		if (!running || busy || active || !isIdle()) return;
		const item = queue.shift();
		if (!item) return;
		active = item;
		lastText = "";
		try {
			deps.sendUserMessage(item.text);
		} catch (error) {
			active = undefined;
			notify(`WeChat could not start a turn: ${messageOf(error)}`, "error");
			pump();
		}
	}

	function handleMessage(message: WeixinMessage): void {
		if (!isInboundMessage(message)) return;
		const peer = message.from_user_id as string;
		const owner = state.ownerId ?? account?.ilinkUserId;
		if (!isAllowedPeer(peer, owner, deps.config.allowedPeers)) {
			refused += 1;
			return;
		}
		const text = sanitizeInbound(messageText(message));
		if (!text) return;
		recordInbound(state, peer, message.context_token, deps.now());
		deps.saveState(state);
		queue.push({
			peer,
			contextToken: message.context_token ?? state.peers[peer]?.lastContextToken,
			text,
		});
		pump();
	}

	async function loop(signal: AbortSignal): Promise<void> {
		while (running && !signal.aborted) {
			let response;
			try {
				response = await client?.getUpdates(account as BotCredentials, state.cursor, signal);
			} catch (error) {
				if (signal.aborted || !running) break;
				notify(`WeChat poll failed: ${messageOf(error)}`, "warning");
				try {
					await sleep(BACKOFF_MS, signal);
				} catch {
					break;
				}
				continue;
			}
			if (!response) break;
			if (isSessionExpired(response)) {
				handleExpired();
				return;
			}
			if (response.buf && response.buf !== state.cursor) {
				state.cursor = response.buf;
				deps.saveState(state);
			}
			for (const message of response.msgs) handleMessage(message);
			deps.refreshLock();
		}
	}

	function releaseSafe(): void {
		try {
			deps.releaseLock();
		} catch {
			// The lock is advisory and stale locks are taken over.
		}
	}

	return {
		open(): void {
			if (running) return;
			const loaded = deps.loadAccount();
			if (!loaded) throw new WechatError("Not logged in. Run /wechat login first.");
			if (!deps.acquireLock()) {
				throw new WechatError("Another Pi session is already polling this WeChat account.");
			}
			account = loaded;
			client = deps.createClient(loaded);
			state = deps.loadState();
			if (!state.ownerId) {
				state.ownerId = loaded.ilinkUserId;
				deps.saveState(state);
			}
			running = true;
			queue = [];
			active = undefined;
			lastText = "";
			abort = new AbortController();
			loopPromise = loop(abort.signal).catch((error) => {
				notify(`WeChat bridge stopped: ${messageOf(error)}`, "error");
			});
		},

		async close(): Promise<void> {
			if (!running && !abort) {
				releaseSafe();
				return;
			}
			running = false;
			abort?.abort();
			abort = undefined;
			try {
				await loopPromise;
			} catch {
				// Errors are surfaced by the loop's own catch.
			}
			loopPromise = undefined;
			queue = [];
			active = undefined;
			lastText = "";
			releaseSafe();
		},

		async shutdown(): Promise<void> {
			await this.close();
		},

		setBusy(value: boolean): void {
			busy = value;
		},

		capture(message: unknown): void {
			if (!active) return;
			const text = assistantText(message);
			if (text !== undefined) lastText = text;
		},

		settle(): void {
			busy = false;
			const item = active;
			const text = lastText;
			active = undefined;
			lastText = "";
			if (item && text) {
				void reply(item, text).finally(() => pump());
			} else {
				pump();
			}
		},

		status(): BridgeStatus {
			return {
				open: running,
				owner: state.ownerId ?? account?.ilinkUserId,
				peerCount: Object.keys(state.peers).length,
				queued: queue.length,
				refused,
			};
		},
	};
}
