/**
 * The bridge: long-poll WeChat, inject inbound text and media as a user turn,
 * and send the assistant's reply back.
 *
 * The live Pi session is the agent, so this is a thin loop. Because injected
 * messages carry no correlation id, the bridge serializes its own turns: it
 * records the peer when it injects, captures the final assistant text of that
 * run, and flushes the reply on `agent_settled` before draining the queue.
 *
 * Inbound images are downloaded, decrypted, and injected as model image content;
 * inbound files are saved under the media directory and referenced by path. The
 * model may message the owner proactively through {@link Bridge.sendToOwner}.
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { isSessionExpired, WechatError, type WechatClient } from "./client.ts";
import { chunkText, parseInbound, sanitizeInbound } from "./format.ts";
import { createWechatInteractionChannel, type WechatInteractionChannel } from "./interaction.ts";
import { defaultSleep } from "./login.ts";
import { decodeMediaKey, decryptEcb, saveMedia, sniffImageMime } from "./media.ts";
import { recordInbound } from "./state.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { WechatConfig } from "./config.ts";

const BACKOFF_MS = 2000;
/** How long a fetched typing ticket is reused. */
const TYPING_TTL_MS = 5 * 60 * 1000;

/** Content the bridge injects: plain text or text/image blocks. */
export type UserContent = string | (TextContent | ImageContent)[];

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
	sendUserMessage: (content: UserContent) => void;
	/** Directory where inbound files are saved. */
	mediaDir: () => string;
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
	mediaDropped: number;
	/** Whether a remote dialog prompt is waiting for an answer. */
	promptPending: boolean;
}

export interface SendResult {
	ok: boolean;
	error?: string;
}

export interface Bridge {
	open(): void;
	close(): Promise<void>;
	shutdown(): Promise<void>;
	setBusy(busy: boolean): void;
	capture(message: unknown): void;
	settle(): void;
	status(): BridgeStatus;
	/** The remote interaction channel the UI adapter routes prompts through. */
	channel(): WechatInteractionChannel;
	/** Message the owner proactively. Owner-only and text-only by design. */
	sendToOwner(text: string): Promise<SendResult>;
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
	let mediaDropped = 0;
	let mediaCounter = 0;
	const typingCache = new Map<string, { ticket?: string; checkedAt: number }>();

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

