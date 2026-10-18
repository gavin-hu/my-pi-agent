/**
 * wechat — a bridge between Pi and WeChat, one session per admitted peer.
 *
 * Each peer's message becomes a turn in that peer's own Pi session (its own
 * history, model context, and tools), and that session's answer is sent back.
 * The terminal session is never injected into, so the two conversations cannot
 * mix. The bridge follows the stored account: it opens on `session_start` while
 * credentials exist (and after `/wechat login`), and `/wechat logout` is the
 * only way to discard the account and stop it. `/wechat` opens the control
 * screen. See `README.md`.
 *
 * Load with:  pi --extension ./extensions/wechat
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { isExtensionEnabled } from "../../lib/env.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { createBridge, type Bridge, type BridgeState } from "./bridge.ts";
import { createFetchRunner, WechatClient, type WechatClientOptions } from "./client.ts";
import { registerCommands, type CommandDeps } from "./commands.ts";
import { messageOf } from "./errors.ts";
import { loadWechatConfig } from "./config.ts";
import { clearCredentials, primaryAccount, saveAccount, wechatDir } from "./credentials.ts";
import { acquireLock, lockPath, readLock, refreshLock, releaseLock } from "./lock.ts";
import { openPeerSession, type PeerSession, type PeerSessionOptions } from "./peer-session.ts";
import { createPeerUIContext } from "./remote-ui.ts";
import { peerKey } from "./format.ts";
import { readPeerHistory } from "./history.ts";
import { SLASH_COMMANDS } from "./slash.ts";
import { readState, statePath, writeState } from "./state.ts";
import { registerTools } from "./tools.ts";

/**
 * The chip text for a bridge state: a success chip while connected, and an
 * error chip that persists after a session expiry until the user reconnects or
 * stops the bridge. `stopped` publishes nothing.
 */
export function wechatChip(theme: Theme, state: BridgeState): string | undefined {
	switch (state) {
		case "running":
			return paint(theme, "ok", `${GLYPHS.wechat} wechat`);
		case "expired":
			return paint(theme, "bad", `${GLYPHS.wechat} wechat expired`);
		case "paused":
			return paint(theme, "warn", `${GLYPHS.wechat} wechat paused`);
		case "stopped":
			return undefined;
	}
}

/** Test seams: production uses the fetched HTTP transport, the real timers, and real sessions. */
export interface WechatDeps {
	/** Build the iLink client; overridden in tests so no request leaves the process. */
	createClient?: (options: WechatClientOptions) => WechatClient;
	/** Injected sleep; overridden in tests so the poll loop never waits on a real timer. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/**
	 * Build a peer's session. Overridden in tests, which must not load extensions or
	 * call a model; production opens a real SDK session per peer.
	 */
	openSession?: (peer: string, options: PeerSessionOptions) => Promise<PeerSession>;
}

