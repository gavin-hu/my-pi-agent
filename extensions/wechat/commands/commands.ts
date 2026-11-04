/**
 * The `/wechat` command: `start`, `stop`, `login`, `new`, `status`, `logout`, `allow`, `help`.
 *
 * The command is the operator's single entry point. `/wechat` (or `/wechat
 * status`) opens the control screen, where every action is a key; the verb
 * subcommands are shortcuts for RPC and scripts. `start` binds the stored account
 * to this session and opens the bridge, and `stop` closes it and records the
 * stop; nothing starts on its own, so a login only stores the account. `new`
 * starts a fresh session (an inbound `/new` dispatches it), and `logout` discards
 * the account and stops the bridge. Every dialog-backed verb declines while a
 * WeChat peer turn is running.
 */

import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { writeConfigValue } from "../../../lib/config.ts";
import { sanitizeLine } from "../../../lib/format.ts";
import { supportsCustomUI } from "../../../lib/interaction.ts";
import type { Bridge } from "../bridge.ts";
import type { WechatClient } from "../transport/client.ts";
import type { WechatConfig } from "../config.ts";
import type { StatusAction } from "../view/status-screen.ts";
import type { LoginViewState } from "../view/login-screen.ts";
import type { LoginOutcome } from "./login.ts";
import { doctorReport } from "./doctor.ts";
import { messageOf } from "../../../lib/errors.ts";
import { peerLabel, peerKey } from "../text/format.ts";
import { defaultSleep } from "../timer.ts";
import { qrLines } from "../../../lib/qr.ts";
import { statusLine, statusView, type StatusView } from "../text/status.ts";
import type { BotCredentials } from "../types.ts";

/**
 * What a start did: it bound this session, the bridge was already running for it, or
 * a stop landed while it was building and the session is left stopped.
 */
export type StartOutcome = "started" | "already-running" | "superseded";

export interface CommandDeps {
	getBridge: () => Bridge | undefined;
	/** Start and bind the bridge on this session; throws with the reason it cannot. */
	startBridge: (ctx: ExtensionContext) => Promise<StartOutcome>;
	/** Stop and unbind it; whether it was running. */
	stopBridge: () => Promise<boolean>;
	loadConfig: (cwd: string) => WechatConfig;
	createLoginClient: (cwd: string) => Promise<WechatClient>;
	saveAccount: (account: BotCredentials) => void;
	storedAccount: () => BotCredentials | undefined;
	/** Read a peer's recent messages for `/wechat history`; read-only. */
	readHistory: (peer: string, count: number) => Promise<string>;
	logout: () => void | Promise<void>;
	now: () => number;
}

/** One `/wechat` verb: the line `/wechat help` shows, and the runner every caller shares. */
export interface WechatCommand {
	verb: string;
	description: string;
	/** Run the verb. The control screen's closing actions reuse it. */
	run(ctx: ExtensionCommandContext, deps: CommandDeps, args: string): Promise<void>;
}

/**
 * Every `/wechat` verb, in the order `help` and the completions list them. The
 * help text, the usage line, the tab completions, the dispatch, and the command's
 * own description are all derived from this table, so a verb cannot be listed in
 * one place and missed in another.
 */
export const WECHAT_COMMANDS = [
	{ verb: "start", description: "Start the bridge on this session, bound to the stored account", run: runStart },
	{ verb: "login", description: "Log in by QR; a scan stores the account (then /wechat start)", run: runLogin },
	{ verb: "new", description: "Start a fresh host session (peer conversations are independent)", run: runNew },
	{ verb: "status", description: "Open the control screen (a one-line summary outside the TUI)", run: runPanel },
	{
		verb: "stop",
		description: "Stop the bridge on this session, or one peer's turn: /wechat stop [peer]",
		run: runStop,
	},
	{ verb: "doctor", description: "Print a health report: token age, last poll, lock, peers, failures", run: runDoctor },
	{
		verb: "reset",
		description: "Start a fresh conversation for one peer: /wechat reset <peer>",
		run: (ctx, deps, args) => runPeerAction(ctx, deps, "reset", args),
	},
	{
		verb: "history",
		description: "Print one peer's recent messages: /wechat history <peer> [n]",
		run: (ctx, deps, args) => runHistory(ctx, deps, args),
	},
	{
		verb: "allow",
		description: "Allow a refused sender in the project config: /wechat allow [peer]",
		run: (ctx, deps, args) => runAllow(ctx, deps, args || undefined),
	},
	{ verb: "logout", description: "Clear the stored account and stop the bridge", run: runLogout },
	{
		verb: "help",
		description: "List these commands",
		run: async (ctx) => {
			ctx.ui.notify(wechatHelp());
		},
	},
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

/**
 * Whether a peer turn is running anywhere on the bridge.
 *
 * Peer turns run in their own sessions, so this is a bridge fact — not the
 * terminal turn's UI mode. It is what a terminal-side `/wechat` verb checks:
 * `new` would replace the host session and shut the bridge down under the peer's
 * answer, and `login`/`logout` would drop the connection mid-turn.
 */
function peerTurnRunning(deps: CommandDeps): boolean {
	return deps.getBridge()?.status().turnsRunning === true;
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
			account: deps.storedAccount(),
			config: deps.loadConfig(ctx.cwd),
			now: deps.now(),
		}),
	);
}

