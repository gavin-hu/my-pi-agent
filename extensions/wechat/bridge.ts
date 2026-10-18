/**
 * The WeChat bridge: one poll loop per account, one session per peer.
 *
 * The bridge owns what is genuinely shared — the poll loop, admission, the media
 * pipeline, the typing indicator, the peer-facing notices, and the reply
 * transport. Each admitted message is handed to the sender's own session through
 * the peer worker, so a WeChat turn never runs in the terminal's session: no idle
 * gate, no reply capture from a run that happens to finish, and no shared
 * context.
 *
 * The peer only has the chat window, so the bridge carries the signals the phone
 * needs: typing starts as soon as a message is picked up, a message waiting on
 * another conversation is acknowledged once and told why, a slow turn says so,
 * and a burst that arrives before its turn starts is answered once, in order.
 *
 * Inbound images are downloaded, decrypted, and attached as model image content;
 * inbound files are saved under the media directory and referenced by path. The
 * model may message the owner proactively through {@link Bridge.sendToOwner}.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { isSessionExpired, WechatError, type WechatClient } from "./client.ts";
import {
	chunkText,
	parseInbound,
	peerKey,
	peerLabel,
	peerLanguage,
	sanitizeInbound,
	toWechatText,
	type PeerLanguage,
} from "./format.ts";
import { notice } from "./notices.ts";
import { createWechatInteractionChannel, type WechatInteractionChannel } from "./interaction.ts";
import { defaultSleep, defaultTimer, type ArmTimer } from "./timer.ts";
import { sendLocalFile } from "./outbound.ts";
import { decodeMediaKey, decryptEcb, saveMedia, sniffImageMime } from "./media.ts";
import { createPeerWorker, type PeerItem, type PeerState, type PeerWorker } from "./peer-worker.ts";
import type { PeerSession } from "./peer-session.ts";
import { emptyState, findPeer, recordInbound, rememberMessage, seenMessage } from "./state.ts";
import {
	expandSnippet,
	findSlashCommand,
	parseSlash,
	SLASH_COMMANDS,
	type SlashCommand,
	type SlashContext,
} from "./slash.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { WechatConfig } from "./config.ts";

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
/** Say the running turn is still going after this long without a reply. */
const TURN_NOTICE_MS = 30_000;
/** Say `busy` when a message is still queued behind a running turn after this. */
const BUSY_NOTICE_MS = 60_000;
/** Poll watchdog when the server has not told us its long-poll hold yet. */
const POLL_TIMEOUT_FALLBACK_MS = 90_000;
/** Never trust a server hint below this, so a busy loop cannot be papered over. */
const POLL_TIMEOUT_FLOOR_MS = 30_000;
/** Slack above the server's hold before a poll counts as wedged. */
const POLL_TIMEOUT_MARGIN_MS = 15_000;
/** Inbound messages held while a turn runs; beyond this the peer is told to wait. */
const MAX_QUEUE = 8;

/**
 * How long one `getupdates` request may hang before it is treated as wedged: the
 * server's own hold time plus a margin, so a half-open connection cannot stop
 * inbound traffic without a word.
 */
