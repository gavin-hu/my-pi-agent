/**
 * The WeChat bridge: one connection per account, one session per peer.
 *
 * This is the composition root. The poll loop, outbound delivery, the typing and
 * wait notices, admission (dedupe/cap/budget), inbound media, and the inbound
 * path itself each live in their own module; the bridge wires them to the live
 * client, account, cursor, and state, and owns the connection lifecycle and the
 * status snapshot. Each admitted message is handed to the sender's own session
 * through the peer worker, so a WeChat turn never runs in the terminal's session.
 *
 * The peer only has the chat window, so the bridge carries the signals the phone
 * needs: typing starts as soon as a message is picked up, a message waiting on
 * another conversation is acknowledged once and told why, a slow turn says so,
 * and every queued message is answered in its own turn, in order.
 *
 * The model may message the owner proactively through {@link Bridge.sendToOwner}.
 */

import { WechatError, type WechatClient } from "./transport/client.ts";
import { createAdmissionQueue, createTurnBudget } from "./conversation/admission.ts";
import { createDeliverer, type MessageTarget } from "./transport/deliver.ts";
import { createInboundAdmission } from "./transport/inbound.ts";
import { createPollLoop, defaultPollTimeout } from "./transport/poll.ts";
import { messageOf } from "../../lib/errors.ts";
import { peerKey, type PeerLanguage } from "./text/format.ts";
import { notice } from "./text/notices.ts";
import { createPresence } from "./conversation/presence.ts";
import { createForgetToken, createIntake, createLanguageOf, type Counter } from "./intake.ts";

// The admission predicates, re-exported: they are the bridge's contract, and a caller
// should not have to know which module inside it answers them.
export { isAccountOwner, isInboundMessage } from "./intake.ts";
export type { OwnerMessage, SendResult } from "./owner-send.ts";
import { createChatChannel } from "./dialog/interaction.ts";
import type { PendingPromptInfo, WechatInteractionChannel } from "./dialog/interaction.ts";
import { defaultSleep, defaultTimer, type ArmTimer } from "./timer.ts";
import { createTurnRunner, type TurnState, type TurnRunner } from "./conversation/turn.ts";
import { sendOwnerMessage, type OwnerMessage, type SendResult } from "./owner-send.ts";
import type { ChatTurn } from "./host/chat.ts";
import { emptyState, ownerTarget } from "./state/state.ts";
import { SLASH_COMMANDS, type SlashCommand } from "./commands/slash.ts";
import type { BotCredentials, WechatState } from "./types.ts";
import type { WechatConfig } from "./config.ts";

/** The bridge's connection state, published to the UI for the status chip. */
export type BridgeState = "stopped" | "running" | "expired";

export interface BridgeDeps {
	config: WechatConfig;
	now: () => number;
	/**
	 * Open this session as the chat's turn. The bridge hands over the channel so a
	 * dialog raised inside the turn reaches the phone rather than the terminal.
	 */
	openChat: (peer: string, options: { channel: WechatInteractionChannel }) => Promise<ChatTurn>;
	/** Directory where inbound files are saved. */
	mediaDir: () => string;
	/** Read this conversation's recent messages for `/history`; read-only. */
	readHistory: (count: number) => Promise<string>;
	/** Built-in inbound slash commands. Defaults to {@link SLASH_COMMANDS}. */
	slashCommands?: readonly SlashCommand[];
	loadAccount: () => BotCredentials | undefined;
	loadState: () => WechatState;
	saveState: (state: WechatState) => void;
	createClient: (account: BotCredentials) => WechatClient;
	acquireLock: () => boolean;
	/** Re-stamp the lock, or take it back; false when another live session owns it. */
	refreshLock: () => boolean;
	releaseLock: () => void;
	/**
	 * Arm the lock heartbeat around `beat`, and return the stop function. It runs for one
	 * connection: the beat must end with the poll loop, so a stopped bridge never keeps a
	 * record fresh that it no longer holds.
	 */
	startHeartbeat: (beat: () => void) => () => void;
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
	/** The connection state: stopped, polling, or expired. */
	state: BridgeState;
	owner?: string;
	queued: number;
	/** Whether the chat's turn is running right now; the bridge itself may be idle. */
	turnsRunning: boolean;
	/** The one conversation's state, for the control screen. */
	turn?: TurnState;
	refused: number;
	/** Labels of the senders refused since the bridge opened, newest last, capped. */
	refusedPeers: string[];
	mediaDropped: number;
	/** Whether the chat's dialog prompt is waiting for an answer. */
	promptPending: boolean;
	/** The waiting prompts, oldest first; one conversation has at most one. */
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
	/** The poller lock on disk, for the doctor. */
	lock?: { pid: number; at: number };
}

