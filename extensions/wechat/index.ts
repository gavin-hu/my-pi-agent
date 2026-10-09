/**
 * wechat — a thin bridge between the live Pi session and WeChat.
 *
 * The live Pi session is the agent: an inbound WeChat message becomes a user
 * turn (`pi.sendUserMessage`), and the assistant's reply is sent back. The
 * bridge never starts on its own — `/wechat open` connects and `/wechat close`
 * disconnects; `/wechat login` authenticates. See `README.md`.
 *
 * Load with:  pi --extension ./extensions/wechat
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createBridge, type Bridge } from "./bridge.ts";
import { createFetchRunner, WechatClient } from "./client.ts";
import { registerCommands, type CommandDeps } from "./commands.ts";
import { loadWechatConfig } from "./config.ts";
import { clearCredentials, primaryAccount, saveAccount } from "./credentials.ts";
import { acquireLock, lockPath, refreshLock, releaseLock } from "./lock.ts";
import { readState, statePath, writeState } from "./state.ts";

export default function wechat(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("wechat")) return;

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
		return createBridge({
			config,
			now: () => Date.now(),
			isIdle: () => ctxRef?.isIdle() ?? true,
			sendUserMessage: (text) => pi.sendUserMessage(text),
			loadAccount: () => primaryAccount(),
			loadState: () => readState(statePath()),
			saveState: (state) => writeState(statePath(), state),
			createClient: (account) =>
				new WechatClient({
					http: createFetchRunner(),
					channelVersion: config.channelVersion,
					botAgent: config.botAgent,
					baseUrl: account.baseUrl,
				}),
			acquireLock: () => acquireLock(lockPath(), lockDeps()),
			refreshLock: () => refreshLock(lockPath(), lockDeps()),
			releaseLock: () => releaseLock(lockPath(), process.pid),
			notify: (message, kind) => {
				ctxRef?.ui.notify(message, kind);
			},
		});
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
			});
		},
		saveAccount,
		primaryAccount,
		logout: () => clearCredentials(),
		now: () => Date.now(),
	};

	registerCommands(pi, deps);

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
	});
	pi.on("agent_start", () => bridge?.setBusy(true));
	pi.on("message_end", (event) => bridge?.capture(event.message));
	pi.on("agent_settled", () => bridge?.settle());
	pi.on("session_shutdown", async () => {
		await bridge?.shutdown();
		bridge = undefined;
		ctxRef = undefined;
	});
}