export default function wechat(pi: ExtensionAPI, deps: WechatDeps = {}): void {
	if (!isExtensionEnabled("wechat")) return;

	const makeClient = deps.createClient ?? ((options: WechatClientOptions) => new WechatClient(options));

	let bridge: Bridge | undefined;
	let ctxRef: ExtensionContext | undefined;

	const lockDeps = () => ({
		now: () => Date.now(),
		pid: process.pid,
		isAlive: (pid: number) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
	});

	const build = (ctx: ExtensionContext): Bridge => {
		ctxRef = ctx;
		const config = loadWechatConfig(ctx.cwd);
		const peerTools = new Map(Object.entries(config.peers).map(([id, peer]) => [peerKey(id), peer.tools] as const));
		return createBridge({
			config,
			now: () => Date.now(),
			// Each peer gets its own session under the WeChat state dir, with the host's
			// model and thinking level, and its dialogs bound to that peer.
			openSession: (peer, options) =>
				(deps.openSession ?? openPeerSession)(peer, {
					cwd: ctxRef?.cwd ?? process.cwd(),
					agentDir: getAgentDir(),
					sessionsDir: join(wechatDir(), "sessions"),
					model: ctxRef?.model,
					thinkingLevel: ctxRef?.thinkingLevel,
					// The peer's dialogs go to that peer only when `remotePrompts` is on;
					// the terminal's own UI is never adapted, so a local turn keeps its dialogs.
					uiContext: createPeerUIContext(options.channel, (message) => ctxRef?.ui.notify(message), {
						prompts: config.remotePrompts,
					}),
					onError: (message) => ctxRef?.ui.notify(`WeChat peer session: ${message}`, "warning"),
					onWarning: (message) => ctxRef?.ui.notify(message, "warning"),
					toolAllowlist: peerTools.get(peerKey(peer)),
					fresh: options.fresh,
				}),
			mediaDir: () => join(wechatDir(), "media"),
			readHistory: (peer, count) =>
				readPeerHistory(ctxRef?.cwd ?? process.cwd(), join(wechatDir(), "sessions"), peer, count),
			slashCommands: SLASH_COMMANDS,
			loadAccount: () => primaryAccount(),
			loadState: () => readState(statePath()),
			saveState: (state) => writeState(statePath(), state),
			createClient: (account) =>
				makeClient({
					http: createFetchRunner(),
					channelVersion: config.channelVersion,
					botAgent: config.botAgent,
					baseUrl: account.baseUrl,
					cdnBaseUrl: config.cdnBaseUrl,
				}),
			sleep: deps.sleep,
			acquireLock: () => acquireLock(lockPath(), lockDeps()),
			refreshLock: () => refreshLock(lockPath(), lockDeps()),
			releaseLock: () => releaseLock(lockPath(), process.pid),
			loadLock: () => readLock(lockPath()),
			notify: (message, kind) => {
				ctxRef?.ui.notify(message, kind);
			},
			onStateChange: (state) => {
				const ui = ctxRef?.ui;
				if (!ui) return;
				try {
					ui.setStatus(STATUS_KEYS.wechat, wechatChip(ui.theme, state));
				} catch {
					// The chip is best-effort; a headless or themeless UI must not break open/close.
				}
			},
		});
	};

	/**
	 * Bring the bridge up on a new session while an account is stored.
	 *
	 * The bridge is built and kept once per runtime — everything else in this
	 * file reads the same handle — and an open bridge makes a repeat call a
	 * no-op, so a host that binds one session twice (RPC emits `session_start`
	 * twice on a session switch) cannot start a second poller.
	 */
	const autoStart = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		if (!primaryAccount()) return;
		if (bridge?.status().open || bridge?.status().paused) return;
		try {
			bridge = bridge ?? build(ctx);
			bridge.open();
		} catch (error) {
			ctx.ui.notify(`WeChat did not connect: ${messageOf(error)}`, "warning");
		}
	};

	const commandDeps: CommandDeps = {
		getBridge: () => bridge,
		ensureBridge: (ctx) => {
			if (!bridge) bridge = build(ctx);
			return bridge;
		},
		loadConfig: (cwd) => loadWechatConfig(cwd),
		createLoginClient: (cwd) => {
			const config = loadWechatConfig(cwd);
			return makeClient({
				http: createFetchRunner(),
				channelVersion: config.channelVersion,
				botAgent: config.botAgent,
				cdnBaseUrl: config.cdnBaseUrl,
			});
		},
		saveAccount,
		primaryAccount,
		readHistory: (peer, count) =>
			readPeerHistory(ctxRef?.cwd ?? process.cwd(), join(wechatDir(), "sessions"), peer, count),
		logout: () => {
			clearCredentials();
			// The account is the on/off switch: without one there is nothing to report,
			// so drop the handle rather than leave `/wechat` showing the old owner and
			// counters. The next `ensureBridge`/`autoStart` builds a fresh bridge from
			// the new account.
			bridge = undefined;
		},
		now: () => Date.now(),
	};

	registerCommands(pi, commandDeps);
	registerTools(pi, { getBridge: () => bridge });

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
		// Stored credentials mean the bridge should be polling, so a new session
		// (startup, reload, `/new`, resume, fork) reconnects it without a command.
		autoStart(ctx);
	});
	pi.on("session_shutdown", async () => {
		// Shutdown is emitted before the host resets the UI, so the chip is still ours to clear.
		ctxRef?.ui.setStatus(STATUS_KEYS.wechat, undefined);
		try {
			await bridge?.shutdown();
		} finally {
			// A throwing close must not leave a live handle on a dead runtime.
			bridge = undefined;
			ctxRef = undefined;
		}
	});
}