export interface Bridge {
	open(): void;
	close(): Promise<void>;
	shutdown(): Promise<void>;
	/** Stop the chat's running turn; false when nothing is running. */
	stop(): boolean;
	/** What the conversation is doing, for `/status`. */
	turnState(): TurnState;
	status(): BridgeStatus;
	/** The chat's interaction channel: the one its dialogs are answered through. */
	channel(): WechatInteractionChannel;
	/** Message the owner proactively: one text, one image, or one file, never a chosen recipient. */
	sendToOwner(message: OwnerMessage): Promise<SendResult>;
}

/** Create the bridge over an injected environment. */
export function createBridge(deps: BridgeDeps): Bridge {
	const sleep = deps.sleep ?? defaultSleep;
	const armTimer = deps.armTimer ?? defaultTimer;
	let connection: BridgeState = "stopped";
	let startedAt: number | undefined;
	let lastPollAt: number | undefined;
	let lastPollError: string | undefined;
	let lastSendError: string | undefined;
	let pollHoldMs: number | undefined;
	let abort: AbortController | undefined;
	let loopPromise: Promise<void> | undefined;
	let client: WechatClient | undefined;
	let account: BotCredentials | undefined;
	let state: WechatState = { cursor: "" };
	/** Senders refused since the connection opened; the inbound path bumps it. */
	const refused: Counter = { value: 0 };
	/** Labels of refused senders, so the operator can allowlist one by name. */
	const refusedPeers = new Set<string>();
	/** The language each peer last wrote in, so a media-only message can answer. */
	const languages = new Map<string, PeerLanguage>();
	/** Peers already told that the queue is full, until it drains. */
	const overflow = new Set<string>();
	const slashCommands = deps.slashCommands ?? SLASH_COMMANDS;
	/** The peer's language memory: written here when a turn settles, read on every message. */
	const languageOf = createLanguageOf(languages);
	const forgetToken = createForgetToken({ state: () => state, saveState: deps.saveState });

	/** One turn runner per open connection: it owns the queue and the chat's turn. */
	let worker: TurnRunner | undefined;
	const pollTimeout = deps.pollTimeout ?? defaultPollTimeout;

	function notify(message: string, kind: "info" | "warning" | "error" = "info"): void {
		deps.notify?.(message, kind);
	}

	/** Report the current connection state to the host, for a status chip. */
	function publishState(): void {
		deps.onStateChange?.(connection);
	}

	function handleExpired(): void {
		connection = "expired";
		// An expiry can be discovered by a send while the loop is parked in
		// `getUpdates`; abort it so it cannot wake up beside a later `open()`.
		abort?.abort();
		publishState();
		notify("WeChat session expired. Run /wechat login to reconnect.", "warning");
	}

	/**
	 * Another session took the account's lock: stop polling it, because carrying on
	 * would read a second cursor and answer the peers this one still holds twice. The
	 * lock is not released — it is theirs now — and the stop is a shutdown's, so a
	 * running turn is abandoned the same way.
	 */
	function handleLockLost(): void {
		if (connection !== "running") return;
		connection = "stopped";
		// A beat can find a takeover while a poll is parked: abort it, so the loop cannot wake
		// up holding a batch that is the new holder's to answer.
		abort?.abort();
		abort = undefined;
		void dropConnection();
		notify("WeChat polling stopped: another Pi session took over the poller lock.", "warning");
	}

	/**
	 * Re-stamp the lock: at the top of every poll attempt, and on the heartbeat between
	 * them. Whichever finds another session's record ends this connection.
	 */
	function stamp(): void {
		if (!deps.refreshLock()) handleLockLost();
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
	/**
	 * The chat's one interaction channel: a dialog raised in a chat turn is asked and
	 * answered on the phone, and there is one conversation to ask.
	 */
	let channel: WechatInteractionChannel | undefined;

	function channelFor(peer: string): WechatInteractionChannel {
		channel ??= createChatChannel({
			peer,
			flush: async () => {
				await worker?.flush();
			},
			send: async (text, signal) => {
				const item = worker?.running();
				return item ? deliverer.prompt(item, text, signal ?? abort?.signal) : false;
			},
			sendFile: async (path, name, signal) => {
				const item = worker?.running();
				return item ? deliverer.file(item, path, name, signal ?? abort?.signal) : false;
			},
			active: () => worker?.running() !== undefined,
			language: () => languageOf(peer),
			armTimer: deps.armTimer,
		});
		return channel;
	}

	/** Typing, acknowledgement, and the slow/busy lines; one timer registry each. */
	const presence = createPresence({
		typingIndicator: () => deps.config.typingIndicator,
		now: deps.now,
		armTimer,
		client: () => client,
		account: () => account,
		signal: () => abort?.signal,
		statusOf: () => worker?.state().status ?? "idle",
		languageOf: () => languageOf(state.ownerId ?? account?.ilinkUserId ?? ""),
		send: (contextToken, text) => reply({ peer: state.ownerId ?? account?.ilinkUserId ?? "", contextToken }, text),
		promptPending: () => channel?.hasPending() ?? false,
	});

	/** Inbound media resolution and the hand-off to the turn queue. */
	const inbound = createInboundAdmission({
		client: () => client,
		signal: () => abort?.signal,
		maxMediaBytes: () => deps.config.maxMediaBytes,
		mediaDir: deps.mediaDir,
		now: deps.now,
		notify,
		reply: (target, text) => reply(target, text),
		enqueue: (item) => {
			// The hand-off is the acknowledgement: the message is the worker's now, so its
			// id and the peer's token become durable here and not a download earlier.
			if (!worker) return;
			worker.enqueue(item);
			deps.saveState(state);
		},
		pruneTyping: () => presence.pruneTyping(),
		isRunning: () => connection === "running",
	});
	/** The hourly turn budget and the serial admission chain. */
	const budget = createTurnBudget(deps.config.maxTurnsPerHour, deps.now);
	const admission = createAdmissionQueue({ admit: inbound.admit, notify });

	/** The inbound path: admission, commands, and the hand-off to the turn queue. */
	const intake = createIntake({
		state: () => state,
		saveState: deps.saveState,
		account: () => account,
		config: deps.config,
		now: deps.now,
		notify,
		worker: () => worker,
		stopTurn,
		channel: () => channel,
		presence,
		budget,
		admission,
		languageOf,
		reply: (target, text) => reply(target, text),
		readHistory: deps.readHistory,
		refused,
		refusedPeers,
		overflow,
		slashCommands,
	});

	/** The waiting prompt, as the control screen and the one-line summary read it. */
	function pendingPrompts(): PendingPromptInfo[] {
		const waiting = channel?.pendingInfo();
		return waiting ? [waiting] : [];
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
		onMessages: async (messages) => {
			for (const message of messages) intake.handleMessage(message);
			// Hold the cursor back until every message in the batch has reached a peer's
			// queue: a message still downloading is not read, and the cursor is what makes
			// the server forget it.
			await admission.settled();
		},
		refreshLock: stamp,
		startHeartbeat: () => deps.startHeartbeat(stamp),
		isRunning: () => connection === "running",
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
		refused.value = 0;
		refusedPeers.clear();
		channel?.reset();
		channel = undefined;
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

	/**
	 * Stop one peer's turn, and take the dialog that turn was waiting on with it.
	 *
	 * A prompt belongs to the turn that asked it, so a stopped turn cannot leave it
	 * behind: `/status` would keep advertising a question nobody can answer, and the
	 * peer's next message would be consumed as its reply instead of starting a turn.
	 * The drop is silent because the stopped turn says so itself.
	 */
	function stopTurn(): boolean {
		const running = worker?.running();
		const stopped = worker?.abort() ?? false;
		if (stopped && running) channel?.reset();
		return stopped;
	}

	function releaseSafe(): void {
		try {
			deps.releaseLock();
		} catch {
			// The lock is advisory and stale locks are taken over.
		}
	}

	/** Start the poll loop on a fresh abort controller; its one catch reports a failure. */
	function startLoop(): void {
		abort = new AbortController();
		const controller = abort;
		loopPromise = poll.run(abort.signal).catch(async (error) => {
			// A loop that died while the connection was ours is a connection with no poller:
			// nothing arrives, so saying "running" over it would leave a green chip and an
			// open `/wechat status` until someone closed and opened the bridge by hand.
			if (abort !== controller || connection !== "running") return;
			connection = "stopped";
			abort = undefined;
			notify(`WeChat bridge stopped: ${messageOf(error)}`, "error");
			await dropConnection();
			releaseSafe();
		});
	}

	/** Stop the loop on the controller the caller took off `abort`, and forget it. */
	async function stopLoop(stopping: AbortController | undefined): Promise<void> {
		stopping?.abort();
		// Errors are surfaced by the loop's own catch.
		await loopPromise?.catch(() => undefined);
		loopPromise = undefined;
	}

	/** Drop the worker and everything the connection accumulated, then publish it. */
	async function dropConnection(): Promise<void> {
		const closing = worker;
		// A bridge that stops by hand withdraws a waiting prompt first, while the peer
		// still has a running turn to send the notice to: otherwise the question is
		// left half-asked by a session that is about to be disposed.
		if (channel?.hasPending()) await channel.cancel();
		worker = undefined;
		await closing?.close({ abandon: true });
		resetEphemeral();
		publishState();
	}

	/**
	 * Serialize lifecycle transitions. A close from the control screen and a start
	 * from the command, or a shutdown racing either, must not leave two poll loops
	 * or a released lock behind a running bridge.
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
			if (connection === "running") return;
			// A run that expired keeps its turn runner (and therefore its chat session)
			// and may still have a loop parked in `getUpdates`. Both are replaced
			// here, so the old ones must stop first: otherwise two pollers share one
			// cursor, and the old adapter is never released.
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
			connection = "running";
			resetEphemeral();
			startedAt = deps.now();
			// One worker per connection: it owns the per-peer queues and sessions, so
			// a login (or a reconnect after an expiry) starts from a clean slate while
			// each peer's history stays on disk.
			worker = createTurnRunner({
				openChat: (peer) => deps.openChat(peer, { channel: channelFor(peer) }),
				// Each part is delivered as its own bubble; the worker puts the
				// attachment line on the first one. A false result stops the stream.
				send: (item, text, options) => reply(item, text, options?.signal),
				fallback: (item, reason) => notice(reason, item.language),
				onStart: (item) => {
					presence.cancelAck();
					presence.stopBusyNotice();
					presence.keepTyping(item.contextToken);
					presence.armSlowNotice(item.contextToken);
				},
				onSettled: (item) => {
					// The turn is over, so its dialog is too: a prompt it left behind must not
					// be advertised, or eat the peer's next message as its answer.
					channel?.reset();
					presence.stopSlowNotice();
					presence.stopBusyNotice();
					presence.stopTyping();
					void presence.typingOff();
					presence.pruneTyping();
					languages.set(item.peer, item.language);
					// The flood notice is per episode: clear it once the queue drains.
					const left = (worker?.state().queued ?? 0) + admission.pending();
					if (left === 0) overflow.delete(item.peer);
				},
				notify,
				now: deps.now,
				armTimer,
			});
			startLoop();
			publishState();
		},

		close(): Promise<void> {
			return serial(async () => {
				connection = "stopped";
				const stopping = abort;
				abort = undefined;
				await stopLoop(stopping);
				await dropConnection();
				releaseSafe();
			});
		},

		async shutdown(): Promise<void> {
			await this.close();
		},

		stop(): boolean {
			return stopTurn();
		},

		turnState(): TurnState {
			return worker?.state() ?? { status: "idle", queued: 0 };
		},

		status(): BridgeStatus {
			const turn = worker?.state();
			return {
				state: connection,
				owner: state.ownerId ?? account?.ilinkUserId,
				queued: turn?.queued ?? 0,
				turnsRunning: turn?.status === "running",
				turn,
				refused: refused.value,
				refusedPeers: [...refusedPeers],
				mediaDropped: inbound.dropped(),
				promptPending: channel?.hasPending() ?? false,
				prompts: pendingPrompts(),
				startedAt,
				lastPollAt,
				lastPollError,
				lastSendError,
				pollHoldMs: pollHoldMs ?? deps.config.pollHoldMs,
				lock: deps.loadLock?.(),
			};
		},

		channel(): WechatInteractionChannel {
			// One conversation: a dialog can only belong to the account whose chat it is.
			return channelFor(state.ownerId ?? account?.ilinkUserId ?? "");
		},

		async sendToOwner(message: OwnerMessage): Promise<SendResult> {
			if (connection !== "running" || !client || !account) return { ok: false, error: "WeChat bridge is not started." };
			return sendOwnerMessage(
				{
					target: ownerTarget(state, account),
					deliverer,
					signal: () => abort?.signal,
					// One conversation: the running turn is the owner's own.
					ownerTurnRunning: () => worker?.state().status === "running",
				},
				message,
			);
		},
	};
}
