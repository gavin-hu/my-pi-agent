/**
 * wechat — a thin bridge between the live Pi session and WeChat.
 *
 * The live Pi session is the agent: an inbound WeChat message becomes a user
 * turn (`pi.sendUserMessage`), and the assistant's reply is sent back. The
 * bridge follows the stored account: it opens on `session_start` while
 * credentials exist (and after `/wechat login`), and `/wechat logout` is the
 * only way to discard the account and stop it. `/wechat` opens the control
 * screen. See `README.md`.
 *
 * Load with:  pi --extension ./extensions/wechat
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { isExtensionEnabled } from "../../lib/env.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { createBridge, type Bridge, type BridgeState } from "./bridge.ts";
import { createFetchRunner, WechatClient } from "./client.ts";
import { registerCommands, type CommandDeps } from "./commands.ts";
import { loadWechatConfig } from "./config.ts";
import { clearCredentials, primaryAccount, saveAccount, wechatDir } from "./credentials.ts";
import { acquireLock, lockPath, refreshLock, releaseLock } from "./lock.ts";
import { installRemoteUI } from "./remote-ui.ts";
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
		case "stopped":
			return undefined;
	}
}

export default function wechat(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("wechat")) return;

	let bridge: Bridge | undefined;
	let ctxRef: ExtensionContext | undefined;
	let uninstallRemoteUI: (() => void) | undefined;
	let remotePromptsEnabled = false;

	/** Point the shared UI's dialog routing at the bridge's channel. */
	const installAdapter = (ctx: ExtensionContext, target: Bridge): void => {
		if (!ctx.hasUI) return;
		uninstallRemoteUI?.();
		uninstallRemoteUI = installRemoteUI(ctx.ui, target.channel());
	};

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
		remotePromptsEnabled = config.remotePrompts;
		const created = createBridge({
			config,
			now: () => Date.now(),
			isIdle: () => ctxRef?.isIdle() ?? true,
			sendUserMessage: (content) => pi.sendUserMessage(content),
			mediaDir: () => join(wechatDir(), "media"),
			slashCommands: SLASH_COMMANDS,
			sessionControls: () => ({
				newSession: () => pi.sendUserMessage("/wechat new", { expandPromptTemplates: true }),
			}),
			loadAccount: () => primaryAccount(),
			loadState: () => readState(statePath()),
			saveState: (state) => writeState(statePath(), state),
			createClient: (account) =>
				new WechatClient({
					http: createFetchRunner(),
					channelVersion: config.channelVersion,
					botAgent: config.botAgent,
					baseUrl: account.baseUrl,
					cdnBaseUrl: config.cdnBaseUrl,
				}),
			acquireLock: () => acquireLock(lockPath(), lockDeps()),
			refreshLock: () => refreshLock(lockPath(), lockDeps()),
			releaseLock: () => releaseLock(lockPath(), process.pid),
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
		if (config.remotePrompts) installAdapter(ctx, created);
		return created;
	};

	/** Bring the bridge up on a new session while an account is stored. */
	const autoStart = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		if (!primaryAccount()) return;
		if (bridge?.status().open) return;
		try {
			const target = bridge ?? build(ctx);
			target.open();
		} catch (error) {
			ctx.ui.notify(`WeChat did not connect: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	};

	const deps: CommandDeps = {
		getBridge: () => bridge,
		ensureBridge: (ctx) => {
			if (!bridge) bridge = build(ctx);
			return bridge;
		},
		loadConfig: (cwd) => loadWechatConfig(cwd),
		createLoginClient: (cwd) => {
			const config = loadWechatConfig(cwd);
			return new WechatClient({
				http: createFetchRunner(),
				channelVersion: config.channelVersion,
				botAgent: config.botAgent,
				cdnBaseUrl: config.cdnBaseUrl,
			});
		},
		saveAccount,
		primaryAccount,
		logout: () => clearCredentials(),
		now: () => Date.now(),
	};

	registerCommands(pi, deps);
	registerTools(pi, { getBridge: () => bridge });

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
		// `/reload` rebuilds the runner's UI object; re-point the adapter at it.
		if (bridge && remotePromptsEnabled) installAdapter(ctx, bridge);
		// Stored credentials mean the bridge should be polling, so a new session
		// (startup, reload, `/new`, resume, fork) reconnects it without a command.
		autoStart(ctx);
	});
	pi.on("agent_start", () => bridge?.setBusy(true));
	pi.on("message_end", (event) => bridge?.capture(event.message));
	pi.on("agent_settled", () => bridge?.settle());
	pi.on("session_shutdown", async () => {
		uninstallRemoteUI?.();
		uninstallRemoteUI = undefined;
		ctxRef?.ui.setStatus(STATUS_KEYS.wechat, undefined);
		await bridge?.shutdown();
		bridge = undefined;
		ctxRef = undefined;
	});
}
