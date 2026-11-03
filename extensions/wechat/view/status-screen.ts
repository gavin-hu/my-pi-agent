/**
 * The `/wechat` control screen.
 *
 * `connectionOf`, `statusView`, `statusLine`, and `statusBody` are pure, so the
 * wording, fields, and width safety are unit-tested; `StatusScreenComponent` is
 * the TUI mounted by `runPanel`. It is the control hub: the global keys (login,
 * new session, logout) close the screen and dispatch, while a focused peer row
 * can be stopped, reset, or opened in `/wechat history` without leaving the
 * screen.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatDuration } from "../../../lib/format.ts";
import { screenFooter, screenHint, type ScreenHint } from "../../../lib/tui/chrome.ts";
import { clip } from "../../../lib/tui/columns.ts";
import { formatRange, IdCursor, isCloseKey, navIntent } from "../../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { keyValueRow, listRow } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";
import type { WechatVerb } from "../commands/commands.ts";
import { type PeerRow, peerValue, refusedValue, type StatusConnection, type StatusView } from "../text/status.ts";

/**
 * What the status screen closed with: the verb to run, with the peer it names, or
 * `close`. The verb type is the command's own, so a key cannot close the screen
 * with a verb `/wechat` does not register.
 */
export type StatusAction = "close" | { verb: WechatVerb; peer?: string };

/** What one control-screen key does. */
type PanelEffect =
	/** Close the screen; the verb runs afterwards, outside it. */
	| { close: WechatVerb }
	/** Run inside the screen and flash the line it returns. */
	| { inPlace: keyof StatusActions }
	/** Drop the flash and repaint. */
	| { refresh: true };

/** One key the control screen answers. */
export interface PanelKey {
	key: string;
	/** The word the hint row shows for it. */
	label: string;
	effect: PanelEffect;
	/** Whether the key acts on the focused peer. */
	needsPeer?: boolean;
	/** Whether the hint row has room for it; the rest are documented, not hinted. */
	hint: boolean;
	color?: TuiRole;
}

/**
 * Every key the control screen answers, in hint order: the peer keys, the global
 * ones, then the three the hint row has no room for. `hints` and `handleInput`
 * both read this table, so a key cannot answer input without being listed, and
 * every closing key names a `/wechat` verb by its type.
 */
export const PANEL_KEYS: readonly PanelKey[] = [
	{ key: "s", label: "stop", effect: { inPlace: "stop" }, needsPeer: true, hint: true, color: "warn" },
	{ key: "d", label: "reset", effect: { inPlace: "reset" }, needsPeer: true, hint: true, color: "warn" },
	{ key: "h", label: "history", effect: { close: "history" }, needsPeer: true, hint: true },
	{ key: "l", label: "login", effect: { close: "login" }, hint: true, color: "accent" },
	{ key: "n", label: "new", effect: { close: "new" }, hint: true, color: "accent" },
	{ key: "o", label: "logout", effect: { close: "logout" }, hint: true, color: "bad" },
	{ key: "r", label: "refresh", effect: { refresh: true }, hint: true },
	{ key: "a", label: "allow", effect: { close: "allow" }, hint: false },
	{ key: "p", label: "pause", effect: { inPlace: "togglePause" }, hint: false },
	{ key: "c", label: "cancel prompt", effect: { inPlace: "cancelPrompt" }, needsPeer: true, hint: false },
];

/** How many peer rows the screen lists before scrolling. */
const MAX_PEER_ROWS = 5;

/** Label column width in the screen body. */
const LABEL_WIDTH = 11;

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
		case "paused":
			return "paused";
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
		case "paused":
			return "warn";
		case "closed":
			return "meta";
	}
}

/** The peer focus passed into the body: which row is selected and which slice shows. */
export interface PeerSelection {
	selectedId?: string;
	window?: { start: number; end: number };
}

/** Rows for the status screen body, each fitted to `width`. */
export function statusBody(view: StatusView, theme: Theme, width: number, selection?: PeerSelection): string[] {
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
		if (view.prompts.length > 0) {
			// One line per peer: with two turns running, two prompts can wait at once.
			for (const prompt of view.prompts) {
				const age = formatDuration(Math.max(0, (view.now ?? Date.now()) - prompt.startedAt));
				lines.push(row(theme, target, "Prompt", `${prompt.peer} · ${prompt.title} · ${age}`, "accent"));
			}
		} else if (view.promptPending) {
			lines.push(row(theme, target, "Prompt", "waiting for a reply", "accent"));
		}
		lines.push(...peerLines(view.peerRows, theme, target, selection));
	}
	if (view.connection === "expired") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "bad", "Session expired — press l to log in again.")}`, target));
	} else if (view.connection === "paused") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "warn", "Paused — press p to resume polling.")}`, target));
	} else if (view.connection === "closed" && view.account) {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Not connected — press l to log in again.")}`, target));
	} else if (view.connection === "closed") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Run /wechat login to connect an account.")}`, target));
	}
	return lines;
}

