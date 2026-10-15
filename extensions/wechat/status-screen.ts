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
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { screenHeader, screenHint, type ScreenHint } from "../../lib/tui.ts";
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
	refused: number;
	mediaDropped: number;
	promptPending: boolean;
}

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
		refused: status?.refused ?? 0,
		mediaDropped: status?.mediaDropped ?? 0,
		promptPending: status?.promptPending ?? false,
	};
}

/** The one-line summary used outside the TUI. */
export function statusLine(view: StatusView): string {
	const parts = [view.account ? `account ${view.account}` : "not logged in", view.connection];
	if (view.bridge) {
		parts.push(`${view.peers} peer(s)`, `${view.queued} queued`);
		if (view.refused > 0) parts.push(`${view.refused} refused`);
		if (view.mediaDropped > 0) parts.push(`${view.mediaDropped} media dropped`);
		if (view.owner) parts.push(`owner ${view.owner}`);
	}
	const recovery = view.connection === "expired" ? " — run /wechat login to reconnect" : "";
	return `wechat: ${parts.join(" · ")}${recovery}`;
}

/** Label column width in the screen body. */
const LABEL_WIDTH = 11;

function row(theme: Theme, label: string, value: string): string {
	return `  ${theme.fg("muted", label.padEnd(LABEL_WIDTH))}${value}`;
}

function connectionText(theme: Theme, connection: StatusConnection): string {
	switch (connection) {
		case "open":
			return theme.fg("success", "open");
		case "expired":
			return theme.fg("error", "expired");
		case "closed":
			return theme.fg("muted", "closed");
	}
}

/** Rows for the status screen body, each fitted to `width`. */
export function statusBody(view: StatusView, theme: Theme, width: number): string[] {
	const target = Math.max(1, width);
	const lines = [
		row(theme, "Account", view.account ?? theme.fg("muted", "not logged in")),
		row(theme, "Connection", connectionText(theme, view.connection)),
	];
	if (view.bridge) {
		if (view.owner && view.owner !== view.account) lines.push(row(theme, "Owner", view.owner));
		lines.push(row(theme, "Peers", String(view.peers)));
		lines.push(row(theme, "Queued", String(view.queued)));
		if (view.refused > 0) lines.push(row(theme, "Refused", String(view.refused)));
		if (view.mediaDropped > 0) lines.push(row(theme, "Media", `${view.mediaDropped} dropped`));
		if (view.promptPending) lines.push(row(theme, "Prompt", theme.fg("accent", "waiting for a reply")));
	}
	if (view.connection === "expired") {
		lines.push("");
		lines.push(`  ${theme.fg("error", "Session expired — press l to log in again.")}`);
	} else if (view.connection === "closed" && view.account) {
		lines.push("");
		lines.push(`  ${theme.fg("muted", "Not connected — press l to log in again.")}`);
	} else if (view.connection === "closed") {
		lines.push("");
		lines.push(`  ${theme.fg("muted", "Run /wechat login to connect an account.")}`);
	}
	return lines.map((line) => truncateToWidth(line, target));
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
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose("close");
			return;
		}
		if (data === "l") {
			this.options.onClose("login");
			return;
		}
		if (data === "n") {
			this.options.onClose("new");
			return;
		}
		if (data === "o") {
			this.options.onClose("logout");
			return;
		}
		if (data === "r") this.options.requestRender();
	}

	/** Stateless: every value is read live from `view()` on render. */
	invalidate(): void {}

	render(width: number): string[] {
		const target = Math.max(1, width);
		const theme = this.options.theme;
		return [
			screenHeader(theme, target, "wechat · control"),
			"",
			...statusBody(this.options.view(), theme, target),
			"",
			screenHint(theme, target, this.hints()),
		];
	}
}
