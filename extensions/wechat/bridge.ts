/**
 * The WeChat bridge: one connection per account, one session per peer.
 *
 * This is the composition root. The poll loop, outbound delivery, the typing and
 * wait notices, admission (dedupe/cap/budget), and inbound media each live in
 * their own module; the bridge wires them to the live client, account, cursor,
 * and state, and owns the connection lifecycle and the status snapshot. Each
 * admitted message is handed to the sender's own session through the peer
 * worker, so a WeChat turn never runs in the terminal's session.
 *
 * The peer only has the chat window, so the bridge carries the signals the phone
 * needs: typing starts as soon as a message is picked up, a message waiting on
 * another conversation is acknowledged once and told why, a slow turn says so,
 * and a burst that arrives before its turn starts is answered once, in order.
 *
 * The model may message the owner proactively through {@link Bridge.sendToOwner}.
 */

import { WechatError, type WechatClient } from "./transport/client.ts";
import { createAdmissionQueue, createTurnBudget } from "./peer/admission.ts";
import { createDeliverer, type MessageTarget } from "./transport/deliver.ts";
import { createInboundAdmission } from "./transport/inbound.ts";
import { createPollLoop, defaultPollTimeout } from "./transport/poll.ts";
import { messageOf } from "./errors.ts";
import { parseInbound, peerKey, peerLabel, peerLanguage, sanitizeInbound, type PeerLanguage } from "./text/format.ts";
import { notice } from "./text/notices.ts";
import { createPresence } from "./peer/presence.ts";
import { createPeerChannels, type PeerChannels } from "./dialog/channels.ts";
import type { PendingPromptInfo, WechatInteractionChannel } from "./dialog/interaction.ts";
import { defaultSleep, defaultTimer, type ArmTimer } from "./timer.ts";
import { createPeerWorker, type PeerState, type PeerWorker } from "./peer/peer-worker.ts";
import type { PeerSession } from "./peer/peer-session.ts";
import { emptyState, findPeer, recordInbound, rememberMessage, seenMessage } from "./state/state.ts";
import {
	expandSnippet,
	findSlashCommand,
	parseSlash,
	SLASH_COMMANDS,
	type SlashCommand,
	type SlashContext,
} from "./commands/slash.ts";
import type { BotCredentials, InboundItem, WechatState, WeixinMessage } from "./types.ts";
import type { WechatConfig } from "./config.ts";

/** Inbound messages held while a turn runs; beyond this the peer is told to wait. */
const MAX_QUEUE = 8;

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
export type BridgeState = "stopped" | "running" | "expired" | "paused";

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
	/** Read the poller lock, for the doctor. */
	loadLock?: () => { pid: number; at: number } | undefined;
}

export interface BridgeStatus {
	open: boolean;
	/** Whether the bridge stopped because the session expired and needs a re-login. */
	expired: boolean;
	/** Whether the operator paused polling; the account and peer sessions are kept. */
	paused: boolean;
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
	/** Whether any peer's dialogs prompt is waiting for an answer. */
	promptPending: boolean;
	/** Every waiting prompt, one per peer, with its kind, title, and age. */
	prompts: PendingPromptInfo[];
	/** When this connection opened. */
	startedAt?: number;
	/** When the last poll settled, successful or not. */
	lastPollAt?: number;
	/** The last poll failure, cleared by a successful poll. */
	lastPollError?: string;
	/** The last outbound send failure, cleared by a successful send. */
	lastSendError?: string;
	/** The long-poll hold currently in use (server hint or configured). */
	pollHoldMs?: number;
	/** The stored account's login time. */
	tokenCreatedAt?: number;
	/** The poller lock on disk, for the doctor. */
	lock?: { pid: number; at: number };
}

export interface SendResult {
	ok: boolean;
	error?: string;
}

