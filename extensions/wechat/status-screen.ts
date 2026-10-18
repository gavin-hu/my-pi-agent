/**
 * The `/wechat` control screen.
 *
 * `connectionOf`, `statusView`, `statusLine`, and `statusBody` are pure, so the
 * wording, fields, and width safety are unit-tested; `StatusScreenComponent` is
 * the TUI mounted by `runPanel`. It is the control hub: every operator action
 * (login, new session, logout) is a key here, so the user never has to remember
 * a subcommand. It shows the live connection state and closes with an action so
 * the command can run it after the screen is gone and input focus is free.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { screenHint, type ScreenHint } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { isCloseKey } from "../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { keyValueRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import type { BridgeStatus } from "./bridge.ts";
import { peerLabel } from "./format.ts";
import type { BotCredentials } from "./types.ts";

/** User-facing connection word; the internal `BridgeState` stays running/stopped. */
export type StatusConnection = "open" | "expired" | "closed";

/** What the status screen closed with: an action to dispatch, or `close`. */
export type StatusAction = "close" | "login" | "new" | "logout";

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
}

/** One peer's line in the control screen. */
export interface PeerRow {
	label: string;
	status: "idle" | "queued" | "running";
	queued: number;
	runningMs?: number;
}

/** How many peer rows the screen lists before summarising the rest. */
const MAX_PEER_ROWS = 5;

/** The connection word for a bridge status, or `closed` when there is none. */
export function connectionOf(status: BridgeStatus | undefined): StatusConnection {
	return status?.open ? "open" : status?.expired ? "expired" : "closed";
}

/** Build the view from the stored account and the live bridge status. */
export function statusView(account: BotCredentials | undefined, status: BridgeStatus | undefined): StatusView {
	return {
		bridge: status !== undefined,
		account: account ? peerLabel(account.ilinkUserId) : undefined,
		connection: connectionOf(status),
		owner: status?.owner ? peerLabel(status.owner) : undefined,
		peers: status?.peerCount ?? 0,
		queued: status?.queued ?? 0,
		peerRows: (status?.peerStates ?? []).map((entry) => ({
			label: peerLabel(entry.peer),
			status: entry.state.status,
			queued: entry.state.queued,
			runningMs: entry.state.runningMs,
		})),
		refused: status?.refused ?? 0,
		refusedPeers: status?.refusedPeers ?? [],
		mediaDropped: status?.mediaDropped ?? 0,
		promptPending: status?.promptPending ?? false,
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

/** Label column width in the screen body. */
const LABEL_WIDTH = 11;

/**
 * The refusal count with the senders named: naming them is what makes
 * `allowedPeers` usable, and either id form can be pasted into the config.
 */
function refusedValue(view: StatusView): string {
	const who = view.refusedPeers.length > 0 ? ` (${view.refusedPeers.join(", ")})` : "";
	return `${view.refused}${who}`;
}

/** One body row: a `meta` label column and a value in `valueRole`. */
function row(theme: Theme, width: number, label: string, value: string, valueRole: TuiRole = "label"): string {
	return keyValueRow(theme, width, { label, value, labelWidth: LABEL_WIDTH, labelRole: "meta", valueRole });
}

/** The connection word, uncolored; {@link row} paints it. */
function connectionText(connection: StatusConnection): string {
	switch (connection) {
		case "open":
			return "open";
		case "expired":
			return "expired";
		case "closed":
			return "closed";
	}
}

/** The design role the connection word is drawn in. */
function connectionRole(connection: StatusConnection): TuiRole {
	switch (connection) {
		case "open":
			return "ok";
		case "expired":
			return "bad";
		case "closed":
			return "meta";
	}
}

/** Rows for the status screen body, each fitted to `width`. */
export function statusBody(view: StatusView, theme: Theme, width: number): string[] {
	const target = Math.max(1, width);
	const lines = [
		row(theme, target, "Account", view.account ?? "not logged in", view.account ? "label" : "meta"),
		row(theme, target, "Connection", connectionText(view.connection), connectionRole(view.connection)),
	];
	if (view.bridge) {
		if (view.owner && view.owner !== view.account) lines.push(row(theme, target, "Owner", view.owner));
		lines.push(row(theme, target, "Peers", String(view.peers), "meta"));
		lines.push(row(theme, target, "Queued", String(view.queued), "meta"));
		if (view.refused > 0) lines.push(row(theme, target, "Refused", refusedValue(view), "meta"));
		if (view.mediaDropped > 0) lines.push(row(theme, target, "Media", `${view.mediaDropped} dropped`, "meta"));
		if (view.promptPending) lines.push(row(theme, target, "Prompt", "waiting for a reply", "accent"));
		lines.push(...peerLines(view.peerRows, theme, target));
	}
	if (view.connection === "expired") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "bad", "Session expired — press l to log in again.")}`, target));
	} else if (view.connection === "closed" && view.account) {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Not connected — press l to log in again.")}`, target));
	} else if (view.connection === "closed") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Run /wechat login to connect an account.")}`, target));
	}
	return lines;
}

/** The peer value: what it is doing, and for how long. */
function peerValue(row: PeerRow): string {
	if (row.status === "running") {
		const seconds = Math.max(0, Math.round((row.runningMs ?? 0) / 1000));
		return `running ${seconds}s${row.queued > 0 ? `, ${row.queued} queued` : ""}`;
	}
	if (row.status === "queued") return `queued ${row.queued}`;
	return "idle";
}

/** One indented line per peer, capped, so the screen stays compact. */
function peerLines(rows: PeerRow[], theme: Theme, width: number): string[] {
	if (rows.length === 0) return [];
	const shown = rows.slice(0, MAX_PEER_ROWS);
	const lines = [""];
	for (const [index, entry] of shown.entries()) {
		const value = peerValue(entry);
		const role: TuiRole = entry.status === "running" ? "accent" : entry.status === "queued" ? "warn" : "meta";
		lines.push(row(theme, width, index === 0 ? "Conversations" : "", value, role));
	}
	if (rows.length > shown.length) {
		lines.push(clip(`  ${paint(theme, "meta", `+${rows.length - shown.length} more`)}`, width));
	}
	return lines;
}

export interface StatusScreenOptions {
	theme: Theme;
	/** Live view, re-read on every render so `r` shows the current state. */
	view: () => StatusView;
	/** Called once when the screen closes, with the chosen action. */
	onClose: (action: StatusAction) => void;
	/** Repaint after a state change. */
	requestRender: () => void;
}

/** The `/wechat` control screen: live connection facts plus every action. */
export class StatusScreenComponent implements Component {
	constructor(private readonly options: StatusScreenOptions) {}

	private hints(): ScreenHint[] {
		return [
			"Esc close",
			{ text: "l login", color: "accent" },
			{ text: "n new", color: "accent" },
			{ text: "o logout", color: "error" },
			"r refresh",
		];
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose("close");
			return;
		}
		if (data === "l" || data === "L") {
			this.options.onClose("login");
			return;
		}
		if (data === "n" || data === "N") {
			this.options.onClose("new");
			return;
		}
		if (data === "o" || data === "O") {
			this.options.onClose("logout");
			return;
		}
		if (data === "r" || data === "R") this.options.requestRender();
	}

	/** Stateless: every value is read live from `view()` on render. */
	invalidate(): void {}

	render(width: number): string[] {
		const target = Math.max(1, width);
		const theme = this.options.theme;
		return [
			titleRule(theme, target, `wechat${SEPARATORS.item}control`),
			"",
			...statusBody(this.options.view(), theme, target),
			"",
			screenHint(theme, target, this.hints()),
		];
	}
}
