/**
 * The plain-text health report behind `/wechat doctor`.
 *
 * It answers the operator's first question — why is the bot quiet or slow? — from
 * facts the bridge already has: the connection, the token's age, the last poll,
 * the poller lock, per-peer sessions, and the last send/poll failure. Pure, so
 * the wording and the age math are unit-tested without a bridge.
 */

import { formatDuration } from "../../lib/format.ts";
import type { BridgeStatus } from "./bridge.ts";
import type { WechatConfig } from "./config.ts";
import type { BotCredentials } from "./types.ts";
import { peerLabel } from "./format.ts";

export interface DoctorInput {
	/** Undefined when the bridge has never been built in this runtime. */
	status?: BridgeStatus;
	account?: BotCredentials;
	config: WechatConfig;
	now: number;
}

const LABEL = 11;

/** One `Label      value` line. */
function row(label: string, value: string): string {
	return `${label.padEnd(LABEL)}${value}`;
}

/** `3.2s` since `at`, or a placeholder. */
function age(now: number, at: number | undefined): string {
	return at === undefined ? "unknown" : `${formatDuration(Math.max(0, now - at))} ago`;
}

function connection(status: BridgeStatus | undefined, account: BotCredentials | undefined, now: number): string {
	if (!status?.open) {
		return status?.expired ? "expired · run /wechat login" : "closed";
	}
	const owner = status.owner ? peerLabel(status.owner) : "unclaimed";
	const token = account ? `${formatDuration(Math.max(0, now - account.createdAt))} old` : "unknown age";
	return `open · owner ${owner} · token ${token}`;
}

function poll(status: BridgeStatus | undefined, now: number): string {
	if (!status) return "not started";
	const last =
		status.lastPollAt === undefined
			? "no poll yet"
			: `last ${formatDuration(Math.max(0, now - status.lastPollAt))} ago`;
	const hold = status.pollHoldMs === undefined ? "server hold" : `hold ${formatDuration(status.pollHoldMs)}`;
	const error = status.lastPollError ? ` · error: ${status.lastPollError}` : "";
	return `${last} · ${hold}${error}`;
}

function lockLine(status: BridgeStatus | undefined, now: number): string {
	const lock = status?.lock;
	if (!lock) return status?.open ? "not held" : "not running";
	return `pid ${lock.pid} · ${age(now, lock.at)}`;
}

function peers(status: BridgeStatus | undefined): string[] {
	if (!status || status.peerStates.length === 0) return [row("Peers", "none")];
	const running = status.peerStates.filter((entry) => entry.state.status === "running").length;
	const lines = [row("Peers", `${status.peerStates.length} · ${running} running · ${status.queued} queued`)];
	for (const entry of status.peerStates) {
		const state = entry.state;
		const what =
			state.status === "running"
				? `running ${formatDuration(state.runningMs ?? 0)}`
				: state.status === "queued"
					? `queued ${state.queued}`
					: "idle";
		const session = state.sessionAgeMs === undefined ? "" : ` · session ${formatDuration(state.sessionAgeMs)}`;
		lines.push(row(`  ${peerLabel(entry.peer)}`, `${what}${session}`));
	}
	return lines;
}

function recent(status: BridgeStatus | undefined): string {
	const errors = [
		status?.lastSendError ? `send: ${status.lastSendError}` : undefined,
		status?.lastPollError ? `poll: ${status.lastPollError}` : undefined,
	].filter((entry): entry is string => entry !== undefined);
	return row("Recent", errors.length > 0 ? errors.join(" · ") : "no recent failure");
}

function media(status: BridgeStatus | undefined): string {
	const dropped = status?.mediaDropped ?? 0;
	const refused = status?.refused ?? 0;
	const names = status?.refusedPeers.join(", ");
	return row(
		"Media",
		`${dropped} dropped · ${refused} refused${names ? ` (${names})` : ""} · ${status?.promptPending ? "prompt waiting" : "no prompt"}`,
	);
}

function configLine(config: WechatConfig): string {
	const overrides = Object.keys(config.peers).length;
	const limits = config.maxTurnsPerHour > 0 ? `${config.maxTurnsPerHour} turns/h` : "no turn cap";
	return row(
		"Config",
		`typing ${config.typingIndicator ? "on" : "off"} · prompts ${config.remotePrompts ? "on" : "off"} · ` +
			`${config.allowedPeers.length} allowed · ${overrides} peer override(s) · ${limits}`,
	);
}

/** The doctor report, one line per fact. */
export function doctorReport(input: DoctorInput): string {
	const { status, account, config, now } = input;
	return [
		"wechat — health",
		row("Connection", connection(status, account, now)),
		row("Poll", poll(status, now)),
		row("Lock", lockLine(status, now)),
		...peers(status),
		recent(status),
		media(status),
		configLine(config),
	].join("\n");
}