/** One user-facing outcome: what to say, and how a non-screen caller says it. */
interface VerbOutcome {
	message: string;
	/** The notice kind the subcommand path posts; the control screen shows the text. */
	kind: "info" | "warning";
}

/**
 * The control verbs, in the one place both callers read them: the control
 * screen's keys and the `/wechat <verb>` subcommands. A peer label carries text
 * the peer chose, so it is sanitized here rather than at each call site.
 */
function peerStopMessage(bridge: Bridge, peer: string): VerbOutcome {
	const label = sanitizeLine(peerLabel(peer));
	return bridge.stop(peer)
		? { message: `Stopping ${label}'s turn.`, kind: "info" }
		: { message: `${label} has no running turn.`, kind: "info" };
}

function resetMessage(bridge: Bridge, peer: string): VerbOutcome {
	const label = sanitizeLine(peerLabel(peer));
	return bridge.reset(peer)
		? { message: `Started a fresh conversation for ${label}.`, kind: "info" }
		: { message: `${label} is running; stop it before starting a new conversation.`, kind: "info" };
}

function cancelPromptMessage(bridge: Bridge, peer: string): VerbOutcome {
	if (!bridge.status().prompts.some((prompt) => prompt.peer === peer)) {
		return { message: "No prompt is waiting.", kind: "info" };
	}
	void bridge.channel(peer).cancel();
	return { message: "Cancelled the waiting prompt.", kind: "info" };
}

/** Start the bridge on this session; the binding is recorded only once it polls. */
async function startOutcome(ctx: ExtensionContext, deps: CommandDeps): Promise<VerbOutcome> {
	try {
		const outcome = await deps.startBridge(ctx);
		if (outcome === "already-running") {
			return { message: "WeChat is already running on this session.", kind: "info" };
		}
		if (outcome === "superseded") {
			return { message: "A stop landed while WeChat was starting; it is not running here.", kind: "info" };
		}
		const account = deps.storedAccount();
		const label = account ? ` as ${sanitizeLine(peerLabel(account.ilinkUserId))}` : "";
		return { message: `WeChat bridge started${label}. /wechat stop closes it.`, kind: "info" };
	} catch (error) {
		return { message: `WeChat did not start: ${messageOf(error)}`, kind: "warning" };
	}
}

/** Stop the bridge on this session, which also releases the poller lock. */
async function stopOutcome(deps: CommandDeps): Promise<VerbOutcome> {
	return (await deps.stopBridge())
		? { message: "WeChat bridge stopped on this session.", kind: "info" }
		: { message: "WeChat is not running on this session.", kind: "info" };
}

/** Run one control action against the live bridge, or say why it cannot run. */
function withBridge<T>(deps: CommandDeps, absent: string, run: (bridge: Bridge) => T): T | string {
	const bridge = deps.getBridge();
	return bridge ? run(bridge) : absent;
}

/** The peers a subcommand can name, for a usage line: the live bridge's peer labels. */
function knownPeers(bridge: Bridge | undefined): string {
	const known = bridge?.status().peerStates.map((entry) => peerLabel(entry.peer)) ?? [];
	return known.join(", ") || "none yet";
}

/** Start the bridge on this session, and bind it to the stored account. */
async function runStart(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
	if (busyWithPeerTurn(ctx, deps, "start")) return;
	// A start outlives the turn that ran it: it binds the session and keeps a poller,
	// which the ephemeral modes have nowhere to put.
	if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
		ctx.ui.notify("WeChat start needs a session that lives: the tui or rpc mode.", "warning");
		return;
	}
	const outcome = await startOutcome(ctx, deps);
	ctx.ui.notify(outcome.message, outcome.kind);
}