export interface Bridge {
	open(): void;
	close(): Promise<void>;
	/** Stop polling new messages; running turns may finish. False when not running. */
	pause(): Promise<boolean>;
	/** Reacquire the lock and start polling again. False when not paused or the lock is taken. */
	resume(): Promise<boolean>;
	shutdown(): Promise<void>;
	/** Stop one peer's running turn; false when that peer is idle. */
	stop(peer: string): boolean;
	/** Drop one peer's conversation so the next message starts fresh. */
	reset(peer: string): boolean;
	/** What one peer's conversation is doing, for `/status`. */
	peerState(peer: string): PeerState;
	status(): BridgeStatus;
	/** One peer's interaction channel: the channel its session routes its dialogs through. */
	channel(peer: string): WechatInteractionChannel;
	/** Message the owner proactively. Owner-only and text-only by design. */
	sendToOwner(text: string): Promise<SendResult>;
}

/** Create the bridge over an injected environment. */
export function createBridge(deps: BridgeDeps): Bridge {
	const sleep = deps.sleep ?? defaultSleep;
	const armTimer = deps.armTimer ?? defaultTimer;
	let running = false;
	let paused = false;
	let expired = false;
	let startedAt: number | undefined;
	let lastPollAt: number | undefined;
	let lastPollError: string | undefined;
	let lastSendError: string | undefined;
	let pollHoldMs: number | undefined;
	let abort: AbortController | undefined;
	let loopPromise: Promise<void> | undefined;
	let client: WechatClient | undefined;
	let account: BotCredentials | undefined;
	let state: WechatState = { cursor: "", peers: {} };
	let refused = 0;
	/** Labels of refused senders, so the operator can allowlist one by name. */
	const refusedPeers = new Set<string>();
	/** The language each peer last wrote in, so a media-only message can answer. */
	const languages = new Map<string, PeerLanguage>();
	/** Peers already told that the queue is full, until it drains. */
	const overflow = new Set<string>();
	const slashCommands = deps.slashCommands ?? SLASH_COMMANDS;

	/** One worker per open connection: it owns the queues and the peer sessions. */
	let worker: PeerWorker | undefined;
	const pollTimeout = deps.pollTimeout ?? defaultPollTimeout;

	function notify(message: string, kind: "info" | "warning" | "error" = "info"): void {
		deps.notify?.(message, kind);
	}

	/** Report the current connection state to the host, for a status chip. */
	function publishState(): void {
		deps.onStateChange?.(running ? "running" : expired ? "expired" : paused ? "paused" : "stopped");
	}

	function handleExpired(): void {
		running = false;
		paused = false;
		expired = true;
		// An expiry can be discovered by a send while the loop is parked in
		// `getUpdates`; abort it so it cannot wake up beside a later `open()`.
		abort?.abort();
		publishState();
		notify("WeChat session expired. Run /wechat login to reconnect.", "warning");
	}

	/** Drop a peer's cached reply token, so the next inbound message replaces it. */
	function forgetToken(peer: string): void {
		const entry = findPeer(state, peer);
		if (!entry?.lastContextToken) return;
		delete entry.lastContextToken;
		deps.saveState(state);
	}

	/** Send one bubble to a peer and report whether it was delivered. */
	async function reply(target: MessageTarget, text: string, signal?: AbortSignal): Promise<boolean> {
		return deliverer.reply(target, text, signal ?? abort?.signal);
	}

	/** The outbound surface, reading the live client and account at call time. */
	const deliverer = createDeliverer({
		client: () => client,
		account: () => account,
		maxReplyChars: () => deps.config.maxReplyChars,
		cdnBaseUrl: deps.config.cdnBaseUrl,
		maxMediaBytes: deps.config.maxMediaBytes,
		notify,
		onExpired: handleExpired,
		forgetToken,
		onSendError: (message) => {
			lastSendError = message;
		},
		onSent: () => {
			lastSendError = undefined;
		},
	});
	/** Run a slash action out-of-band and reply to the sender; never starts a turn. */
	async function runSlashAction(command: SlashCommand, target: MessageTarget, args: string): Promise<void> {
		if (!command.run) return;
		const ctx: SlashContext = {
			args,
			peer: target.peer,
			reply: async (text) => {
				await reply(target, text);
			},
			activeTurn: worker?.state(target.peer).status === "running",
			language: languageOf(target.peer),
			session: {
				newSession: () => {
					worker?.reset(target.peer);
				},
				stop: () => worker?.abort(target.peer) ?? false,
				status: () => {
					const current = worker?.state(target.peer) ?? { status: "idle" as const, queued: 0 };
					const waiting = channels.pendingFor(target.peer);
					return waiting ? { ...current, prompt: waiting.title } : current;
				},
				history: (count) => deps.readHistory(target.peer, count),
			},
		};
		try {
			await command.run(ctx);
		} catch (error) {
			notify(`WeChat command /${command.name} failed: ${messageOf(error)}`, "warning");
			await reply(target, `Command /${command.name} failed.`);
		}
	}

	/**
	 * Every peer's dialogs, one channel each.
	 *
	 * A prompt is sent through the peer's channel to the turn it belongs to, so a
	 * reply can only answer its own peer's question even when two turns run at once.
	 * A failure is reported once per peer by the deliverer; a silent failure would
	 * leave the peer with only the choices, as if nothing preceded them.
	 */
	const channels: PeerChannels = createPeerChannels({
		flush: async (peer) => {
			await worker?.flush(peer);
		},
		send: (peer, text, signal) => {
			const item = worker?.running(peer);
			return item ? deliverer.prompt(item, text, signal ?? abort?.signal) : Promise.resolve(false);
		},
		sendFile: (peer, filePath, fileName, signal) => {
			const item = worker?.running(peer);
			return item ? deliverer.file(item, filePath, fileName, signal ?? abort?.signal) : Promise.resolve(false);
		},
		active: (peer) => worker?.state(peer).status === "running",
		language: (peer) => languageOf(peer),
		armTimer: deps.armTimer,
	});

	/** The peer's language: from this text, else the last one they wrote. */
	function languageOf(peer: string, text?: string): PeerLanguage {
		// A Chinese message is evidence of Chinese. Its absence is not evidence of
		// English, or a short reply ("ok", "1") would flip an established conversation
		// back to English; English is the fallback, so it needs no record of its own.
		if (text && peerLanguage(text) === "zh") languages.set(peer, "zh");
		return languages.get(peer) ?? "en";
	}

	/** The peer's conversation state, for the wait decisions in presence. */
	function peerStatus(peer: string): PeerState["status"] {
		return worker?.state(peer).status ?? "idle";
	}

	/** Typing, acknowledgement, and the slow/busy lines; one timer registry each. */
	const presence = createPresence({
		typingIndicator: () => deps.config.typingIndicator,
		now: deps.now,
		armTimer,
		client: () => client,
		account: () => account,
		signal: () => abort?.signal,
		statusOf: peerStatus,
		languageOf,
		send: (peer, contextToken, text) => reply({ peer, contextToken }, text),
		promptPending: (peer) => channels.hasPending(peer),
	});

	/** Inbound media resolution and the hand-off to a peer session. */
	const inbound = createInboundAdmission({
		client: () => client,
		account: () => account,
		signal: () => abort?.signal,
		maxMediaBytes: () => deps.config.maxMediaBytes,
		mediaDir: deps.mediaDir,
		now: deps.now,
		notify,
		reply: (target, text) => reply(target, text),
		enqueue: (item) => worker?.enqueue(item),
		pruneTyping: () => presence.pruneTyping(),
		isRunning: () => running,
	});
	/** The hourly turn budget and the serial admission chain. */
	const budget = createTurnBudget(deps.config.maxTurnsPerHour, deps.now);
	const admission = createAdmissionQueue({ admit: inbound.admit, notify });

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

		const target = { peer, contextToken: message.context_token ?? findPeer(state, peer)?.lastContextToken };
		// A command is not an answer: while a dialog waits the model is blocked on it,
		// so /stop and /status must reach their handlers or the peer's only way out is
		// the prompt timing out. A message with media is never a command, and an
		// unknown command falls through to the model as ordinary text.
		const slash = media.length === 0 ? parseSlash(text) : undefined;
		const command = slash ? findSlashCommand(slashCommands, slash.name) : undefined;
		if (command && slash) {
			if (command.ownerOnly && peerKey(peer) !== peerKey(owner ?? "")) {
				refused += 1;
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
			if (unsupported > 0) void reply(item, notice("unsupported", language));
			return;
		}
		// A slot is reserved here, before the download, so a burst of media cannot
		// all pass the check and then enqueue together.
		if (!budget.allow(peer)) {
			void reply(item, notice("budget", language));
			return;
		}
		const busy = (worker?.state(peer).queued ?? 0) + admission.pending(peer);
		if (busy >= MAX_QUEUE) {
			// Refuse rather than grow without bound; one notice per episode, not per
			// dropped message.
			if (!overflow.has(peer)) {
				overflow.add(peer);
				void reply(item, notice("overflow", language));
			}
			return;
		}
		presence.keepTyping(peer, item.contextToken);
		presence.armAck(item);
		admission.enqueue(item);
	}

	/** The long-poll loop; it reads the live client, cursor, and state. */
	const poll = createPollLoop({
		client: () => client,
		account: () => account,
		holdMs: () => deps.config.pollHoldMs,
		cursor: () => state.cursor,
		setCursor: (cursor) => {
			state.cursor = cursor;
		},
		saveState: () => deps.saveState(state),
		sleep,
		notify,
		onExpired: handleExpired,
		onMessages: (messages) => {
			for (const message of messages) handleMessage(message);
		},
		refreshLock: deps.refreshLock,
		isRunning: () => running,
		pollTimeout,
		now: deps.now,
		onPoll: (result) => {
			lastPollAt = result.at;
			lastPollError = result.error;
			if (result.holdMs !== undefined) pollHoldMs = result.holdMs;
		},
	});

	/**
	 * Drop everything one connection accumulated. Called when a connection opens
	 * and when it closes, so a counter from the previous connection can never leak
	 * into the next one's status or hourly window.
	 */
	function resetEphemeral(): void {
		languages.clear();
		overflow.clear();
		refused = 0;
		refusedPeers.clear();
		channels.reset();
		deliverer.reset();
		presence.reset();
		budget.reset();
		admission.reset();
		inbound.reset();
		lastPollAt = undefined;
		lastPollError = undefined;
		lastSendError = undefined;
		pollHoldMs = undefined;
	}

	function releaseSafe(): void {
		try {
			deps.releaseLock();
		} catch {
			// The lock is advisory and stale locks are taken over.
		}
	}

	/**
	 * Serialize lifecycle transitions. A pause and a resume from the control
	 * screen, or a shutdown racing either, must not leave two poll loops or a
	 * released lock behind a running bridge.
	 */
	let lifecycle: Promise<void> = Promise.resolve();
	function serial<T>(work: () => Promise<T>): Promise<T> {
		const run = lifecycle.then(work, work);
		lifecycle = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
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
			paused = false;
			expired = false;
			resetEphemeral();
			startedAt = deps.now();
			// One worker per connection: it owns the per-peer queues and sessions, so
			// a login (or a reconnect after an expiry) starts from a clean slate while
			// each peer's history stays on disk.
			worker = createPeerWorker({
				openSession: (peer, options) => deps.openSession(peer, { fresh: options.fresh, channel: channels.for(peer) }),
				// Each part is delivered as its own bubble; the worker puts the
				// attachment line on the first one. A false result stops the stream.
				send: (item, text, options) => reply(item, text, options?.signal),
				fallback: (item, reason) => notice(reason, item.language),
				onStart: (item) => {
					presence.cancelAck(item.peer);
					presence.stopBusyNotice(item.peer);
					presence.keepTyping(item.peer, item.contextToken);
					presence.armSlowNotice(item.peer, item.contextToken);
				},
				onSettled: (item) => {
					presence.stopSlowNotice(item.peer);
					presence.stopBusyNotice(item.peer);
					presence.stopTyping(item.peer);
					void presence.typingOff(item.peer);
					presence.pruneTyping();
					languages.set(item.peer, item.language);
					// The flood notice is per episode: clear it once the queue drains.
					const left = (worker?.state(item.peer).queued ?? 0) + admission.pending(item.peer);
					if (left === 0) overflow.delete(item.peer);
				},
				notify,
				now: deps.now,
				armTimer,
			});
			publishState();
			abort = new AbortController();
			loopPromise = poll.run(abort.signal).catch((error) => {
				notify(`WeChat bridge stopped: ${messageOf(error)}`, "error");
			});
		},

		close(): Promise<void> {
			return serial(async () => {
				running = false;
				paused = false;
				expired = false;
				abort?.abort();
				abort = undefined;
				try {
					await loopPromise;
				} catch {
					// Errors are surfaced by the loop's own catch.
				}
				loopPromise = undefined;
				// A paused bridge has no loop and no abort controller but still owns a
				// worker, so close it unconditionally rather than leaking the sessions.
				const closing = worker;
				worker = undefined;
				await closing?.close({ abandon: true });
				resetEphemeral();
				publishState();
				releaseSafe();
			});
		},

		pause(): Promise<boolean> {
			return serial(async () => {
				if (!running) return false;
				running = false;
				paused = true;
				// Clear the abort controller before withdrawing the prompt: its send must
				// not be cancelled by the poll abort that follows.
				const stopping = abort;
				abort = undefined;
				await channels.cancelAll();
				stopping?.abort();
				try {
					await loopPromise;
				} catch {
					// Errors are surfaced by the loop's own catch.
				}
				loopPromise = undefined;
				// No poller means no lock to keep: another runtime may take the account
				// while this one is paused. Resume reacquires it and reports a conflict.
				releaseSafe();
				publishState();
				return true;
			});
		},

		resume(): Promise<boolean> {
			return serial(async () => {
				if (!paused || expired || !worker || !account) return false;
				if (!deps.acquireLock()) {
					notify("Another Pi session is already polling this WeChat account.", "warning");
					return false;
				}
				paused = false;
				running = true;
				abort = new AbortController();
				loopPromise = poll.run(abort.signal).catch((error) => {
					notify(`WeChat bridge stopped: ${messageOf(error)}`, "error");
				});
				publishState();
				return true;
			});
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
				paused,
				owner: state.ownerId ?? account?.ilinkUserId,
				peerCount: Object.keys(state.peers).length,
				queued: states.reduce((total, entry) => total + entry.state.queued, 0),
				running: states.some((entry) => entry.state.status === "running"),
				refused,
				refusedPeers: [...refusedPeers],
				mediaDropped: inbound.dropped(),
				promptPending: channels.hasPending(),
				prompts: channels.prompts(),
				startedAt,
				lastPollAt,
				lastPollError,
				lastSendError,
				pollHoldMs: pollHoldMs ?? deps.config.pollHoldMs,
				tokenCreatedAt: account?.createdAt,
				lock: deps.loadLock?.(),
			};
		},

		channel(peer: string): WechatInteractionChannel {
			return channels.for(peer);
		},

		async sendToOwner(text: string): Promise<SendResult> {
			if (!running || !client || !account) return { ok: false, error: "WeChat bridge is not started." };
			const owner = state.ownerId ?? account.ilinkUserId;
			if (worker?.state(owner).status === "running") {
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
			return deliverer.toOwner(owner, contextToken, trimmed, abort?.signal);
		},
	};
}
