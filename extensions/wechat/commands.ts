/**
 * The `/wechat` command: `login`, `new`, `status`, `logout`.
 *
 * `login` renders the QR screen, stores credentials, and connects in one step;
 * the bridge otherwise auto-starts on `session_start` while an account exists.
 * `new` starts a fresh session (an inbound `/new` dispatches it), and `logout`
 * discards the account and stops the bridge.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Bridge } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import type { WechatConfig } from "./config.ts";
import { peerLabel } from "./format.ts";
import { defaultSleep, waitForLogin, type LoginOutcome } from "./login.ts";
import { LoginScreenComponent, type LoginViewState } from "./login-screen.ts";
import { qrLines } from "./qrcode.ts";
import { statusLine, statusView, StatusScreenComponent, type StatusAction, type StatusView } from "./status-screen.ts";
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

/**
 * React to a finished login. A confirmed scan stores the account and starts the
 * bridge immediately, so `/wechat login` is the only command needed to go
 * online; `/wechat start` still reconnects after a `/wechat stop`.
 */
export function finishLogin(result: LoginOutcome, ctx: ExtensionContext, deps: CommandDeps): void {
	switch (result.kind) {
		case "confirmed": {
			deps.saveAccount(result.account);
			const label = peerLabel(result.account.ilinkUserId);
			try {
				deps.ensureBridge(ctx).open();
				ctx.ui.notify(`WeChat connected as ${label} and the bridge is running.`);
			} catch (error) {
				ctx.ui.notify(
					`WeChat connected as ${label}, but the bridge did not start: ${messageOf(error)}. Run /wechat start.`,
					"warning",
				);
			}
			return;
		}
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

	finishLogin(result, ctx, deps);
}

/**
 * Start a fresh session. Reachable as `/wechat new` from the terminal and
 * dispatched by the inbound `/new` command; the new `session_start` auto-opens
 * the bridge again because the account is stored.
 */
export async function runNew(ctx: ExtensionCommandContext): Promise<void> {
	await ctx.newSession();
}

async function runStatus(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	const view = (): StatusView => statusView(deps.primaryAccount(), deps.getBridge()?.status());
	if (ctx.mode !== "tui") {
		ctx.ui.notify(statusLine(view()));
		return;
	}
	// The screen returns an action instead of running it, so the QR login screen
	// is never opened while the status screen still owns input focus.
	const action = await ctx.ui.custom<StatusAction>(
		(tui, theme, _keybindings, done) =>
			new StatusScreenComponent({
				theme,
				view,
				onClose: done,
				requestRender: () => tui.requestRender(),
			}),
	);
	switch (action) {
		case "login":
			return runLogin(ctx, deps);
		default:
			return;
	}
}

async function runLogout(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	if (!(await ctx.ui.confirm("Log out of WeChat?", "Remove the stored credentials and close the bridge."))) return;
	await deps.getBridge()?.close();
	deps.logout();
	ctx.ui.notify("WeChat logged out.");
}

const WECHAT_SUBCOMMANDS = ["login", "new", "status", "logout"];

/** Complete the single wechat subcommand; anything after it is not tab-completed. */
function completeSubcommand(
	prefix: string,
	options: readonly string[],
): Array<{ value: string; label: string }> | null {
	const text = prefix.trimStart();
	if (text.includes(" ")) return null;
	const items = options.filter((option) => option.startsWith(text));
	return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description: "WeChat bridge: /wechat login | new | status | logout",
		getArgumentCompletions: (prefix) => completeSubcommand(prefix, WECHAT_SUBCOMMANDS),
		handler: async (args, ctx) => {
			const [sub = "status"] = args.trim().split(/\s+/).filter(Boolean);
			switch (sub.toLowerCase()) {
				case "login":
					return runLogin(ctx, deps);
				case "new":
					return runNew(ctx);
				case "logout":
					return runLogout(ctx, deps);
				default:
					return runStatus(ctx, deps);
			}
		},
	});
}