/** Stop the bridge, or with a peer named, only that peer's running turn. */
async function runStop(ctx: ExtensionCommandContext, deps: CommandDeps, args: string): Promise<void> {
	const peer = args.trim();
	if (peer) {
		await runPeerAction(ctx, deps, "stop", peer);
		return;
	}
	const outcome = await stopOutcome(deps);
	ctx.ui.notify(outcome.message, outcome.kind);
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
	// The admission rule lives with the bridge's intake, which a session that never
	// runs `/wechat allow` does not load.
	const { isAllowedPeer } = await import("../intake.ts");
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
		ctx.ui.notify(`Usage: /wechat history <peer> [n]. Known: ${knownPeers(bridge)}.`, "warning");
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
 * React to a finished login. A confirmed scan stores the account and nothing else:
 * the bridge is opened by hand, with `/wechat start`, on the session that should
 * run it.
 */
export async function finishLogin(result: LoginOutcome, ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	switch (result.kind) {
		case "confirmed": {
			deps.saveAccount(result.account);
			const label = peerLabel(result.account.ilinkUserId);
			ctx.ui.notify(`WeChat connected as ${label}. Run /wechat start to run the bridge on this session.`);
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
	const client = await deps.createLoginClient(ctx.cwd);
	const config = deps.loadConfig(ctx.cwd);

	let qr: { qrcode: string; imgContent: string };
	try {
		qr = await client.fetchQr();
	} catch (error) {
		ctx.ui.notify(`WeChat login failed: ${messageOf(error)}`, "error");
		return;
	}

	// The login screen and its poll loop are the TUI's: the refusal above and
	// registration load neither.
	const { waitForLogin } = await import("./login.ts");
	const { LoginScreenComponent } = await import("../view/login-screen.ts");
	const state: LoginViewState = { status: "wait", lines: await qrLines(qr.imgContent), url: qr.imgContent };
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
		});
	});

	await finishLogin(result ?? { kind: "cancelled" }, ctx, deps);
}

/**
 * Start a fresh host session for `/wechat new`. The new session carries no binding,
 * so the bridge stays stopped there until `/wechat start`: peer conversations are
 * independent and stay on disk.
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
	const view = (): StatusView => statusView(deps.storedAccount(), deps.getBridge()?.status());
	if (peerTurnRunning(deps) || !supportsCustomUI(ctx)) {
		ctx.ui.notify(statusLine(view()));
		return;
	}
	// The control screen is the TUI's: the one-line summary above loads it never.
	const { StatusScreenComponent } = await import("../view/status-screen.ts");
	const action = await ctx.ui.custom<StatusAction>(
		(tui, theme, _keybindings, done) =>
			new StatusScreenComponent({
				theme,
				view,
				onClose: done,
				actions: {
					stop: (peer) =>
						withBridge(deps, "WeChat bridge is not running.", (bridge) => peerStopMessage(bridge, peer).message),
					reset: (peer) =>
						withBridge(deps, "WeChat bridge is not running.", (bridge) => resetMessage(bridge, peer).message),
					cancelPrompt: (focused) =>
						withBridge(deps, "No prompt is waiting.", (bridge) => cancelPromptMessage(bridge, focused).message),
					toggleBridge: async () =>
						(deps.getBridge()?.status().state === "running" ? await stopOutcome(deps) : await startOutcome(ctx, deps))
							.message,
				},
				requestRender: () => tui.requestRender(),
			}),
	);
	// The screen names a verb by the type the table declares, so a key and its
	// subcommand share one runner; the peer it was pressed on is the verb's argument.
	if (action === "close" || action === undefined) return;
	await dispatch(action.verb, ctx, deps, action.peer ?? "");
}

async function runLogout(ctx: ExtensionContext, deps: CommandDeps): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("WeChat logout needs a confirmation dialog, which this mode has no UI for.", "warning");
		return;
	}
	if (busyWithPeerTurn(ctx, deps, "logout")) return;
	if (!(await ctx.ui.confirm("Log out of WeChat?", "Remove the stored credentials and close the bridge."))) return;
	await deps.getBridge()?.close();
	await deps.logout();
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
	const entry = wanted ? bridge.status().peerStates.find((row) => peerKey(row.peer) === peerKey(wanted)) : undefined;
	if (!entry) {
		ctx.ui.notify(`Unknown WeChat peer${wanted ? ` "${wanted}"` : ""}. Known: ${knownPeers(bridge)}.`, "warning");
		return;
	}
	if (verb === "stop") {
		ctx.ui.notify(peerStopMessage(bridge, entry.peer).message);
		return;
	}
	ctx.ui.notify(resetMessage(bridge, entry.peer).message);
}

/** Run one verb. The control screen reuses this so a key and a subcommand agree. */
async function dispatch(
	verb: WechatVerb,
	ctx: ExtensionCommandContext,
	deps: CommandDeps,
	peerArg = "",
): Promise<void> {
	await WECHAT_COMMANDS.find((command) => command.verb === verb)?.run(ctx, deps, peerArg);
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("wechat", {
		description: `WeChat bridge. /wechat opens the control screen (${WECHAT_VERBS.join(" | ")})`,
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