export function defaultPollTimeout(serverHintMs: number | undefined): number {
	return Math.max(serverHintMs ?? POLL_TIMEOUT_FALLBACK_MS, POLL_TIMEOUT_FLOOR_MS) + POLL_TIMEOUT_MARGIN_MS;
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
export function isInboundMessage(message: WeixinMessage): message is WeixinMessage & { from_user_id: string } {
	return message.message_type !== 2 && typeof message.from_user_id === "string" && message.from_user_id !== "";
}

/** The bridge's connection state, published to the UI for the status chip. */
export type BridgeState = "stopped" | "running" | "expired";

export interface BridgeDeps {
	config: WechatConfig;
	now: () => number;
	/**
	 * Open, resume, or restart one peer's own session. The bridge hands over its
	 * channel so the session's dialogs reach that peer rather than the terminal.
	 */
	openSession: (peer: string, options: { fresh: boolean; channel: WechatInteractionChannel }) => Promise<PeerSession>;
	/** Directory where inbound files are saved. */
	mediaDir: () => string;
	/** Read the peer's own recent messages for `/history`; read-only. */
	readHistory: (peer: string, count: number) => Promise<string>;
	/** Built-in inbound slash commands. Defaults to {@link SLASH_COMMANDS}. */
	slashCommands?: readonly SlashCommand[];
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
	/**
	 * How long to wait for one `getupdates` response before treating the request as
	 * wedged. Defaults to {@link defaultPollTimeout}; injected so a test never waits.
	 */
	pollTimeout?: (serverHintMs: number | undefined) => number;
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
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
	/** Whether a turn is running right now. */
	running: boolean;
	/** One entry per peer that has work or a live session, for the control screen. */
	peerStates: Array<{ peer: string; state: PeerState }>;
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

/** The outcome of one outbound text delivery attempt. */
interface Delivery {
	ok: boolean;
	/** Parts the transport accepted before stopping. */
	sent: number;
	total: number;
	/** The server reported an expired token; the bridge has already been marked. */
	expired?: boolean;
	/** Formatting left nothing to send. */
	empty?: boolean;
}

export interface Bridge {
	open(): void;
	close(): Promise<void>;
	shutdown(): Promise<void>;
	/** Stop one peer's running turn; false when that peer is idle. */
	stop(peer: string): boolean;
	/** Drop one peer's conversation so the next message starts fresh. */
	reset(peer: string): boolean;
	/** What one peer's conversation is doing, for `/status`. */
	peerState(peer: string): PeerState;
	status(): BridgeStatus;
	/** The remote interaction channel the peer sessions route their dialogs through. */
	channel(): WechatInteractionChannel;
	/** Message the owner proactively. Owner-only and text-only by design. */
	sendToOwner(text: string): Promise<SendResult>;
}

import { messageOf } from "./errors.ts";
/** Create the bridge over an injected environment. */
export function createBridge(deps: BridgeDeps): Bridge {
	const sleep = deps.sleep ?? defaultSleep;
	const armTimer = deps.armTimer ?? defaultTimer;
	let running = false;
	let expired = false;
	let abort: AbortController | undefined;
	let loopPromise: Promise<void> | undefined;
	let client: WechatClient | undefined;
	let account: BotCredentials | undefined;
	let state: WechatState = { cursor: "", peers: {} };
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
	/** Peers told that a turn is still running, until that turn ends. */
	const busyNotified = new Set<string>();
	/** Per-peer `busy` and `stillWorking` cancellers. */
	const busyTimers = new Map<string, () => void>();
	const slowTimers = new Map<string, () => void>();
	/** The language each peer last wrote in, so a media-only message can answer. */
	const languages = new Map<string, PeerLanguage>();
	/** Peers already told that the queue is full, until it drains. */
	const overflow = new Set<string>();
	/** When each peer's recent turns started, for the hourly cap. */
	const turnTimes = new Map<string, number[]>();
	/** Messages being resolved (media download) before they reach the queue. */
	const admitting = new Map<string, number>();
	/** Per-peer admission chain, so two media messages keep their arrival order. */
	const admitChains = new Map<string, Promise<void>>();
	const slashCommands = deps.slashCommands ?? SLASH_COMMANDS;

	/** One worker per open connection: it owns the queues and the peer sessions. */
	let worker: PeerWorker | undefined;
	const pollTimeout = deps.pollTimeout ?? defaultPollTimeout;

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
		// An expiry can be discovered by a send while the loop is parked in
		// `getUpdates`; abort it so it cannot wake up beside a later `open()`.
		abort?.abort();
		publishState();
		notify("WeChat session expired. Run /wechat login to reconnect.", "warning");
	}

	/**
	 * Send `text` in `maxReplyChars` chunks, stopping at the first failed chunk.
	 *
	 * This is the one outbound text path — a reply, a dialog preface, and
	 * `send_wechat` all use it — so Markdown flattening, part numbering, expiry,
	 * body-level rejection, and partial progress are decided in one place. A
	 * session expiry is handled here; a transport or rejection error is handed to
	 * `onFailure` with how much went out, so each caller reports it its own way.
	 */
	async function deliverText(
		to: string,
		contextToken: string | undefined,
		text: string,
		signal: AbortSignal | undefined,
		onFailure: (error: unknown, progress: { sent: number; total: number }) => void,
	): Promise<Delivery> {
		if (!client || !account) return { ok: false, sent: 0, total: 0 };
		const chunks = chunkText(toWechatText(text), deps.config.maxReplyChars).filter((chunk) => chunk !== "");
		if (chunks.length === 0) {
			// Nothing survived formatting: report it rather than claim a delivery.
			notify("WeChat reply had nothing to send after formatting.", "warning");
			return { ok: false, sent: 0, total: 0, empty: true };
		}
		for (const [index, chunk] of chunks.entries()) {
			// A split answer says so, so the peer knows more is coming and can tell a
			// truncated reply from a complete one.
			const body = chunks.length > 1 ? `[${index + 1}/${chunks.length}] ${chunk}` : chunk;
			try {
				const response = await client.sendMessage(account, { to, text: body, contextToken }, signal);
				if (isSessionExpired(response)) {
					handleExpired();
					return { ok: false, sent: index, total: chunks.length, expired: true };
				}
				// A body-level rejection is not a delivery: report it with the part count
				// instead of letting the answer vanish.
				if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
					// Prefer the non-zero value: the body may carry `ret: 0` plus a real
					// `errcode`, and reporting `ret 0` hides the actual reason.
					const code = (response.ret ?? 0) !== 0 ? response.ret : (response.errcode ?? 0);
					// The server's own description is the only way to tell a bad token
					// from a rate limit, so it is part of the error.
					const detail = response.errmsg ? `: ${response.errmsg}` : "";
					onFailure(new WechatError(`Weixin rejected the message (ret ${code}${detail}).`), {
						sent: index,
						total: chunks.length,
					});
					return { ok: false, sent: index, total: chunks.length };
				}
			} catch (error) {
				onFailure(error, { sent: index, total: chunks.length });
				return { ok: false, sent: index, total: chunks.length };
			}
		}
		return { ok: true, sent: chunks.length, total: chunks.length };
	}

	/** Peers already reported as unable to receive, until a send gets through. */
	const sendFailureNotified = new Set<string>();

	/**
	 * Send one bubble to a peer and report whether it was delivered.
	 *
	 * A rejection is reported once per outage rather than once per streamed part,
	 * and the peer's stored reply token is forgotten: a token the server rejects is
	 * the likely cause, and the next inbound message brings a fresh one.
	 */
	async function reply(item: { peer: string; contextToken?: string }, text: string): Promise<boolean> {
		let failed = false;
		const delivery = await deliverText(item.peer, item.contextToken, text, abort?.signal, (error, progress) => {
			failed = true;
			if (abort?.signal.aborted) return;
			forgetToken(item.peer);
			if (sendFailureNotified.has(item.peer)) return;
			sendFailureNotified.add(item.peer);
			const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
			notify(`WeChat reply failed${partial}: ${messageOf(error)}`, "warning");
		});
		if (!failed && delivery.ok) sendFailureNotified.delete(item.peer);
		return delivery.ok;
	}

	/** Drop a peer's cached reply token, so the next inbound message replaces it. */
	function forgetToken(peer: string): void {
		const entry = findPeer(state, peer);
		if (!entry?.lastContextToken) return;
		delete entry.lastContextToken;
		deps.saveState(state);
	}

	/** Run a slash action out-of-band and reply to the sender; never starts a turn. */
	async function runSlashAction(command: SlashCommand, item: InboundItem, args: string): Promise<void> {
		if (!command.run) return;
		const ctx: SlashContext = {
			args,
			peer: item.peer,
			reply: async (text) => {
				await reply(item, text);
			},
			activeTurn: worker?.state(item.peer).status === "running",
			language: languageOf(item.peer),
			session: {
				newSession: () => {
					worker?.reset(item.peer);
				},
				stop: () => worker?.abort(item.peer) ?? false,
				status: () => worker?.state(item.peer) ?? { status: "idle", queued: 0 },
				history: (count) => deps.readHistory(item.peer, count),
			},
		};
		try {
			await command.run(ctx);
		} catch (error) {
			notify(`WeChat command /${command.name} failed: ${messageOf(error)}`, "warning");
			await reply(item, `Command /${command.name} failed.`);
		}
	}

	/**
	 * Send a text message to the peer owning the in-flight turn, chunked.
	 *
	 * A failure is reported on the terminal once per peer, the same way a reply
	 * failure is: this carries a dialog preface (and the plan digest), and a silent
	 * failure would leave the peer with only the choices, as if nothing preceded
	 * them.
	 */
	async function sendPrompt(text: string, signal?: AbortSignal): Promise<boolean> {
		const current = worker?.current();
		if (!current) return false;
		const activeSignal = signal ?? abort?.signal;
		let failed = false;
		const delivery = await deliverText(current.peer, current.contextToken, text, activeSignal, (error, progress) => {
			failed = true;
			if (activeSignal?.aborted) return;
			forgetToken(current.peer);
			if (sendFailureNotified.has(current.peer)) return;
			sendFailureNotified.add(current.peer);
			const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
			notify(`WeChat message delivery failed${partial}: ${messageOf(error)}`, "warning");
		});
		if (!failed && delivery.ok) sendFailureNotified.delete(current.peer);
		return delivery.ok;
	}

	/** Upload and send a local file to the peer owning the in-flight turn. */
	async function sendFileToPeer(filePath: string, fileName: string, signal?: AbortSignal): Promise<boolean> {
		const current = worker?.current();
		if (!client || !account || !current) return false;
		const activeSignal = signal ?? abort?.signal;
		const sent = await sendLocalFile({
			client,
			account,
			cdnBaseUrl: deps.config.cdnBaseUrl,
			maxBytes: deps.config.maxMediaBytes,
			to: current.peer,
			contextToken: current.contextToken,
			filePath,
			fileName,
			signal: activeSignal,
		});
		// `sendLocalFile` reports only success, and the caller may fall back to text;
		// without this line the operator would never know the attachment was dropped.
		if (!sent && !activeSignal?.aborted) notify(`WeChat file delivery failed for ${fileName}.`, "warning");
		return sent;
	}

	const interaction = createWechatInteractionChannel({
		send: (text, signal) => sendPrompt(text, signal),
		sendFile: (path, name, signal) => sendFileToPeer(path, name, signal),
		activePeer: () => worker?.current()?.peer,
		language: () => languageOf(worker?.current()?.peer ?? ""),
		armTimer: deps.armTimer,
	});

	/** The typing ticket for a peer, fetched on first use and cached. */
	async function typingTicket(peer: string, contextToken: string | undefined): Promise<string | undefined> {
		const cached = typingCache.get(peer);
		const now = deps.now();
		if (cached && now - cached.checkedAt < TYPING_TTL_MS) return cached.ticket;
		if (!client || !account) return undefined;
		try {
			const response = await client.getConfig(account, { ilinkUserId: peer, contextToken }, abort?.signal);
			typingCache.set(peer, { ticket: response?.typingTicket, checkedAt: now });
			return response?.typingTicket;
		} catch {
			typingCache.set(peer, { ticket: undefined, checkedAt: now });
			return undefined;
		}
	}

	async function typingOn(peer: string, contextToken: string | undefined): Promise<void> {
		if (!deps.config.typingIndicator || !client || !account) return;
		const ticket = await typingTicket(peer, contextToken);
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
		return (worker?.state(peer).status ?? "idle") !== "idle";
	}

	/** Reserve a turn in the peer's rolling hour; false when the cap is reached. */
	function allowTurn(peer: string): boolean {
		const limit = deps.config.maxTurnsPerHour;
		if (limit <= 0) return true;
		const key = peerKey(peer);
		const now = deps.now();
		const cutoff = now - 60 * 60 * 1000;
		const times = (turnTimes.get(key) ?? []).filter((at) => at >= cutoff);
		if (times.length >= limit) {
			turnTimes.set(key, times);
			return false;
		}
		times.push(now);
		turnTimes.set(key, times);
		return true;
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
	function keepTyping(peer: string, contextToken: string | undefined): void {
		if (!deps.config.typingIndicator) return;
		stopTyping(peer);
		void typingOn(peer, contextToken);
		const started = deps.now();
		const refresh = (): void => {
			if (!hasWork(peer) || deps.now() - started >= TYPING_LIMIT_MS) {
				typing.delete(peer);
				return;
			}
			void typingOn(peer, contextToken);
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

	/**
	 * Stop the `busy` line for a peer: the wait episode is over, so the next one
	 * is allowed to speak again.
	 */
	function stopBusyNotice(peer: string): void {
		const cancel = busyTimers.get(peer);
		if (cancel) cancel();
		busyTimers.delete(peer);
		busyNotified.delete(peer);
	}

	/** Stop the turn-progress notice for `peer`. */
	function stopSlowNotice(peer: string): void {
		const cancel = slowTimers.get(peer);
		if (cancel) cancel();
		slowTimers.delete(peer);
	}

	/**
	 * Say once that this turn is taking a while. The typing indicator carries the
	 * same signal, but it is best-effort and invisible in some clients, so a slow
	 * turn gets one plain line instead of silence.
	 */
	function armSlowNotice(peer: string, contextToken: string | undefined): void {
		stopSlowNotice(peer);
		slowTimers.set(
			peer,
			armTimer(TURN_NOTICE_MS, () => {
				slowTimers.delete(peer);
				if (worker?.state(peer).status !== "running") return;
				// A turn waiting on an unanswered dialog is not "still working": the
				// prompt itself nudges at 90 seconds, and saying both reads as noise.
				if (interaction.hasPending()) return;
				void reply({ peer, contextToken }, notice("stillWorking", languageOf(peer)));
			}),
		);
	}

	/**
	 * Say once why a message is still waiting: this peer's turn is still running,
	 * so theirs has not started. Bounded to one line per wait episode.
	 */
	function armBusyNotice(peer: string, contextToken: string | undefined): void {
		if (busyNotified.has(peer) || busyTimers.has(peer)) return;
		busyTimers.set(
			peer,
			armTimer(BUSY_NOTICE_MS, () => {
				busyTimers.delete(peer);
				if (!hasWork(peer) || busyNotified.has(peer)) return;
				busyNotified.add(peer);
				void reply({ peer, contextToken }, notice("busy", languageOf(peer)));
			}),
		);
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
		// A turn for this peer is already running: its own progress notice covers
		// this message, so a second acknowledgement would be noise.
		if (worker?.state(item.peer).status === "running") return;
		if (acks.has(item.peer)) return;
		const last = ackedAt.get(item.peer);
		if (last !== undefined && deps.now() - last < ACK_REPEAT_MS) return;
		acks.set(
			item.peer,
			armTimer(ACK_DELAY_MS, () => {
				acks.delete(item.peer);
				if (!hasWork(item.peer) || worker?.state(item.peer).status === "running") return;
				ackedAt.set(item.peer, deps.now());
				void reply(item, notice("ack", languageOf(item.peer)));
				// Still waiting after a minute behind another turn: say why.
				armBusyNotice(item.peer, item.contextToken);
			}),
		);
	}

	/**
	 * Download, decrypt, and split what the peer sent into a prompt text and image
	 * blocks. A file is saved and referenced by path; an image becomes model image
	 * content. Every failure is counted so the peer can be told.
	 */
	async function resolveMedia(item: InboundItem): Promise<{
		images: ImageContent[];
		files: string[];
		dropped: number;
	}> {
		const images: ImageContent[] = [];
		const files: string[] = [];
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
					files.push(`[WeChat file: ${ref.fileName} saved to ${path}]`);
				} else {
					// Without a key the bytes are not the image the peer sent; attaching them
					// anyway would hand the model a corrupt JPEG.
					const key = ref.aeskey ?? ref.media.aes_key;
					if (!key) throw new Error("missing AES key");
					const plain = decryptEcb(cipher, decodeMediaKey(key));
					images.push({
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
		return { images, files, dropped };
	}

	/**
	 * Resolve media, then hand the message to the peer's own session.
	 *
	 * An attachment the bridge could not read is never silent: the model gets a
	 * `[WeChat media skipped]` block and the peer's reply opens with one line, so a
	 * failed download cannot look like the model ignoring a photo. A message with
	 * nothing readable is answered here instead of starting an empty turn.
	 */
	async function admit(item: InboundItem): Promise<void> {
		let text = item.text;
		let images: ImageContent[] | undefined;
		let prefix: string | undefined;
		if (item.media.length > 0) {
			const resolved = await resolveMedia(item);
			if (!running) return;
			if (!text && resolved.images.length === 0 && resolved.files.length === 0) {
				if (resolved.dropped > 0) prefix = notice("media", item.language, resolved.dropped);
				await reply(item, prefix ?? notice("unsupported", item.language));
				pruneTyping();
				return;
			}
			if (resolved.dropped > 0) {
				prefix = notice("media", item.language, resolved.dropped);
				text = [text, `[WeChat media skipped: ${resolved.dropped}]`].filter(Boolean).join("\n");
			}
			if (resolved.files.length > 0) text = [text, ...resolved.files].filter(Boolean).join("\n");
			images = resolved.images.length > 0 ? resolved.images : undefined;
		}
		if (!text && !images) {
			await reply(item, notice("unsupported", item.language));
			pruneTyping();
			return;
		}
		const queued: PeerItem = {
			peer: item.peer,
			text,
			images,
			prefix,
			language: item.language,
			contextToken: item.contextToken,
		};
		worker?.enqueue(queued);
	}

	function handleMessage(message: WeixinMessage): void {
		if (!isInboundMessage(message)) return;
		const peer = message.from_user_id;
		const { text: rawText, media, unsupported } = parseInbound(message.item_list);
		const owner = state.ownerId ?? account?.ilinkUserId;
		// Admission comes first: a refused sender never reaches the state file, a
		// pending prompt, or the queue.
		if (!isAllowedPeer(peer, owner, deps.config.allowedPeers)) {
			refused += 1;
			const label = peerLabel(peer);
			// Name a new sender once, so the operator can allowlist it from the
			// terminal; the cap keeps a spam run from filling the list.
			if (refusedPeers.size < 5 && !refusedPeers.has(label)) {
				refusedPeers.add(label);
				notify(`WeChat refused a message from ${label}. Add it to allowedPeers to admit.`, "warning");
			}
			return;
		}
		// A server replay of an already handled message must not answer twice. The
		// id is persisted, so a reload or reconnect cannot resurrect it.
		const messageId = message.message_id;
		if (typeof messageId === "number" && messageId !== 0 && seenMessage(state, peer, messageId)) return;

		let text = rawText;
		const cap = deps.config.maxInboundChars;
		if (text.length > cap) {
			const total = text.length;
			text = `${text.slice(0, cap)}\n[WeChat message truncated: showing ${cap} of ${total} characters]`;
			notify(`WeChat message truncated to ${cap} characters.`, "warning");
		}

		const now = deps.now();
		recordInbound(state, peer, message.context_token, now);
		if (typeof messageId === "number" && messageId !== 0) rememberMessage(state, peer, messageId, now);
		deps.saveState(state);

		// A reply to a pending prompt is consumed here, before queueing, so it never
		// starts a turn of its own. A duplicate answer was stopped by the id check.
		if (interaction.handleInbound(peer, text)) return;
		const language = languageOf(peer, text);
		const item: InboundItem = {
			peer,
			contextToken: message.context_token ?? findPeer(state, peer)?.lastContextToken,
			text,
			media,
			language,
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
		// A slot is reserved here, before the download, so a burst of media cannot
		// all pass the check and then enqueue together.
		if (!allowTurn(peer)) {
			void reply(item, notice("budget", language));
			return;
		}
		const busy = (worker?.state(peer).queued ?? 0) + (admitting.get(peer) ?? 0);
		if (busy >= MAX_QUEUE) {
			// Refuse rather than grow without bound; one notice per episode, not per
			// dropped message.
			if (!overflow.has(peer)) {
				overflow.add(peer);
				void reply(item, notice("overflow", language));
			}
			return;
		}
		keepTyping(peer, item.contextToken);
		armAck(item);
		admitting.set(peer, (admitting.get(peer) ?? 0) + 1);
		const previous = admitChains.get(peer) ?? Promise.resolve();
		const next = previous
			.then(async () => {
				await admit(item);
			})
			.catch((error) => {
				// One bad admission must not stall the peer's chain forever.
				notify(`WeChat could not accept a message: ${messageOf(error)}`, "warning");
			})
			.finally(() => {
				const left = (admitting.get(peer) ?? 1) - 1;
				if (left > 0) admitting.set(peer, left);
				else admitting.delete(peer);
			});
		admitChains.set(peer, next);
		void next.finally(() => {
			if (admitChains.get(peer) === next) admitChains.delete(peer);
		});
	}

	async function loop(signal: AbortSignal): Promise<void> {
		// The server tells us how long it holds a poll; remember it so the watchdog
		// can be tight instead of the generic fallback.
		let serverHint: number | undefined;
		/** One notice per failure episode, so a flapping link is reported once. */
		let timeoutNotified = false;
		let rejectedNotified = false;
		while (running && !signal.aborted) {
			if (!client || !account) break;
			const watchdogMs = pollTimeout(serverHint ?? deps.config.pollHoldMs);
			// A cancellable watchdog: `AbortSignal.timeout` cannot be cleared, and a
			// pending timer per poll would keep the process awake long after the request
			// settled. Unref'd, so a wedged poll never holds a shutdown open either.
			const watchdog = new AbortController();
			const watchdogTimer = setTimeout(() => watchdog.abort(), watchdogMs);
			(watchdogTimer as { unref?: () => void }).unref?.();
			let response;
			try {
				response = await client.getUpdates(account, state.cursor, AbortSignal.any([signal, watchdog.signal]), {
					holdMs: deps.config.pollHoldMs,
				});
			} catch (error) {
				if (signal.aborted || !running) break;
				if (watchdog.signal.aborted) {
					// A wedged request, not a server answer: retry at once with the same
					// cursor, so nothing is skipped, and say so once.
					if (!timeoutNotified) {
						timeoutNotified = true;
						notify(`WeChat poll timed out after ${Math.round(watchdogMs / 1000)}s; retrying.`, "warning");
					}
					continue;
				}
				notify(`WeChat poll failed: ${messageOf(error)}`, "warning");
				try {
					await sleep(BACKOFF_MS, signal);
				} catch {
					break;
				}
				continue;
			} finally {
				clearTimeout(watchdogTimer);
			}
			if (!response) break;
			if (response.timeoutMs !== undefined && response.timeoutMs > 0) serverHint = response.timeoutMs;
			if (isSessionExpired(response)) {
				handleExpired();
				return;
			}
			if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
				// A body-level rejection (bad cursor, rate limit, revoked token) is not an
				// empty poll: report it once and back off instead of hammering the API.
				if (!rejectedNotified) {
					rejectedNotified = true;
					notify(`WeChat poll rejected (ret ${response.ret ?? response.errcode}); retrying.`, "warning");
				}
				try {
					await sleep(BACKOFF_MS, signal);
				} catch {
					break;
				}
				continue;
			}
			timeoutNotified = false;
			rejectedNotified = false;
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
			// A run that expired keeps its worker (and therefore its peer sessions)
			// and may still have a loop parked in `getUpdates`. Both are replaced
			// here, so the old ones must stop first: otherwise two pollers share one
			// cursor, and the old peer sessions are never disposed.
			abort?.abort();
			abort = undefined;
			void worker?.close();
			worker = undefined;
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
			} else if (peerKey(state.ownerId) !== peerKey(loaded.ilinkUserId)) {
				// `state.json` outlives `credentials.json`: after a logout and a login as
				// another account, the stored owner, cursor, and tokens belong to the
				// previous one, and keeping the owner would refuse the new account.
				state = { ...emptyState(), ownerId: loaded.ilinkUserId };
				deps.saveState(state);
			}
			running = true;
			expired = false;
			typingCache.clear();
			languages.clear();
			ackedAt.clear();
			overflow.clear();
			turnTimes.clear();
			stopAllTyping();
			cancelAllAcks();
			interaction.reset();
			// One worker per connection: it owns the per-peer queues and sessions, so
			// a login (or a reconnect after an expiry) starts from a clean slate while
			// each peer's history stays on disk.
			worker = createPeerWorker({
				openSession: (peer, options) => deps.openSession(peer, { fresh: options.fresh, channel: interaction }),
				// Each part is delivered as its own bubble; the worker puts the
				// attachment line on the first one. A false result stops the stream.
				send: (item, text) => reply(item, text),
				fallback: (item, reason) => notice(reason, item.language),
				onStart: (item) => {
					cancelAck(item.peer);
					stopBusyNotice(item.peer);
					keepTyping(item.peer, item.contextToken);
					armSlowNotice(item.peer, item.contextToken);
				},
				onSettled: (item) => {
					stopSlowNotice(item.peer);
					stopBusyNotice(item.peer);
					stopTyping(item.peer);
					void typingOff(item.peer);
					pruneTyping();
					languages.set(item.peer, item.language);
					// The flood notice is per episode: clear it once the queue drains.
					const left = (worker?.state(item.peer).queued ?? 0) + (admitting.get(item.peer) ?? 0);
					if (left === 0) overflow.delete(item.peer);
				},
				notify,
				now: deps.now,
				armTimer,
			});
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
			const closing = worker;
			worker = undefined;
			await closing?.close();
			for (const cancel of busyTimers.values()) cancel();
			busyTimers.clear();
			busyNotified.clear();
			for (const cancel of slowTimers.values()) cancel();
			slowTimers.clear();
			stopAllTyping();
			cancelAllAcks();
			overflow.clear();
			turnTimes.clear();
			interaction.reset();
			publishState();
			releaseSafe();
		},

		async shutdown(): Promise<void> {
			await this.close();
		},

		stop(peer: string): boolean {
			return worker?.abort(peer) ?? false;
		},

		reset(peer: string): boolean {
			return worker?.reset(peer) ?? false;
		},

		peerState(peer: string): PeerState {
			return worker?.state(peer) ?? { status: "idle", queued: 0 };
		},

		status(): BridgeStatus {
			const states = worker?.snapshot() ?? [];
			return {
				peerStates: states,
				open: running,
				expired,
				owner: state.ownerId ?? account?.ilinkUserId,
				peerCount: Object.keys(state.peers).length,
				queued: states.reduce((total, entry) => total + entry.state.queued, 0),
				running: states.some((entry) => entry.state.status === "running"),
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
			const current = worker?.current();
			if (current && peerKey(current.peer) === peerKey(owner)) {
				// The bridge answers this turn itself, so a tool send would land twice.
				return {
					ok: false,
					error: "The bridge replies to this turn automatically; do not repeat it.",
				};
			}
			const trimmed = sanitizeInbound(text);
			if (!trimmed) return { ok: false, error: "Nothing to send." };
			// Either id form may be stored: the owner id comes from the login response
			// and the token from an inbound `from_user_id`, and they need not agree.
			const contextToken = findPeer(state, owner)?.lastContextToken;
			let failure: string | undefined;
			const delivery = await deliverText(owner, contextToken, trimmed, abort?.signal, (error, progress) => {
				forgetToken(owner);
				const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
				failure = `${messageOf(error)}${partial}`;
			});
			if (delivery.expired) return { ok: false, error: "WeChat session expired." };
			if (delivery.empty) return { ok: false, error: "Nothing to send after formatting." };
			if (!delivery.ok) return { ok: false, error: failure ?? "WeChat send failed." };
			return { ok: true };
		},
	};
}
