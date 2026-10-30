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
export type StatusConnection = "open" | "expired" | "paused" | "closed";

/** The facts the status screen and the one-line summary render. */
export interface StatusView {
	/** Whether a bridge exists, so the activity counters are meaningful. */
	bridge: boolean;
	account?: string;
	connection: StatusConnection;
	owner?: string;
	peers: number;
	queued: number;
	/** Per-peer activity, so an operator can see who is waiting and for how long. */
	peerRows: PeerRow[];
	refused: number;
	/** Labels of the refused senders, so an operator can allowlist one. */
	refusedPeers: string[];
	mediaDropped: number;
	promptPending: boolean;
	/** Every waiting prompt, one per peer that was asked something. */
	prompts: Array<{ peer: string; title: string; startedAt: number }>;
	/** The clock the view was built with, for the prompt age. */
	now?: number;
}

/** One peer's line in the control screen. */
export interface PeerRow {
	/** The raw peer id, so an action targets the right person; falls back to `label`. */
	id?: string;
	label: string;
	status: "idle" | "queued" | "running";
	queued: number;
	runningMs?: number;
}

/** The connection word for a bridge status, or `closed` when there is none. */
export function connectionOf(status: BridgeStatus | undefined): StatusConnection {
	return status?.paused ? "paused" : status?.open ? "open" : status?.expired ? "expired" : "closed";
}

/** Build the view from the stored account and the live bridge status. */
export function statusView(
	account: BotCredentials | undefined,
	status: BridgeStatus | undefined,
	now: number = Date.now(),
): StatusView {
	return {
		bridge: status !== undefined,
		account: account ? peerLabel(account.ilinkUserId) : undefined,
		connection: connectionOf(status),
		owner: status?.owner ? peerLabel(status.owner) : undefined,
		peers: status?.peerCount ?? 0,
		queued: status?.queued ?? 0,
		peerRows: (status?.peerStates ?? []).map((entry) => ({
			id: entry.peer,
			label: peerLabel(entry.peer),
			status: entry.state.status,
			queued: entry.state.queued,
			runningMs: entry.state.runningMs,
		})),
		refused: status?.refused ?? 0,
		refusedPeers: status?.refusedPeers ?? [],
		mediaDropped: status?.mediaDropped ?? 0,
		promptPending: status?.promptPending ?? false,
		prompts: (status?.prompts ?? []).map((prompt) => ({
			peer: sanitizeLine(peerLabel(prompt.peer)),
			title: sanitizeLine(prompt.title),
			startedAt: prompt.startedAt,
		})),
		now,
	};
}

/** The one-line summary used outside the TUI. */
export function statusLine(view: StatusView): string {
	const parts = [view.account ? `account ${view.account}` : "not logged in", view.connection];
	if (view.bridge) {
		parts.push(`${view.peers} peer(s)`, `${view.queued} queued`);
		if (view.refused > 0) parts.push(`refused ${refusedValue(view)}`);
		if (view.mediaDropped > 0) parts.push(`${view.mediaDropped} media dropped`);
		if (view.owner) parts.push(`owner ${view.owner}`);
		const active = view.peerRows.find((row) => row.status === "running");
		if (active) parts.push(`running ${active.label}`);
	}
	const recovery = view.connection === "expired" ? " — run /wechat login to reconnect" : "";
	return `wechat: ${parts.join(SEPARATORS.item)}${recovery}`;
}

/**
 * The refusal count with the senders named: naming them is what makes
 * `allowedPeers` usable, and either id form can be pasted into the config.
 */
export function refusedValue(view: StatusView): string {
	const who = view.refusedPeers.length > 0 ? ` (${view.refusedPeers.join(", ")})` : "";
	return `${view.refused}${who}`;
}
