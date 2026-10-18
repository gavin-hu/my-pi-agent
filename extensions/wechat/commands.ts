/**
 * The `/wechat` command: `login`, `new`, `status`, `logout`, `allow`, `help`.
 *
 * The command is the operator's single entry point. `/wechat` (or `/wechat
 * status`) opens the control screen, where every action is a key; the verb
 * subcommands are shortcuts for RPC and scripts. A confirmed `login` stores
 * credentials, replaces a poller that is already running, and connects in one
 * step, and the bridge otherwise auto-starts on `session_start` while an account
 * exists. `new` starts a fresh session (an inbound `/new` dispatches it), and
 * `logout` discards the account and stops the bridge. Every dialog-backed verb
 * declines while a WeChat peer turn is running.
 */

import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { writeConfigValue } from "../../lib/config.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { supportsCustomUI } from "../../lib/interaction.ts";
import { isAllowedPeer, type Bridge } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import type { WechatConfig } from "./config.ts";
import { doctorReport } from "./doctor.ts";
import { peerLabel, peerKey } from "./format.ts";
import { waitForLogin, type LoginOutcome } from "./login.ts";
import { defaultSleep } from "./timer.ts";
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
	/** Read a peer's recent messages for `/wechat history`; read-only. */
	readHistory: (peer: string, count: number) => Promise<string>;
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
	{ verb: "new", description: "Start a fresh host session (peer conversations are independent)" },
	{ verb: "status", description: "Open the control screen (a one-line summary outside the TUI)" },
	{ verb: "doctor", description: "Print a health report: token age, last poll, lock, peers, failures" },
	{ verb: "stop", description: "Stop one peer's running turn: /wechat stop <peer>" },
	{ verb: "reset", description: "Start a fresh conversation for one peer: /wechat reset <peer>" },
	{ verb: "history", description: "Print one peer's recent messages: /wechat history <peer> [n]" },
	{ verb: "allow", description: "Allow a refused sender in the project config: /wechat allow [peer]" },
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

import { messageOf } from "./errors.ts";
/**
 * Whether a peer turn is running anywhere on the bridge.
 *
 * Peer turns run in their own sessions, so this is a bridge fact — not the
 * terminal turn's UI mode. It is what a terminal-side `/wechat` verb checks:
 * `new` would replace the host session and shut the bridge down under the peer's
 * answer, and `login`/`logout` would drop the connection mid-turn.
 */
function peerTurnRunning(deps: CommandDeps): boolean {
	return deps.getBridge()?.status().running === true;
}

/** Whether a peer turn currently blocks this verb, reported instead of running it. */
function busyWithPeerTurn(ctx: ExtensionContext, deps: CommandDeps, verb: string): boolean {
	if (!peerTurnRunning(deps)) return false;
	ctx.ui.notify(
		`A WeChat turn is in progress, so /wechat ${verb} is unavailable here. Finish the turn, then retry.`,
		"warning",
	);
	return true;
}

/** Print the read-only health report, in the TUI, over RPC, or in a script. */
async function runDoctor(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	ctx.ui.notify(
		doctorReport({
			status: deps.getBridge()?.status(),
			account: deps.primaryAccount(),
			config: deps.loadConfig(ctx.cwd),
			now: deps.now(),
		}),
	);
}

/** Add a refused sender to the project config after the operator confirms. */
async function runAllow(ctx: ExtensionContext, deps: CommandDeps, peerArg?: string): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("WeChat allow needs a confirmation dialog, which this mode has no UI for.", "warning");
		return;
	}
	const candidate = peerArg?.trim() || (await chooseRefused(ctx, deps));
	if (!candidate) return;
	const config = deps.loadConfig(ctx.cwd);
	if (isAllowedPeer(candidate, undefined, config.allowedPeers)) {
		ctx.ui.notify(`${sanitizeLine(peerLabel(candidate))} is already allowed.`);
		return;
	}
	const relative = join(CONFIG_DIR_NAME, "bytefly.json");
	const label = sanitizeLine(peerLabel(candidate));
	const confirmed = await ctx.ui.confirm(`Allow ${label}?`, `Add this sender to wechat.allowedPeers in ${relative}?`);
	if (!confirmed) return;
	try {
		writeConfigValue(join(ctx.cwd, relative), "wechat", "allowedPeers", [...config.allowedPeers, candidate]);
		ctx.ui.notify(`Saved ${label} to ${relative}. Run /reload or restart Pi to apply.`);
	} catch (error) {
		ctx.ui.notify(`Could not save the allowlist: ${messageOf(error)}`, "error");
	}
}

/** Pick one of the refused senders, or explain that there is nothing to allow. */
async function chooseRefused(ctx: ExtensionContext, deps: CommandDeps): Promise<string | undefined> {
	const refused = deps.getBridge()?.status().refusedPeers ?? [];
	if (refused.length === 0) {
		ctx.ui.notify("No refused sender to allow.", "warning");
		return undefined;
	}
	return ctx.ui.select("Allow which sender?", refused);
}

/** Print one peer's recent messages; read-only, and works without a live session. */
async function runHistory(ctx: ExtensionCommandContext, deps: CommandDeps, args: string): Promise<void> {
	const [peer = "", countArg] = args.trim().split(/\s+/).filter(Boolean);
	const bridge = deps.getBridge();
	if (!peer) {
		const known = bridge?.status().peerStates.map((entry) => peerLabel(entry.peer)) ?? [];
		ctx.ui.notify(`Usage: /wechat history <peer> [n]. Known: ${known.join(", ") || "none yet"}.`, "warning");
		return;
	}
	const requested = Number.parseInt(countArg ?? "", 10);
	const count = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 10));
	try {
		const text = await deps.readHistory(peer, count);
		ctx.ui.notify(text || `No history yet for ${peerLabel(peer)}.`);
	} catch (error) {
		ctx.ui.notify(`WeChat history failed: ${messageOf(error)}`, "warning");
	}
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
	if (busyWithPeerTurn(ctx, deps, "login")) return;
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
 * Start a fresh host session for `/wechat new`; the next `session_start`
 * auto-opens the bridge again because the account is stored.
 */