	/** Send one prompt line to the peer that owns the in-flight turn. */
	async function sendPrompt(text: string, signal?: AbortSignal): Promise<boolean> {
		if (!client || !account || !active) return false;
		try {
			const response = await client.sendMessage(
				account,
				{ to: active.peer, text, contextToken: active.contextToken },
				signal ?? abort?.signal,
			);
			if (isSessionExpired(response)) {
				handleExpired();
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}

	const interaction = createWechatInteractionChannel({
		send: (text, signal) => sendPrompt(text, signal),
		activePeer: () => active?.peer,
	});

	/** The typing ticket for a peer, fetched on first use and cached. */
	async function typingTicket(peer: string, item: InboundItem): Promise<string | undefined> {
		const cached = typingCache.get(peer);
		const now = deps.now();
		if (cached && now - cached.checkedAt < TYPING_TTL_MS) return cached.ticket;
		try {
			const response = await client?.getConfig(
				account as BotCredentials,
				{ ilinkUserId: peer, contextToken: item.contextToken },
				abort?.signal,
			);
			typingCache.set(peer, { ticket: response?.typingTicket, checkedAt: now });
			return response?.typingTicket;
		} catch {
			typingCache.set(peer, { ticket: undefined, checkedAt: now });
			return undefined;
		}
	}

	async function typingOn(peer: string, item: InboundItem): Promise<void> {
		if (!deps.config.typingIndicator || !client || !account) return;
		const ticket = await typingTicket(peer, item);
		if (!ticket) return;
		try {
			await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: true }, abort?.signal);
			// The turn may have settled while the ticket round-trip was in flight;
			// cancel immediately so the indicator cannot get stuck on.
			if (active !== item) {
				await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: false }, abort?.signal);
			}
		} catch {
			// Typing is best-effort.
		}
	}

	async function typingOff(peer: string): Promise<void> {
		if (!deps.config.typingIndicator || !client || !account) return;
		const ticket = typingCache.get(peer)?.ticket;
		if (!ticket) return;
		try {
			await client.sendTyping(account, { ilinkUserId: peer, typingTicket: ticket, typing: false }, abort?.signal);
		} catch {
			// Typing is best-effort.
		}
	}

	/** Download, decrypt, and turn a media reference into a content block. */
	async function resolveMedia(item: InboundItem): Promise<(TextContent | ImageContent)[]> {
		const blocks: (TextContent | ImageContent)[] = [];
		for (const ref of item.media) {
			if (!client) return blocks;
			try {
				const cipher = await client.downloadCdn(ref.media, abort?.signal);
				if (cipher.byteLength > deps.config.maxMediaBytes) {
					mediaDropped += 1;
					notify(`WeChat media dropped: over ${deps.config.maxMediaBytes} bytes.`, "warning");
					continue;
				}
				if (ref.kind === "file") {
					if (!ref.media.aes_key) throw new Error("missing AES key");
					const plain = decryptEcb(cipher, decodeMediaKey(ref.media.aes_key));
					mediaCounter += 1;
					const path = saveMedia(deps.mediaDir(), `${deps.now()}-${mediaCounter}-${ref.fileName}`, plain);
					blocks.push({ type: "text", text: `[WeChat file: ${ref.fileName} saved to ${path}]` });
				} else {
					const key = ref.aeskey ?? ref.media.aes_key;
					const plain = key ? decryptEcb(cipher, decodeMediaKey(key)) : cipher;
					blocks.push({
						type: "image",
						data: Buffer.from(plain).toString("base64"),
						mimeType: sniffImageMime(plain),
					});
				}
			} catch (error) {
				mediaDropped += 1;
				notify(`WeChat media dropped: ${messageOf(error)}`, "warning");
			}
		}
		return blocks;
	}

	/** Resolve media, then inject the turn. `active` is set before any await. */
	async function inject(item: InboundItem): Promise<void> {
		let content: UserContent = item.text;
		if (item.media.length > 0) {
			const blocks = await resolveMedia(item);
			if (!running || active !== item) return;
			const parts: (TextContent | ImageContent)[] = [];
			if (item.text) parts.push({ type: "text", text: item.text });
			parts.push(...blocks);
			if (parts.length === 0) {
				active = undefined;
				pump();
				return;
			}
			content = parts;
		}
		try {
			deps.sendUserMessage(content);
		} catch (error) {
			active = undefined;
			notify(`WeChat could not start a turn: ${messageOf(error)}`, "error");
			pump();
		}
	}

	function pump(): void {
		if (!running || busy || active || !isIdle()) return;
		const item = queue.shift();
		if (!item) return;
		active = item;
		lastText = "";
		void typingOn(item.peer, item);
		void inject(item);
	}

	function handleMessage(message: WeixinMessage): void {
		if (!isInboundMessage(message)) return;
		const peer = message.from_user_id as string;
		const { text, media } = parseInbound(message.item_list);
		// A reply to a pending prompt is consumed here, before admission and
		// queueing, so it never starts a turn of its own.
		if (interaction.handleInbound(peer, text)) return;
		const owner = state.ownerId ?? account?.ilinkUserId;
		if (!isAllowedPeer(peer, owner, deps.config.allowedPeers)) {
			refused += 1;
			return;
		}
		if (!text && media.length === 0) return;
		recordInbound(state, peer, message.context_token, deps.now());
		deps.saveState(state);
		queue.push({
			peer,
			contextToken: message.context_token ?? state.peers[peer]?.lastContextToken,
			text,
			media,
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
			typingCache.clear();
			interaction.reset();
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
			interaction.reset();
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
			interaction.reset();
			if (item) {
				void (async () => {
					await typingOff(item.peer);
					if (text) await reply(item, text);
				})().finally(() => pump());
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
				mediaDropped,
				promptPending: interaction.hasPending(),
			};
		},

		channel(): WechatInteractionChannel {
			return interaction;
		},

		async sendToOwner(text: string): Promise<SendResult> {
			if (!running || !client || !account) return { ok: false, error: "WeChat bridge is not started." };
			const trimmed = sanitizeInbound(text);
			if (!trimmed) return { ok: false, error: "Nothing to send." };
			const owner = state.ownerId ?? account.ilinkUserId;
			const contextToken = state.peers[owner]?.lastContextToken;
			for (const chunk of chunkText(trimmed, deps.config.maxReplyChars)) {
				try {
					const response = await client.sendMessage(account, { to: owner, text: chunk, contextToken }, abort?.signal);
					if (isSessionExpired(response)) {
						handleExpired();
						return { ok: false, error: "WeChat session expired." };
					}
				} catch (error) {
					return { ok: false, error: messageOf(error) };
				}
			}
			return { ok: true };
		},
	};
}