/** One selectable line per peer, with a range row when the list is scrolled. */
function peerLines(rows: PeerRow[], theme: Theme, width: number, selection?: PeerSelection): string[] {
	if (rows.length === 0) return [];
	const start = selection?.window?.start ?? 0;
	const end = selection?.window?.end ?? Math.min(rows.length, MAX_PEER_ROWS);
	const shown = rows.slice(start, end);
	const lines = ["", clip(`  ${paint(theme, "meta", "Conversations")}`, width)];
	for (const entry of shown) {
		const selected = selection?.selectedId !== undefined && (entry.id ?? entry.label) === selection.selectedId;
		const role: TuiRole = entry.status === "running" ? "accent" : entry.status === "queued" ? "warn" : "meta";
		lines.push(
			listRow(theme, width, {
				indent: 2,
				selected,
				label: entry.label,
				trailing: peerValue(entry),
				trailingRole: role,
			}),
		);
	}
	if (selection?.window !== undefined) {
		if (start > 0 || end < rows.length) {
			lines.push(formatRange(theme, width, { start, end, total: rows.length }));
		}
	} else if (rows.length > shown.length) {
		lines.push(clip(`  ${paint(theme, "meta", `+${rows.length - shown.length} more`)}`, width));
	}
	return lines;
}

/** The peer actions the screen can run without closing. */
export interface StatusActions {
	/** Stop the peer's running turn; returns the line to flash. */
	stop(peer: string): string;
	/** Start a fresh conversation for the peer; returns the line to flash. */
	reset(peer: string): string;
	/** Withdraw the focused peer's waiting prompt; returns the line to flash. */
	cancelPrompt(peer: string): string;
	/** Pause or resume polling; async because it settles the poll loop first. */
	togglePause(): string | Promise<string>;
}

export interface StatusScreenOptions {
	theme: Theme;
	/** Live view, re-read on every render so `r` shows the current state. */
	view: () => StatusView;
	/** Called once when the screen closes, with the chosen action. */
	onClose: (action: StatusAction) => void;
	/** In-place peer actions; absent makes `s`/`d` explain that they are unavailable. */
	actions?: StatusActions;
	/** Repaint after a state change. */
	requestRender: () => void;
}

/** The `/wechat` control screen: live connection facts plus every action. */
export class StatusScreenComponent implements Component {
	private readonly cursor = new IdCursor();
	private flash: string | undefined;

	constructor(private readonly options: StatusScreenOptions) {}

	/**
	 * The focused peer, or undefined when the list is empty. Not named `focused`:
	 * the host duck-types focusables with `"focused" in component` and writes a
	 * boolean there, which would shadow the method.
	 */
	private focusedPeer(view: StatusView): PeerRow | undefined {
		const rows = view.peerRows;
		if (rows.length === 0) return undefined;
		return rows[this.cursor.indexOf(rows, (row) => row.id ?? row.label)];
	}

	private setFlash(message: string | undefined): void {
		this.flash = message;
		this.options.requestRender();
	}

	private hints(view: StatusView): ScreenHint[] {
		const shown = (peer: boolean): ScreenHint[] =>
			PANEL_KEYS.filter((entry) => entry.hint && (entry.needsPeer ?? false) === peer).map((entry) =>
				entry.color === undefined
					? `${entry.key} ${entry.label}`
					: { text: `${entry.key} ${entry.label}`, color: entry.color },
			);
		const hints: ScreenHint[] = ["Esc close"];
		if (view.peerRows.length > 0) hints.push("j/k move", ...shown(true));
		hints.push(...shown(false));
		return hints;
	}