export async function runNew(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
	// A WeChat peer turn is a real run on this bridge: replacing the host session
	// emits `session_shutdown`, which stops the poller and abandons that turn, so
	// the peer would be left unanswered. The inbound `/new` declines the same case
	// through `activeTurn`.
	if (busyWithPeerTurn(ctx, deps, "new")) return;
	await ctx.newSession();
}

/**
 * The control screen: connection facts plus every action as a key. Outside the
 * TUI, and during a peer turn (whose shutdown a screen action could race), it
 * collapses to the one-line summary. The screen returns an action instead of
 * running it, so the QR login screen is never opened while the control screen
 * still owns input focus.
 */
async function runPanel(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
	const view = (): StatusView => statusView(deps.primaryAccount(), deps.getBridge()?.status());
	if (peerTurnRunning(deps) || !supportsCustomUI(ctx)) {
		ctx.ui.notify(statusLine(view()));
		return;
	}
	const action = await ctx.ui.custom<StatusAction>(
		(tui, theme, _keybindings, done) =>
			new StatusScreenComponent({
				theme,
				view,
				onClose: done,
				actions: {
					stop: (peer) => {
						const bridge = deps.getBridge();
						if (!bridge) return "WeChat bridge is not running.";
						return bridge.stop(peer) ? `Stopping ${peerLabel(peer)}.` : `${peerLabel(peer)} has no running turn.`;
					},
					reset: (peer) => {
						const bridge = deps.getBridge();
						if (!bridge) return "WeChat bridge is not running.";
						return bridge.reset(peer)
							? `Started a fresh conversation for ${peerLabel(peer)}.`
							: `${peerLabel(peer)} is running; stop it before starting fresh.`;
					},
					cancelPrompt: () => {
						const bridge = deps.getBridge();
						if (!bridge?.status().promptPending) return "No prompt is waiting.";
						bridge.channel().cancel();
						return "Cancelled the waiting prompt.";
					},
				},
				requestRender: () => tui.requestRender(),
			}),
	);
	if (typeof action === "object" && action?.kind === "history") {
		await runHistory(ctx, deps, action.peer);
		return;
	}
	if (typeof action === "object" && action?.kind === "allow") {
		await runAllow(ctx, deps);
		return;
	}
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
	if (busyWithPeerTurn(ctx, deps, "logout")) return;
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

/** Act on one peer from the terminal: stop its turn or reset its conversation. */
async function runPeerAction(
	ctx: ExtensionCommandContext,
	deps: CommandDeps,
	verb: "stop" | "reset",
	args: string,
): Promise<void> {
	const bridge = deps.getBridge();
	if (!bridge) {
		ctx.ui.notify("WeChat bridge is not started. Run /wechat login first.", "warning");
		return;
	}
	const wanted = args.trim();
	const known = bridge.status().peerStates.map((row) => peerLabel(row.peer));
	const entry = wanted ? bridge.status().peerStates.find((row) => peerKey(row.peer) === peerKey(wanted)) : undefined;
	if (!entry) {
		ctx.ui.notify(
			`Unknown WeChat peer${wanted ? ` "${wanted}"` : ""}. Known: ${known.join(", ") || "none yet"}.`,
			"warning",
		);
		return;
	}
	const label = peerLabel(entry.peer);
	if (verb === "stop") {
		ctx.ui.notify(bridge.stop(entry.peer) ? `Stopping ${label}'s turn.` : `${label} has no running turn.`);
		return;
	}
	ctx.ui.notify(
		bridge.reset(entry.peer)
			? `Started a fresh conversation for ${label}.`
			: `${label} is running; stop it before starting a new conversation.`,
	);
}

/** Run one verb. The control screen reuses this so a key and a subcommand agree. */
async function dispatch(
	verb: WechatVerb,
	ctx: ExtensionCommandContext,
	deps: CommandDeps,
	peerArg = "",
): Promise<void> {
	switch (verb) {
		case "login":
			return runLogin(ctx, deps);
		case "new":
			return runNew(ctx, deps);
		case "status":
			return runPanel(ctx, deps);
		case "doctor":
			return runDoctor(ctx, deps);
		case "history":
			return runHistory(ctx, deps, peerArg);
		case "allow":
			return runAllow(ctx, deps, peerArg || undefined);
		case "stop":
			return runPeerAction(ctx, deps, "stop", peerArg);
		case "reset":
			return runPeerAction(ctx, deps, "reset", peerArg);
		case "logout":
			return runLogout(ctx, deps);
		case "help":
			ctx.ui.notify(wechatHelp());
			return;
	}
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description:
			"WeChat bridge. /wechat opens the control screen (login | new | status | doctor | stop | reset | history | allow | logout | help)",
		getArgumentCompletions: completeSubcommand,
		handler: async (args, ctx) => {
			const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const verb = sub.toLowerCase();
			if (!isWechatVerb(verb)) {
				ctx.ui.notify(`Unknown wechat command "${sub}". Try ${WECHAT_USAGE}.`, "warning");
				return;
			}
			return dispatch(verb, ctx, deps, rest.join(" "));
		},
	});
}
