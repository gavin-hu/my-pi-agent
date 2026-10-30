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
import { type PeerRow, refusedValue, type StatusConnection, type StatusView } from "../text/status.ts";

/**
 * What the status screen closed with: a global action, a peer history request,
 * or `close`.
 */
export type StatusAction = "close" | "login" | "new" | "logout" | { kind: "history"; peer: string } | { kind: "allow" };

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

/** The peer value: what it is doing, and for how long. */
function peerValue(row: PeerRow): string {
	if (row.status === "running") {
		const seconds = Math.max(0, Math.round((row.runningMs ?? 0) / 1000));
		return `running ${seconds}s${row.queued > 0 ? `, ${row.queued} queued` : ""}`;
	}
	if (row.status === "queued") return `queued ${row.queued}`;
	return "idle";
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
	/** Withdraw the waiting prompt; returns the line to flash. */
	/** Withdraw the focused peer's waiting prompt. */
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
		const hints: ScreenHint[] = ["Esc close"];
		if (view.peerRows.length > 0) {
			hints.push("j/k move", { text: "s stop", color: "warn" }, { text: "d reset", color: "warn" }, "h history");
		}
		hints.push(
			{ text: "l login", color: "accent" },
			{ text: "n new", color: "accent" },
			{ text: "o logout", color: "bad" },
			"r refresh",
		);
		return hints;
	}

	handleInput(data: string): void {
		const view = this.options.view();
		const peer = this.focusedPeer(view);
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
		if (data === "r" || data === "R") {
			this.setFlash(undefined);
			return;
		}
		if (data === "p" || data === "P") {
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
			return;
		}
		if (data === "a" || data === "A") {
			this.options.onClose({ kind: "allow" });
			return;
		}
		if (data === "c" || data === "C") {
			// Cancel the focused peer's own prompt: with two turns running, the other
			// peer's question is not this operator's to withdraw.
			const waiting = peer ? view.prompts.find((entry) => entry.peer === peer.label) : undefined;
			if (!peer || !waiting) {
				this.setFlash("No prompt waiting.");
				return;
			}
			this.setFlash(this.options.actions?.cancelPrompt(peer.id ?? peer.label) ?? "Prompt cancel is unavailable.");
			return;
		}
		if (data === "s" || data === "S" || data === "d" || data === "D" || data === "h" || data === "H") {
			if (!peer) {
				this.setFlash("No peer conversation yet.");
				return;
			}
			const id = peer.id ?? peer.label;
			if (data === "h" || data === "H") {
				this.options.onClose({ kind: "history", peer: id });
				return;
			}
			const actions = this.options.actions;
			if (!actions) {
				this.setFlash("Peer actions are unavailable here.");
				return;
			}
			this.setFlash(data === "s" || data === "S" ? actions.stop(id) : actions.reset(id));
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
