/**
 * The bridge: long-poll WeChat, inject inbound text and media as a user turn,
 * and send the assistant's reply back.
 *
 * The live Pi session is the agent, so this is a thin loop. Because injected
 * messages carry no correlation id, the bridge serializes its own turns: it
 * records the peer when it injects, captures the final assistant text of that
 * run, and flushes the reply on `agent_settled` before draining the queue.
 *
 * The peer only has the chat window, so the bridge also carries the signals the
 * phone needs: the typing indicator starts when a message is *queued* and is
 * refreshed while the turn runs, a delayed acknowledgement covers a long wait,
 * a burst of messages becomes one turn, and every forced outcome (a stopped
 * turn, a queue overflow, a failed injection) answers in one short line.
 *
 * Inbound images are downloaded, decrypted, and injected as model image content;
 * inbound files are saved under the media directory and referenced by path. The
 * model may message the owner proactively through {@link Bridge.sendToOwner}.
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { isSessionExpired, WechatError, type WechatClient } from "./client.ts";
import {
	chunkText,
	notice,
	parseInbound,
	peerKey,
	peerLabel,
	peerLanguage,
	sanitizeInbound,
	toWechatText,
	type PeerLanguage,
} from "./format.ts";
import { createWechatInteractionChannel, type WechatInteractionChannel } from "./interaction.ts";
import { defaultSleep } from "./login.ts";
import { sendLocalFile } from "./outbound.ts";
import { decodeMediaKey, decryptEcb, saveMedia, sniffImageMime } from "./media.ts";
import { emptyState, recordInbound } from "./state.ts";
import {
	expandSnippet,
	findSlashCommand,
	parseSlash,
	SLASH_COMMANDS,
	type SlashCommand,
	type SlashContext,
	type SlashSessionControls,
} from "./slash.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { WechatConfig } from "./config.ts";
import { defaultTimer, type ArmTimer } from "./timer.ts";

const BACKOFF_MS = 2000;
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
/** Inbound messages held while a turn runs; beyond this the peer is told to wait. */
const MAX_QUEUE = 8;

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
export function isInboundMessage(message: WeixinMessage): boolean {
	return message.message_type !== 2 && typeof message.from_user_id === "string" && message.from_user_id !== "";
}

/** The bridge's connection state, published to the UI for the status chip. */
export type BridgeState = "stopped" | "running" | "expired";

export interface BridgeDeps {
	config: WechatConfig;
	now: () => number;
	/** Whether the live session has no active run. Defaults to always idle. */
	isIdle?: () => boolean;
	/** Inject a user turn into the live session. */
	sendUserMessage: (content: UserContent) => void;
	/** Directory where inbound files are saved. */
	mediaDir: () => string;
	/** Built-in inbound slash commands. Defaults to {@link SLASH_COMMANDS}. */
	slashCommands?: readonly SlashCommand[];
	/** Session controls for slash actions, read lazily. */
	sessionControls?: () => SlashSessionControls | undefined;
	loadAccount: () => BotCredentials | undefined;
	loadState: () => WechatState;
	saveState: (state: WechatState) => void;
	createClient: (account: BotCredentials) => WechatClient;
	acquireLock: () => boolean;
	refreshLock: () => void;
	releaseLock: () => void;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** Arm a cancellable one-shot timer. Defaults to a real, unref'd `setTimeout`. */
	armTimer?: ArmTimer;
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Called when the server reports an expired token. */
	onExpired?: () => void;
	/** Called whenever the bridge's connection state changes, for a status chip. */
	onStateChange?: (state: BridgeState) => void;
}

export interface BridgeStatus {
	open: boolean;
	/** Whether the bridge stopped because the session expired and needs a re-login. */
	expired: boolean;
	owner?: string;
	peerCount: number;
	queued: number;
	refused: number;
	/** Labels of the senders refused since the bridge opened, newest last, capped. */
	refusedPeers: string[];
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
	const armTimer = deps.armTimer ?? defaultTimer;
	let running = false;
	let expired = false;
	let busy = false;
	let flushing = false;
	let abort: AbortController | undefined;
	let loopPromise: Promise<void> | undefined;
	let client: WechatClient | undefined;
	let account: BotCredentials | undefined;
	let state: WechatState = { cursor: "", peers: {} };
	let queue: InboundItem[] = [];
	let active: InboundItem | undefined;
	let lastText = "";
	/** One peer-facing line for the turn in flight, prepended to its reply. */
	let mediaNotice: string | undefined;
	let refused = 0;
	/** Labels of refused senders, so the operator can allowlist one by name. */
	const refusedPeers = new Set<string>();
	let mediaDropped = 0;
	let mediaCounter = 0;
	const typingCache = new Map<string, { ticket?: string; checkedAt: number }>();
	/** Per-peer keep-alive cancellers for the typing indicator. */
	const typing = new Map<string, () => void>();
	/** Per-peer pending acknowledgement cancellers. */
	const acks = new Map<string, () => void>();
	/** When each peer was last acknowledged, so a chatty peer is not spammed. */
	const ackedAt = new Map<string, number>();
	/** The language each peer last wrote in, so a media-only message can answer. */
	const languages = new Map<string, PeerLanguage>();
	/** Peers already told that the queue is full, until it drains. */
	const overflow = new Set<string>();
	const slashCommands = deps.slashCommands ?? SLASH_COMMANDS;

