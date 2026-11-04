/**
 * The `/wechat` status facts and their one-line summary (text only).
 *
 * `statusView` turns the stored account and the live bridge status into the
 * facts the control screen and the text modes both read, and `statusLine` is
 * what a non-TUI turn prints. They live in `text/` rather than beside the
 * screen because the text modes need them and must never load the screen:
 * `view/status-screen.ts` is a full-screen surface and loads on first use.
 */

import { sanitizeLine } from "../../../lib/format.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import type { BridgeStatus } from "../bridge.ts";
import { peerLabel } from "./format.ts";
import type { BotCredentials } from "../types.ts";

/** User-facing connection word; the internal `BridgeState` stays running/stopped. */
export type StatusConnection = "open" | "expired" | "closed";

/** The facts the status screen and the one-line summary render. */
export interface StatusView {
	/** Whether a bridge exists, so the activity counters are meaningful. */
	bridge: boolean;
	account?: string;
	connection: StatusConnection;
	owner?: string;
	queued: number;
	/** The conversation's activity, so an operator can see what it is doing. */
	turn?: TurnRow;
	refused: number;
	/** Labels of the refused senders, so an operator can allowlist one. */
	refusedPeers: string[];
	mediaDropped: number;
	promptPending: boolean;
	/** The waiting prompt, with its kind, title, and age. */
	prompts: Array<{ title: string; startedAt: number }>;
	/** The clock the view was built with, for the prompt age. */
	now?: number;
	/** How old the stored token is, for the health report; `undefined` without one. */
	tokenAgeMs?: number;
	/** Since the last poll, and the hold it asked for; both absent before one. */
	lastPollAgeMs?: number;
	pollHoldMs?: number;
	lastPollError?: string;
	lastSendError?: string;
	/** The poller lock's holder and age, so a stuck poll names the process. */
	lock?: { pid: number; ageMs: number };
}

/** A conversation's activity, for the control screen and the health report. */
export interface TurnRow {
	status: "idle" | "queued" | "running";
	queued: number;
	runningMs?: number;
	/** How long the conversation has been open; only the health report shows it. */
	sessionAgeMs?: number;
}

/** The connection word for a bridge status, or `closed` when there is none. */
export function connectionOf(status: BridgeStatus | undefined): StatusConnection {
	switch (status?.state) {
		case "running":
			return "open";
		case "expired":
			return "expired";
		default:
			return "closed";
	}
}

/** A sanitized display line for a value that may be absent; `undefined` stays absent. */
function optionalLine(value: string | undefined): string | undefined {
	return value === undefined ? undefined : sanitizeLine(value);
}

/** Build the view from the stored account and the live bridge status. */
export function statusView(
	account: BotCredentials | undefined,
	status: BridgeStatus | undefined,
	now: number = Date.now(),
): StatusView {
	const since = (at: number | undefined): number | undefined => (at === undefined ? undefined : Math.max(0, now - at));
	return {
		bridge: status !== undefined,
		account: account ? sanitizeLine(peerLabel(account.ilinkUserId)) : undefined,
		connection: connectionOf(status),
		owner: status?.owner ? sanitizeLine(peerLabel(status.owner)) : undefined,
		queued: status?.queued ?? 0,
		turn: status?.turn,
		refused: status?.refused ?? 0,
		refusedPeers: (status?.refusedPeers ?? []).map(sanitizeLine),
		mediaDropped: status?.mediaDropped ?? 0,
		promptPending: status?.promptPending ?? false,
		prompts: (status?.prompts ?? []).map((prompt) => ({
			title: sanitizeLine(prompt.title),
			startedAt: prompt.startedAt,
		})),
		now,
		tokenAgeMs: account ? since(account.createdAt) : undefined,
		lastPollAgeMs: since(status?.lastPollAt),
		pollHoldMs: status?.pollHoldMs,
		lastPollError: optionalLine(status?.lastPollError),
		lastSendError: optionalLine(status?.lastSendError),
		lock: status?.lock ? { pid: status.lock.pid, ageMs: Math.max(0, now - status.lock.at) } : undefined,
	};
}

/** The one-line summary used outside the TUI. */
export function statusLine(view: StatusView): string {
	const parts = [view.account ? `account ${view.account}` : "not logged in", view.connection];
	if (view.bridge) {
		parts.push("1 conversation", `${view.queued} queued`);
		if (view.refused > 0) parts.push(`refused ${refusedValue(view)}`);
		if (view.mediaDropped > 0) parts.push(`${view.mediaDropped} media dropped`);
		if (view.owner) parts.push(`owner ${view.owner}`);
		if (view.turn?.status === "running") parts.push(turnValue(view.turn));
	}
	const recovery = view.connection === "expired" ? " — run /wechat login to reconnect" : "";
	return `wechat: ${parts.join(SEPARATORS.item)}${recovery}`;
}

/** What the conversation is doing, and for how long; the screen and the report share it. */
export function turnValue(row: TurnRow): string {
	if (row.status === "running") {
		const seconds = Math.max(0, Math.round((row.runningMs ?? 0) / 1000));
		return `running ${seconds}s${row.queued > 0 ? `, ${row.queued} queued` : ""}`;
	}
	if (row.status === "queued") return `queued ${row.queued}`;
	return "idle";
}

/**
 * The refusal count with the senders named: naming them is what tells an
 * operator that someone besides the owner is writing to the bot.
 */
export function refusedValue(view: StatusView): string {
	const who = view.refusedPeers.length > 0 ? ` (${view.refusedPeers.join(", ")})` : "";
	return `${view.refused}${who}`;
}
