/**
 * The `/wechat` command: `login`, `start`, `stop`, `status`, `logout`.
 *
 * `login` renders the QR screen and stores credentials; it does not open the
 * connection. `start`/`stop` control the bridge at runtime; `logout` discards
 * the account.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Bridge } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import type { WechatConfig } from "./config.ts";
import { peerLabel } from "./format.ts";
import { defaultSleep, waitForLogin, type LoginOutcome } from "./login.ts";
import { LoginScreenComponent, type LoginViewState } from "./login-screen.ts";
import { qrLines } from "./qrcode.ts";
import type { BotCredentials } from "./types.ts";

export interface CommandDeps {
	getBridge: () => Bridge | undefined;
	ensureBridge: (ctx: ExtensionContext) => Bridge;
	loadConfig: (cwd: string) => WechatConfig;
	createLoginClient: (cwd: string) => WechatClient;
	saveAccount: (account: BotCredentials) => void;
	primaryAccount: () => BotCredentials | undefined;
	logout: () => void;
	now: () => number;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runLogin(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("WeChat login needs the interactive terminal UI.", "warning");
		return;
	}
	const client = deps.createLoginClient(ctx.cwd);
	const config = deps.loadConfig(ctx.cwd);

	let qr: { qrcode: string; imgContent: string };
	try {
		qr = await client.fetchQr();
	} catch (error) {
		ctx.ui.notify(`WeChat login failed: ${messageOf(error)}`, "error");
		return;
	}

	const state: LoginViewState = { status: "wait", lines: qrLines(qr.imgContent), url: qr.imgContent };
	const result = await ctx.ui.custom<LoginOutcome>((tui, theme, _keybindings, done) => {
		const controller = new AbortController();
		void (async () => {
			const outcome = await waitForLogin(client, qr, {
				botAgent: config.botAgent,
				now: deps.now,
				sleep: defaultSleep,
				signal: controller.signal,
				onStatus: (status) => {
					state.status = status;
					tui.requestRender();
				},
				requestVerifyCode: () => ctx.ui.input("Verification code", "code"),
			});
			done(outcome);
		})();
		return new LoginScreenComponent({
			theme,
			state: () => state,
			onCancel: () => {
				controller.abort();
				done({ kind: "cancelled" });
			},
			requestRender: () => tui.requestRender(),
		});
	});

	switch (result.kind) {
		case "confirmed":
			deps.saveAccount(result.account);
			ctx.ui.notify(`WeChat connected as ${peerLabel(result.account.ilinkUserId)}. Run /wechat start.`);
			return;
		case "expired":
			ctx.ui.notify("WeChat QR code expired. Run /wechat login again.", "warning");
			return;
		case "error":
			ctx.ui.notify(`WeChat login failed: ${result.message}`, "error");
			return;
		case "cancelled":
			return;
	}
}

function runStart(ctx: ExtensionContext, deps: CommandDeps): void {
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
		ctx.ui.notify("WeChat opens only in an interactive or RPC session.", "warning");
		return;
	}
	const bridge = deps.ensureBridge(ctx);
	try {
		bridge.open();
		ctx.ui.notify("WeChat bridge started.");
	} catch (error) {
		ctx.ui.notify(`WeChat start failed: ${messageOf(error)}`, "warning");
	}
}

async function runStop(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	const bridge = deps.getBridge();
	if (!bridge) {
		ctx.ui.notify("WeChat bridge is not initialized.");
		return;
	}
	await bridge.close();
	ctx.ui.notify("WeChat bridge stopped.");
}

function runStatus(ctx: ExtensionContext, deps: CommandDeps): void {
	const account = deps.primaryAccount();
	const status = deps.getBridge()?.status();
	const parts = [
		account ? `account ${peerLabel(account.ilinkUserId)}` : "not logged in",
		status?.open ? "open" : "closed",
	];
	if (status) {
		parts.push(`${status.peerCount} peer(s)`, `${status.queued} queued`);
		if (status.refused > 0) parts.push(`${status.refused} refused`);
		if (status.mediaDropped > 0) parts.push(`${status.mediaDropped} media dropped`);
		if (status.owner) parts.push(`owner ${peerLabel(status.owner)}`);
	}
	ctx.ui.notify(`wechat: ${parts.join(" · ")}`);
}

async function runLogout(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	if (!(await ctx.ui.confirm("Log out of WeChat?", "Remove the stored credentials and close the bridge."))) return;
	await deps.getBridge()?.close();
	deps.logout();
	ctx.ui.notify("WeChat logged out.");
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description: "WeChat bridge: /wechat login | start | stop | status | logout",
		handler: async (args, ctx) => {
			const [sub = "status"] = args.trim().split(/\s+/).filter(Boolean);
			switch (sub.toLowerCase()) {
				case "login":
					return runLogin(ctx, deps);
				case "start":
					return runStart(ctx, deps);
				case "stop":
					return runStop(ctx, deps);
				case "logout":
					return runLogout(ctx, deps);
				default:
					return runStatus(ctx, deps);
			}
		},
	});
}