	const isIdle = deps.isIdle ?? (() => true);

	function notify(message: string, kind: "info" | "warning" | "error" = "info"): void {
		deps.notify?.(message, kind);
	}

	/** Report the current connection state to the host, for a status chip. */
	function publishState(): void {
		deps.onStateChange?.(running ? "running" : expired ? "expired" : "stopped");
	}

	function handleExpired(): void {
		running = false;
		expired = true;
		publishState();
		deps.onExpired?.();
		notify("WeChat session expired. Run /wechat login to reconnect.", "warning");
	}

	/**
	 * Send `text` to one peer in `maxReplyChars` chunks, stopping at the first
	 * failed chunk. A session expiry is handled here; a thrown transport error is
	 * handed to `onError` with how much of the reply went out, so each caller can
	 * report it its own way without claiming delivery.
	 */
	async function sendChunked(
		to: string,
		contextToken: string | undefined,
		text: string,
		signal: AbortSignal | undefined,
		onError: (error: unknown, progress: { sent: number; total: number }) => void,
	): Promise<boolean> {
		if (!client || !account) return false;
		const chunks = chunkText(toWechatText(text), deps.config.maxReplyChars).filter((chunk) => chunk !== "");
		// Flattening can empty a reply that was only formatting; nothing to deliver.
		if (chunks.length === 0) return true;
		for (const [index, chunk] of chunks.entries()) {
			// A split answer says so, so the peer knows more is coming and can tell a
			// truncated reply from a complete one.
			const body = chunks.length > 1 ? `[${index + 1}/${chunks.length}] ${chunk}` : chunk;
			try {
				const response = await client.sendMessage(account, { to, text: body, contextToken }, signal);
				if (isSessionExpired(response)) {
					handleExpired();
					return false;
				}
			} catch (error) {
				onError(error, { sent: index, total: chunks.length });
				return false;
			}
		}
		return true;
	}

	async function reply(item: InboundItem, text: string): Promise<void> {
		await sendChunked(item.peer, item.contextToken, text, abort?.signal, (error, progress) => {
			if (abort?.signal.aborted) return;
			const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
			notify(`WeChat reply failed${partial}: ${messageOf(error)}`, "warning");
		});
	}

	/** Run a slash action out-of-band and reply to the sender; never starts a turn. */
	async function runSlashAction(command: SlashCommand, item: InboundItem, args: string): Promise<void> {
		if (!command.run) return;
		const controls = deps.sessionControls?.();
		const ctx: SlashContext = {
			args,
			peer: item.peer,
			reply: (text) => reply(item, text),
			activeTurn: busy || active !== undefined,
			language: languageOf(item.peer),
			session: controls ?? {
				newSession: () => {
					throw new Error("Session controls are unavailable.");
				},
			},
		};
		try {
			await command.run(ctx);
		} catch (error) {
			notify(`WeChat command /${command.name} failed: ${messageOf(error)}`, "warning");
			await reply(item, `Command /${command.name} failed.`);
		}
	}

	/** Send a text message to the peer owning the in-flight turn, chunked. */
	async function sendPrompt(text: string, signal?: AbortSignal): Promise<boolean> {
		if (!active) return false;
		return sendChunked(active.peer, active.contextToken, text, signal ?? abort?.signal, () => {});
	}

	/** Upload and send a local file to the peer owning the in-flight turn. */
	async function sendFileToPeer(filePath: string, fileName: string, signal?: AbortSignal): Promise<boolean> {
		if (!client || !account || !active) return false;
		return sendLocalFile({
			client,
			account,
			cdnBaseUrl: deps.config.cdnBaseUrl,
			maxBytes: deps.config.maxMediaBytes,
			to: active.peer,
			contextToken: active.contextToken,
			filePath,
			fileName,
			signal: signal ?? abort?.signal,
		});
	}