	handleInput(data: string): void {
		const view = this.options.view();
		const peer = this.focusedPeer(view);
		if (isCloseKey(data)) {
			this.options.onClose("close");
			return;
		}
		const entry = PANEL_KEYS.find((candidate) => candidate.key === data.toLowerCase());
		if (entry) {
			this.pressKey(entry, view, peer);
			return;
		}
		const rows = view.peerRows;
		const index = this.cursor.indexOf(rows, (row) => row.id ?? row.label);
		switch (navIntent(data)) {
			case "up":
				this.select(index - 1, view);
				return;
			case "down":
				this.select(index + 1, view);
				return;
			case "pageUp":
				this.select(index - this.cursor.visible, view);
				return;
			case "pageDown":
				this.select(index + this.cursor.visible, view);
				return;
			case "home":
				this.select(0, view);
				return;
			case "end":
				this.select(rows.length - 1, view);
				return;
		}
	}

	/** Answer one key from {@link PANEL_KEYS}: close for a verb, run it here, or repaint. */
	private pressKey(entry: PanelKey, view: StatusView, peer: PeerRow | undefined): void {
		const effect = entry.effect;
		if ("refresh" in effect) {
			this.setFlash(undefined);
			return;
		}
		if ("close" in effect) {
			if (entry.needsPeer && peer === undefined) {
				this.setFlash("No peer conversation yet.");
				return;
			}
			this.options.onClose(
				entry.needsPeer ? { verb: effect.close, peer: peer?.id ?? peer?.label } : { verb: effect.close },
			);
			return;
		}
		if (effect.inPlace === "togglePause") {
			this.togglePause(view);
			return;
		}
		if (peer === undefined) {
			this.setFlash(effect.inPlace === "cancelPrompt" ? "No prompt waiting." : "No peer conversation yet.");
			return;
		}
		const actions = this.options.actions;
		if (!actions) {
			this.setFlash(
				effect.inPlace === "stop" || effect.inPlace === "reset"
					? "Peer actions are unavailable here."
					: "Prompt cancel is unavailable here.",
			);
			return;
		}
		const id = peer.id ?? peer.label;
		if (effect.inPlace === "cancelPrompt") {
			// Cancel the focused peer's own prompt: with two turns running, the other
			// peer's question is not this operator's to withdraw.
			const waiting = view.prompts.find((item) => item.peer === peer.label);
			if (!waiting) {
				this.setFlash("No prompt waiting.");
				return;
			}
			this.setFlash(actions.cancelPrompt(id));
			return;
		}
		this.setFlash(effect.inPlace === "stop" ? actions.stop(id) : actions.reset(id));
	}

	/** Pause or resume polling; the bridge settles the loop before the line lands. */
	private togglePause(view: StatusView): void {
		if (!view.bridge) {
			this.setFlash("WeChat is not running.");
			return;
		}
		const outcome = this.options.actions?.togglePause();
		if (!outcome) {
			this.setFlash("Pause is unavailable here.");
			return;
		}
		if (typeof outcome === "string") {
			this.setFlash(outcome);
			return;
		}
		this.setFlash(view.connection === "paused" ? "Resuming…" : "Pausing…");
		void outcome.then(
			(line) => this.setFlash(line),
			() => this.setFlash("Pause action failed."),
		);
	}

	/** Focus the row at `index` and repaint when it moves. */
	private select(index: number, view: StatusView): void {
		const rows = view.peerRows;
		if (rows.length === 0) return;
		this.cursor.select(rows, (row) => row.id ?? row.label, index);
		this.options.requestRender();
	}

	/** The cursor is plain state and the view is live, so there is nothing to invalidate. */
	invalidate(): void {}

	render(width: number): string[] {
		const target = Math.max(1, width);
		const theme = this.options.theme;
		const view = this.options.view();
		const rows = view.peerRows;
		this.cursor.visible = Math.min(MAX_PEER_ROWS, Math.max(1, rows.length));
		this.cursor.clamp(rows, (row) => row.id ?? row.label);
		const peer = this.focusedPeer(view);
		if (rows.length > 0) this.cursor.ensureVisible(this.cursor.indexOf(rows, (row) => row.id ?? row.label));
		const start = this.cursor.scroll;
		const end = Math.min(rows.length, start + this.cursor.visible);
		const selection: PeerSelection | undefined =
			rows.length === 0
				? undefined
				: { selectedId: peer ? (peer.id ?? peer.label) : undefined, window: { start, end } };
		const lines = [
			titleRule(theme, target, `wechat${SEPARATORS.item}control`),
			"",
			...statusBody(view, theme, target, selection),
		];
		if (this.flash) lines.push("", clip(`  ${paint(theme, "meta", this.flash)}`, target));
		lines.push(...screenFooter(theme, target, screenHint(theme, target, this.hints(view))));
		return lines;
	}
}
