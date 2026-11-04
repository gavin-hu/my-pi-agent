/**
 * The plain-text health report behind `/wechat doctor`.
 *
 * It answers the operator's first question — why is the bot quiet or slow? — from
 * the facts `statusView` already derived: the connection, the token's age, the last
 * poll, the poller lock, per-peer activity, and the last send/poll failure. Only the
 * config summary and the remedy each state asks for are the report's own, so the
 * report and the control screen cannot word a fact differently. Pure, so the
 * wording and the age math are unit-tested without a bridge.
 */

import { formatDuration } from "../../../lib/format.ts";
import { padTo } from "../../../lib/tui/columns.ts";
import type { BridgeStatus } from "../bridge.ts";
import type { WechatConfig } from "../config.ts";
import { refusedValue, type StatusView, statusView, turnValue } from "../text/status.ts";
import type { BotCredentials } from "../types.ts";

export interface DoctorInput {
	/** Undefined when the bridge has never been built in this runtime. */
	status?: BridgeStatus;
	account?: BotCredentials;
	config: WechatConfig;
	now: number;
}

const LABEL = 11;

/** One `Label      value` line, padded by display columns so a CJK label lines up. */
function row(label: string, value: string): string {
	return `${padTo(label, LABEL)}${value}`;
}

const ago = (ms: number): string => `${formatDuration(ms)} ago`;

/**
 * The connection, with what to do about it: the word is the view's, the remedy is
 * the report's, because only the report is advice.
 */
function connection(view: StatusView): string {
	switch (view.connection) {
		case "expired":
			return "expired · run /wechat login";
		case "closed":
			return "closed · run /wechat start";
		default: {
			const owner = view.owner ?? "unclaimed";
			const token = view.tokenAgeMs === undefined ? "unknown age" : `${formatDuration(view.tokenAgeMs)} old`;
			return `open · owner ${owner} · token ${token}`;
		}
	}
}

function poll(view: StatusView): string {
	if (!view.bridge) return "not started";
	const last = view.lastPollAgeMs === undefined ? "no poll yet" : `last ${ago(view.lastPollAgeMs)}`;
	const hold = view.pollHoldMs === undefined ? "server hold" : `hold ${formatDuration(view.pollHoldMs)}`;
	const error = view.lastPollError ? ` · error: ${view.lastPollError}` : "";
	return `${last} · ${hold}${error}`;
}

function lockLine(view: StatusView): string {
	if (!view.lock) return view.connection === "open" ? "not held" : "not running";
	return `pid ${view.lock.pid} · ${ago(view.lock.ageMs)}`;
}

function conversation(view: StatusView): string[] {
	const turn = view.turn;
	if (!turn) return [row("Turn", "idle")];
	const session = turn.sessionAgeMs === undefined ? "" : ` · session ${formatDuration(turn.sessionAgeMs)}`;
	return [row("Turn", `${turnValue(turn)}${session}`)];
}

function recent(view: StatusView): string {
	const errors = [
		view.lastSendError ? `send: ${view.lastSendError}` : undefined,
		view.lastPollError ? `poll: ${view.lastPollError}` : undefined,
	].filter((entry): entry is string => entry !== undefined);
	return row("Recent", errors.length > 0 ? errors.join(" · ") : "no recent failure");
}

function media(view: StatusView): string {
	const prompt = view.promptPending ? "prompt waiting" : "no prompt";
	return row("Media", `${view.mediaDropped} dropped · refused ${refusedValue(view)} · ${prompt}`);
}

function configLine(config: WechatConfig): string {
	const limits = config.maxTurnsPerHour > 0 ? `${config.maxTurnsPerHour} turns/h` : "no turn cap";
	return row("Config", `typing ${config.typingIndicator ? "on" : "off"} · ${limits}`);
}

/** The doctor report, one line per fact. */
export function doctorReport(input: DoctorInput): string {
	const { status, account, config, now } = input;
	const view = statusView(account, status, now);
	return [
		"wechat — health",
		row("Connection", connection(view)),
		row("Poll", poll(view)),
		row("Lock", lockLine(view)),
		...conversation(view),
		recent(view),
		media(view),
		configLine(config),
	].join("\n");
}
