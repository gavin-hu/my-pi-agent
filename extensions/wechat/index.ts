/**
 * wechat — a thin bridge between the live Pi session and WeChat.
 *
 * The live Pi session is the agent: an inbound WeChat message becomes a user
 * turn (`pi.sendUserMessage`), and the assistant's reply is sent back. The
 * bridge never starts on its own — `/wechat start` connects and `/wechat stop`
 * disconnects; `/wechat login` authenticates. See `README.md`.
 *
 * Load with:  pi --extension ./extensions/wechat
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { isExtensionEnabled } from "../../lib/env.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { createBridge, type Bridge } from "./bridge.ts";
import { createFetchRunner, WechatClient } from "./client.ts";
import { registerCommands, type CommandDeps } from "./commands.ts";
import { loadWechatConfig } from "./config.ts";
import { clearCredentials, primaryAccount, saveAccount, wechatDir } from "./credentials.ts";
import { acquireLock, lockPath, refreshLock, releaseLock } from "./lock.ts";
import { installRemoteUI } from "./remote-ui.ts";
import { readState, statePath, writeState } from "./state.ts";
import { registerTools } from "./tools.ts";

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
			onStateChange: (running) => {
				const ui = ctxRef?.ui;
				if (!ui) return;
				try {
					ui.setStatus(STATUS_KEYS.wechat, running ? ui.theme.fg("success", `${GLYPHS.wechat} wechat`) : undefined);
				} catch {
					// The chip is best-effort; a headless or themeless UI must not break start/stop.
				}
			},
		});
		if (config.remotePrompts) installAdapter(ctx, created);
		return created;
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