	const interaction = createWechatInteractionChannel({
		send: (text, signal) => sendPrompt(text, signal),
		sendFile: (path, name, signal) => sendFileToPeer(path, name, signal),
		activePeer: () => active?.peer,
		language: () => languageOf(active?.peer ?? ""),
		armTimer: deps.armTimer,
	});

	/** The typing ticket for a peer, fetched on first use and cached. */
	async function typingTicket(peer: string, item: InboundItem): Promise<string | undefined> {
		const cached = typingCache.get(peer);
		const now = deps.now();
		if (cached && now - cached.checkedAt < TYPING_TTL_MS) return cached.ticket;
		if (!client || !account) return undefined;
		try {
			const response = await client.getConfig(
				account,
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
			// The peer's work may have finished while the ticket round-trip was in
			// flight; cancel immediately so the indicator cannot get stuck on.
			if (!hasWork(peer)) {
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

	/** Whether a peer has a turn running or a message waiting. */
	function hasWork(peer: string): boolean {
		return active?.peer === peer || queue.some((queued) => queued.peer === peer);
	}

	/** The peer's language: from this text, else the last one they wrote. */
	function languageOf(peer: string, text?: string): PeerLanguage {
		if (text) {
			const language = peerLanguage(text);
			languages.set(peer, language);
			return language;
		}
		return languages.get(peer) ?? "en";
	}

	function stopTyping(peer: string): void {
		const cancel = typing.get(peer);
		if (!cancel) return;
		typing.delete(peer);
		cancel();
	}

	function stopAllTyping(): void {
		for (const cancel of typing.values()) cancel();
		typing.clear();
	}

	/**
	 * Start the typing indicator for a peer and keep it alive while they wait.
	 * The chat window is the peer's only channel, and WeChat drops the indicator
	 * after a few seconds, so a long turn needs the refresh to look alive at all.
	 */
	function keepTyping(peer: string, item: InboundItem): void {
		if (!deps.config.typingIndicator) return;
		stopTyping(peer);
		void typingOn(peer, item);
		const started = deps.now();
		const refresh = (): void => {
			if (!hasWork(peer) || deps.now() - started >= TYPING_LIMIT_MS) {
				typing.delete(peer);
				return;
			}
			void typingOn(peer, item);
			typing.set(peer, armTimer(TYPING_KEEPALIVE_MS, refresh));
		};
		typing.set(peer, armTimer(TYPING_KEEPALIVE_MS, refresh));
	}

	/** Stop refreshing the indicator for peers with nothing left to answer. */
	function pruneTyping(): void {
		for (const peer of [...typing.keys()]) {
			if (!hasWork(peer)) stopTyping(peer);
		}
	}

	function cancelAck(peer: string): void {
		const cancel = acks.get(peer);
		if (!cancel) return;
		acks.delete(peer);
		cancel();
	}

	function cancelAllAcks(): void {
		for (const cancel of acks.values()) cancel();
		acks.clear();
	}

	/**
	 * Tell a queued peer, once, that their message is waiting. A turn that starts
	 * within {@link ACK_DELAY_MS} cancels this, because the typing indicator says
	 * the same thing without spending a bubble.
	 */
	function armAck(item: InboundItem): void {
		if (acks.has(item.peer)) return;
		const last = ackedAt.get(item.peer);
		if (last !== undefined && deps.now() - last < ACK_REPEAT_MS) return;
		acks.set(
			item.peer,
			armTimer(ACK_DELAY_MS, () => {
				acks.delete(item.peer);
				if (!hasWork(item.peer) || active?.peer === item.peer) return;
				ackedAt.set(item.peer, deps.now());
				void reply(item, notice("ack", languageOf(item.peer)));
			}),
		);
	}

	/** Download, decrypt, and turn a media reference into a content block. */
	async function resolveMedia(item: InboundItem): Promise<{ blocks: (TextContent | ImageContent)[]; dropped: number }> {
		const blocks: (TextContent | ImageContent)[] = [];
		let dropped = 0;
		for (const ref of item.media) {
			if (!client) break;
			try {
				const cipher = await client.downloadCdn(ref.media, abort?.signal);
				if (cipher.byteLength > deps.config.maxMediaBytes) {
					mediaDropped += 1;
					dropped += 1;
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
					// Without a key the bytes are not the image the peer sent; attaching them
					// anyway would hand the model a corrupt JPEG.
					const key = ref.aeskey ?? ref.media.aes_key;
					if (!key) throw new Error("missing AES key");
					const plain = decryptEcb(cipher, decodeMediaKey(key));
					blocks.push({
						type: "image",
						data: Buffer.from(plain).toString("base64"),
						mimeType: sniffImageMime(plain),
					});
				}
			} catch (error) {
				mediaDropped += 1;
				dropped += 1;
				notify(`WeChat media dropped: ${messageOf(error)}`, "warning");
			}
		}
		return { blocks, dropped };
	}

	/**
	 * Resolve media, then inject the turn. `active` is set before any await.
	 *
	 * An attachment the bridge could not read is never silent: the model gets a
	 * `[WeChat media skipped]` block and the peer's reply opens with one line, so a
	 * failed download cannot look like the model ignoring a photo.
	 */
	async function inject(item: InboundItem): Promise<void> {
		let content: UserContent = item.text;
		if (item.media.length > 0) {
			const { blocks, dropped } = await resolveMedia(item);
			if (!running || active !== item) return;
			if (!item.text && blocks.length === 0) {
				// Nothing the model could read, so answer the peer here instead of
				// starting a turn on a message that carries no content.
				if (dropped > 0) mediaNotice = notice("media", languageOf(item.peer), dropped);
				await answerOnly(item);
				return;
			}
			if (dropped > 0) {
				mediaNotice = notice("media", languageOf(item.peer), dropped);
				blocks.unshift({ type: "text", text: `[WeChat media skipped: ${dropped}]` });
			}
			const parts: (TextContent | ImageContent)[] = [];
			if (item.text) parts.push({ type: "text", text: item.text });
			parts.push(...blocks);
			content = parts;
		}
		try {
			deps.sendUserMessage(content);
		} catch (error) {
			active = undefined;
			mediaNotice = undefined;
			notify(`WeChat could not start a turn: ${messageOf(error)}`, "error");
			void reply(item, notice("failed", languageOf(item.peer)));
			pump();
		}
	}

	/**
	 * Answer the peer without starting a turn: a message that carried nothing the
	 * model could read. The queue stays held until the line is out.
	 */
	async function answerOnly(item: InboundItem): Promise<void> {
		const text = mediaNotice ?? notice("unsupported", languageOf(item.peer));
		mediaNotice = undefined;
		active = undefined;
		stopTyping(item.peer);
		flushing = true;
		try {
			await reply(item, text);
		} finally {
			flushing = false;
			pruneTyping();
			pump();
		}
	}

	/**
	 * Merge the consecutive messages a peer queued into one turn, so a burst
	 * ("one moment", "also…", "and…") is answered once instead of three times.
	 * Order is preserved, media are concatenated, and the newest reply token wins.
	 */
	function coalesce(first: InboundItem): InboundItem {
		const texts: string[] = first.text ? [first.text] : [];
		const media = [...first.media];
		let contextToken = first.contextToken;
		while (queue.length > 0 && queue[0].peer === first.peer) {
			const next = queue.shift() as InboundItem;
			if (next.text) texts.push(next.text);
			media.push(...next.media);
			contextToken = next.contextToken ?? contextToken;
		}
		return { peer: first.peer, contextToken, text: texts.join("\n"), media };
	}

	function pump(): void {
		// `flushing` holds the queue until the previous reply is out, so a new turn
		// can never overtake the answer the peer is waiting for.
		if (!running || busy || active || flushing || !isIdle()) return;
		const first = queue.shift();
		if (!first) return;
		const item = coalesce(first);
		if (queue.length === 0) overflow.clear();
		active = item;
		lastText = "";
		mediaNotice = undefined;
		cancelAck(item.peer);
		keepTyping(item.peer, item);
		void inject(item);
	}

	function handleMessage(message: WeixinMessage): void {
		if (!isInboundMessage(message)) return;
		const peer = message.from_user_id as string;
		const { text: rawText, media, unsupported } = parseInbound(message.item_list);
		let text = rawText;
		// A reply to a pending prompt is consumed here, before admission and
		// queueing, so it never starts a turn of its own.
		if (interaction.handleInbound(peer, text)) return;
		const owner = state.ownerId ?? account?.ilinkUserId;
		if (!isAllowedPeer(peer, owner, deps.config.allowedPeers)) {
			refused += 1;
			if (refusedPeers.size < 5) refusedPeers.add(peerLabel(peer));
			return;
		}
		const language = languageOf(peer, text);
		recordInbound(state, peer, message.context_token, deps.now());
		deps.saveState(state);
		const item: InboundItem = {
			peer,
			contextToken: message.context_token ?? state.peers[peer]?.lastContextToken,
			text,
			media,
		};
		if (!text && media.length === 0) {
			// Nothing to read. A voice note without a transcript or a video is
			// answered, so the peer knows it did not reach the agent.
			if (unsupported > 0) void reply(item, notice("unsupported", language));
			return;
		}
		// Intercept a text slash command before it becomes a turn. A message with
		// media is never a command, so an attachment is never dropped; an unknown
		// command falls through to the model as ordinary text.
		const slash = media.length === 0 ? parseSlash(text) : undefined;
		const command = slash ? findSlashCommand(slashCommands, slash.name) : undefined;
		if (command && slash) {
			if (command.ownerOnly && peerKey(peer) !== peerKey(owner ?? "")) {
				refused += 1;
				return;
			}
			if (command.kind === "snippet") {
				text = expandSnippet(command, slash.args);
				item.text = text;
			} else {
				void runSlashAction(command, item, slash.args);
				return;
			}
		}
		if (queue.length >= MAX_QUEUE) {
			// Refuse rather than grow without bound; one notice per episode, not per
			// dropped message.
			if (!overflow.has(peer)) {
				overflow.add(peer);
				void reply(item, notice("overflow", language));
			}
			return;
		}
		queue.push(item);
		keepTyping(peer, item);
		armAck(item);
		pump();
	}

	async function loop(signal: AbortSignal): Promise<void> {
		while (running && !signal.aborted) {
			if (!client || !account) break;
			let response;
			try {
				response = await client.getUpdates(account, state.cursor, signal);
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
				// First open for this state: adopt the account and keep the stored cursor
				// and reply tokens, which belong to it.
				state.ownerId = loaded.ilinkUserId;
				deps.saveState(state);
			} else if (state.ownerId !== loaded.ilinkUserId) {
				// `state.json` outlives `credentials.json`: after a logout and a login as
				// another account, the stored owner, cursor, and tokens belong to the
				// previous one, and keeping the owner would refuse the new account.
				state = { ...emptyState(), ownerId: loaded.ilinkUserId };
				deps.saveState(state);
			}
			running = true;
			expired = false;
			flushing = false;
			queue = [];
			active = undefined;
			lastText = "";
			mediaNotice = undefined;
			typingCache.clear();
			languages.clear();
			ackedAt.clear();
			overflow.clear();
			stopAllTyping();
			cancelAllAcks();
			interaction.reset();
			publishState();
			abort = new AbortController();
			loopPromise = loop(abort.signal).catch((error) => {
				notify(`WeChat bridge stopped: ${messageOf(error)}`, "error");
			});
		},

		async close(): Promise<void> {
			if (!running && !abort) {
				releaseSafe();
				publishState();
				return;
			}
			running = false;
			expired = false;
			abort?.abort();
			abort = undefined;
			try {
				await loopPromise;
			} catch {
				// Errors are surfaced by the loop's own catch.
			}
			loopPromise = undefined;
			flushing = false;
			queue = [];
			active = undefined;
			lastText = "";
			mediaNotice = undefined;
			stopAllTyping();
			cancelAllAcks();
			overflow.clear();
			interaction.reset();
			publishState();
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
			const prefix = mediaNotice;
			active = undefined;
			lastText = "";
			mediaNotice = undefined;
			interaction.reset();
			if (!item) {
				pump();
				return;
			}
			cancelAck(item.peer);
			stopTyping(item.peer);
			// Hold the queue until the reply is out: a message that arrives mid-flush
			// must not start the next turn before this peer has their answer.
			flushing = true;
			void (async () => {
				await typingOff(item.peer);
				// A reply that is only formatting has nothing to say, so it reads as a
				// stopped turn rather than as an empty bubble.
				const body = text && toWechatText(text) ? text : notice("stopped", languageOf(item.peer));
				await reply(item, prefix ? `${prefix}\n\n${body}` : body);
			})().finally(() => {
				flushing = false;
				pruneTyping();
				pump();
			});
		},

		status(): BridgeStatus {
			return {
				open: running,
				expired,
				owner: state.ownerId ?? account?.ilinkUserId,
				peerCount: Object.keys(state.peers).length,
				queued: queue.length,
				refused,
				refusedPeers: [...refusedPeers],
				mediaDropped,
				promptPending: interaction.hasPending(),
			};
		},

		channel(): WechatInteractionChannel {
			return interaction;
		},

		async sendToOwner(text: string): Promise<SendResult> {
			if (!running || !client || !account) return { ok: false, error: "WeChat bridge is not started." };
			const owner = state.ownerId ?? account.ilinkUserId;
			if (active && peerKey(active.peer) === peerKey(owner)) {
				// The bridge answers this turn itself, so a tool send would land twice.
				return {
					ok: false,
					error: "The bridge replies to this turn automatically; do not repeat it.",
				};
			}
			const trimmed = sanitizeInbound(text);
			if (!trimmed) return { ok: false, error: "Nothing to send." };
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
