/**
 * The `/wechat` command: `login`, `new`, `status`, `logout`, `help`.
 *
 * The command is the operator's single entry point. `/wechat` (or `/wechat
 * status`) opens the control screen, where every action is a key; the verb
 * subcommands are shortcuts for RPC and scripts. A confirmed `login` stores
 * credentials, replaces a poller that is already running, and connects in one
 * step, and the bridge otherwise auto-starts on `session_start` while an account
 * exists. `new` starts a fresh session (an inbound `/new` dispatches it), and
 * `logout` discards the account and stops the bridge. Every dialog-backed verb
 * declines while a WeChat turn owns the dialogs.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn, supportsCustomUI } from "../../lib/interaction.ts";
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

/** One `/wechat` verb and the line `/wechat help` shows for it. */
export interface WechatCommand {
	verb: string;
	description: string;
}

/**
 * Every `/wechat` verb, in the order `help` and the completions list them. The
 * help text, the usage line, and the tab completions are all derived from this
 * table, so a verb cannot be listed in one place and missed in another.
 */
export const WECHAT_COMMANDS = [
	{ verb: "login", description: "Log in by QR; on a scan, store the account and start the bridge" },
	{ verb: "new", description: "Start a fresh session" },
	{ verb: "status", description: "Open the control screen (a one-line summary outside the TUI)" },
	{ verb: "logout", description: "Clear the stored account and stop the bridge" },
	{ verb: "help", description: "List these commands" },
] as const satisfies readonly WechatCommand[];

export type WechatVerb = (typeof WECHAT_COMMANDS)[number]["verb"];

/** The bare verb names, for lookup and the usage line. */
export const WECHAT_VERBS: readonly WechatVerb[] = WECHAT_COMMANDS.map((command) => command.verb);

/** The one-line pointer to every subcommand, used by `help` and a typo. */
export const WECHAT_USAGE = `/wechat ${WECHAT_VERBS.join(" | ")}`;

/** The `/wechat help` notice: the usage line, then one line per verb. */
export function wechatHelp(): string {
	const lines = WECHAT_COMMANDS.map((command) => `  /wechat ${command.verb} — ${command.description}`);
	return [`wechat commands — ${WECHAT_USAGE}`, ...lines].join("\n");
}

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
export async function finishLogin(result: LoginOutcome, ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	switch (result.kind) {
		case "confirmed": {
			deps.saveAccount(result.account);
			const label = peerLabel(result.account.ilinkUserId);
			try {
				// A scan is authoritative: a poller that is already running holds the
				// previous client and its token, and `open()` is a no-op while it runs, so
				// it has to stop before the new credentials are used.
				await deps.getBridge()?.close();
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

	await finishLogin(result ?? { kind: "cancelled" }, ctx, deps);
}

/**
 * Start a fresh session. Reachable as `/wechat new` from the terminal and
 * dispatched by the inbound `/new` command; the new `session_start` auto-opens
 * the bridge again because the account is stored.
 */
export async function runNew(ctx: ExtensionCommandContext): Promise<void> {
	// A WeChat turn is a real run in this session: replacing the session under it
	// drops the turn, stops the bridge on shutdown, and leaves the peer unanswered.
	// The inbound `/new` declines the same case through `activeTurn`.
	if (busyWithRemoteTurn(ctx, "new")) return;
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
	if (!supportsCustomUI(ctx)) {
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
	if (!ctx.hasUI) {
		ctx.ui.notify("WeChat logout needs a confirmation dialog, which this mode has no UI for.", "warning");
		return;
	}
	if (busyWithRemoteTurn(ctx, "logout")) return;
	if (!(await ctx.ui.confirm("Log out of WeChat?", "Remove the stored credentials and close the bridge."))) return;
	await deps.getBridge()?.close();
	deps.logout();
	ctx.ui.notify("WeChat logged out.");
}

/** Complete the single wechat subcommand; anything after it is not tab-completed. */
function completeSubcommand(prefix: string): Array<{ value: string; label: string; description: string }> | null {
	const text = prefix.trimStart();
	if (text.includes(" ")) return null;
	const items = WECHAT_COMMANDS.filter((command) => command.verb.startsWith(text));
	return items.length > 0 ? items.map(({ verb, description }) => ({ value: verb, label: verb, description })) : null;
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
			ctx.ui.notify(wechatHelp());
			return;
	}
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description: "WeChat bridge. /wechat opens the control screen (login | new | status | logout | help)",
		getArgumentCompletions: completeSubcommand,
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
