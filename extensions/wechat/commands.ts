/**
 * The `/wechat` command: `login`, `new`, `status`, `logout`, `help`.
 *
 * The command is the operator's single entry point. `/wechat` (or `/wechat
 * status`) opens the control screen, where every action is a key; the verb
 * subcommands are shortcuts for RPC and scripts. A confirmed `login` stores
 * credentials and connects in one step, and the bridge otherwise auto-starts on
 * `session_start` while an account exists. `new` starts a fresh session (an
 * inbound `/new` dispatches it), and `logout` discards the account and stops the
 * bridge.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn } from "../../lib/interaction.ts";
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

/** Every `/wechat` verb, in the order `/wechat help` lists them. */
export const WECHAT_VERBS = ["login", "new", "status", "logout", "help"] as const;
export type WechatVerb = (typeof WECHAT_VERBS)[number];

/** The one-line pointer to every subcommand, used by `help` and a typo. */
export const WECHAT_USAGE = "/wechat login | new | status | logout | help";

/** Whether `value` names a known `/wechat` verb. */
export function isWechatVerb(value: string): value is WechatVerb {
	return (WECHAT_VERBS as readonly string[]).includes(value);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a WeChat turn currently owns the dialogs, reported instead of opening
 * a screen. While it runs, `ctx.ui.custom` resolves `undefined` (the remote
 * adapter refuses full-screen components) and `ctx.ui.select`/`confirm` are
 * forwarded to WeChat, so a terminal-side command must decline rather than
 * open its dialog on the phone or read back nothing.
 */
function busyWithRemoteTurn(ctx: ExtensionContext, verb: string): boolean {
	if (!isRemoteTurn(ctx)) return false;
	ctx.ui.notify(
		`A WeChat turn is in progress, so /wechat ${verb} is unavailable here. Finish the turn, then retry.`,
		"warning",
	);
	return true;
}

/**
 * React to a finished login. A confirmed scan stores the account and starts the
 * bridge immediately, so `/wechat login` is the only command needed to go
 * online and the recovery path after a session expiry.
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
					`WeChat connected as ${label}, but the bridge did not start: ${messageOf(error)}. Run /wechat status for details.`,
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
	if (busyWithRemoteTurn(ctx, "login")) return;
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
	const result = await ctx.ui.custom<LoginOutcome | undefined>((tui, theme, _keybindings, done) => {
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

	finishLogin(result ?? { kind: "cancelled" }, ctx, deps);
}

/**
 * Start a fresh session. Reachable as `/wechat new` from the terminal and
 * dispatched by the inbound `/new` command; the new `session_start` auto-opens
 * the bridge again because the account is stored.
 */
export async function runNew(ctx: ExtensionCommandContext): Promise<void> {
	await ctx.newSession();
}

/**
 * The control screen: connection facts plus every action as a key. Outside the
 * TUI, and during a WeChat turn (which owns the dialogs), it collapses to the
 * one-line summary. The screen returns an action instead of running it, so the
 * QR login screen is never opened while the control screen still owns input
 * focus.
 */
async function runPanel(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
	const view = (): StatusView => statusView(deps.primaryAccount(), deps.getBridge()?.status());
	if (ctx.mode !== "tui" || isRemoteTurn(ctx)) {
		ctx.ui.notify(statusLine(view()));
		return;
	}
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
		case "new":
		case "logout":
			await dispatch(action, ctx, deps);
			return;
		default:
			return;
	}
}

async function runLogout(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	if (busyWithRemoteTurn(ctx, "logout")) return;
	if (!(await ctx.ui.confirm("Log out of WeChat?", "Remove the stored credentials and close the bridge."))) return;
	await deps.getBridge()?.close();
	deps.logout();
	ctx.ui.notify("WeChat logged out.");
}

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

/** Run one verb. The control screen reuses this so a key and a subcommand agree. */
async function dispatch(verb: WechatVerb, ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
	switch (verb) {
		case "login":
			return runLogin(ctx, deps);
		case "new":
			return runNew(ctx);
		case "status":
			return runPanel(ctx, deps);
		case "logout":
			return runLogout(ctx, deps);
		case "help":
			ctx.ui.notify(`wechat commands — ${WECHAT_USAGE}`);
			return;
	}
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description: "WeChat bridge. /wechat opens the control screen (login | new | status | logout | help)",
		getArgumentCompletions: (prefix) => completeSubcommand(prefix, WECHAT_VERBS),
		handler: async (args, ctx) => {
			const [sub = "status"] = args.trim().split(/\s+/).filter(Boolean);
			const verb = sub.toLowerCase();
			if (!isWechatVerb(verb)) {
				ctx.ui.notify(`Unknown wechat command "${sub}". Try ${WECHAT_USAGE}.`, "warning");
				return;
			}
			return dispatch(verb, ctx, deps);
		},
	});
}
