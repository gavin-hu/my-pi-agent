/**
 * The `/wechat` control screen.
 *
 * `connectionOf`, `statusView`, `statusLine`, and `statusBody` are pure, so the
 * wording, fields, and width safety are unit-tested; `StatusScreenComponent` is
 * the TUI mounted by `runPanel`. It is the control hub for the one conversation:
 * the global keys (login, new, logout) close the screen and dispatch, the running
 * turn can be stopped and its waiting prompt withdrawn in place, and the bridge
 * itself is started and stopped in place.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatDuration } from "../../../lib/format.ts";
import { screenFooter, screenHint, type ScreenHint } from "../../../lib/tui/chrome.ts";
import { clip } from "../../../lib/tui/columns.ts";
import { isCloseKey } from "../../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { keyValueRow } from "../../../lib/tui/rows.ts";
import { titleRule } from "../../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";
import type { WechatVerb } from "../commands/commands.ts";
import { refusedValue, type StatusConnection, type StatusView, turnValue } from "../text/status.ts";

/**
 * What the status screen closed with: the verb to run, or `close`. The verb type
 * is the command's own, so a key cannot close the screen with a verb `/wechat`
 * does not register.
 */
export type StatusAction = "close" | { verb: WechatVerb };

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
	/** Whether the hint row has room for it; the rest are documented, not hinted. */
	hint: boolean;
	color?: TuiRole;
}

/**
 * Every key the control screen answers, in hint order: the turn keys, the global
 * ones, then the one the hint row has no room for. `hints` and `handleInput`
 * both read this table, so a key cannot answer input without being listed, and
 * every closing key names a `/wechat` verb by its type.
 */
export const PANEL_KEYS: readonly PanelKey[] = [
	{ key: "s", label: "stop", effect: { inPlace: "stop" }, hint: true, color: "warn" },
	{ key: "c", label: "cancel prompt", effect: { inPlace: "cancelPrompt" }, hint: true },
	{ key: "l", label: "login", effect: { close: "login" }, hint: true, color: "accent" },
	{ key: "n", label: "new", effect: { close: "new" }, hint: true, color: "accent" },
	{ key: "o", label: "logout", effect: { close: "logout" }, hint: true, color: "bad" },
	{ key: "r", label: "refresh", effect: { refresh: true }, hint: true },
	{ key: "t", label: "start/stop", effect: { inPlace: "toggleBridge" }, hint: false },
];

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
		lines.push(row(theme, target, "Queued", String(view.queued), "meta"));
		if (view.turn) lines.push(row(theme, target, "Turn", turnValue(view.turn), "accent"));
		if (view.refused > 0) lines.push(row(theme, target, "Refused", refusedValue(view), "meta"));
		if (view.mediaDropped > 0) lines.push(row(theme, target, "Media", `${view.mediaDropped} dropped`, "meta"));
		if (view.prompts.length > 0) {
			for (const prompt of view.prompts) {
				const age = formatDuration(Math.max(0, (view.now ?? Date.now()) - prompt.startedAt));
				lines.push(row(theme, target, "Prompt", `${prompt.title} · ${age}`, "accent"));
			}
		} else if (view.promptPending) {
			lines.push(row(theme, target, "Prompt", "waiting for a reply", "accent"));
		}
	}
	if (view.connection === "expired") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "bad", "Session expired — press l to log in, then t to start.")}`, target));
	} else if (view.connection === "closed" && view.account) {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Not connected — press t to start the bridge.")}`, target));
	} else if (view.connection === "closed") {
		lines.push("");
		lines.push(clip(`  ${paint(theme, "meta", "Run /wechat login to connect an account.")}`, target));
	}
	return lines;
}

/** The turn actions the screen can run without closing. */
export interface StatusActions {
	/** Stop the running turn; returns the line to flash. */
	stop(): string;
	/** Withdraw the waiting prompt; returns the line to flash. */
	cancelPrompt(): string;
	/** Start or stop the bridge on this session; async because both settle the poll loop. */
	toggleBridge(): string | Promise<string>;
}

export interface StatusScreenOptions {
	theme: Theme;
	/** Live view, re-read on every render so `r` shows the current state. */
	view: () => StatusView;
	/** Called once when the screen closes, with the chosen action. */
	onClose: (action: StatusAction) => void;
	/** In-place actions; absent makes `s`/`c` explain that they are unavailable. */
	actions?: StatusActions;
	/** Repaint after a state change. */
	requestRender: () => void;
}

/** The `/wechat` control screen: live connection facts plus every action. */
export class StatusScreenComponent implements Component {
	private flash: string | undefined;

	constructor(private readonly options: StatusScreenOptions) {}

	private setFlash(message: string | undefined): void {
		this.flash = message;
		this.options.requestRender();
	}

	private hints(): ScreenHint[] {
		const shown: ScreenHint[] = PANEL_KEYS.filter((entry) => entry.hint).map((entry) =>
			entry.color === undefined
				? `${entry.key} ${entry.label}`
				: { text: `${entry.key} ${entry.label}`, color: entry.color },
		);
		return ["Esc close", ...shown];
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose("close");
			return;
		}
		const entry = PANEL_KEYS.find((candidate) => candidate.key === data.toLowerCase());
		if (entry) this.pressKey(entry);
	}

	/** Answer one key from {@link PANEL_KEYS}: close for a verb, run it here, or repaint. */
	private pressKey(entry: PanelKey): void {
		const effect = entry.effect;
		if ("refresh" in effect) {
			this.setFlash(undefined);
			return;
		}
		if ("close" in effect) {
			this.options.onClose({ verb: effect.close });
			return;
		}
		if (effect.inPlace === "toggleBridge") {
			this.toggleBridge();
			return;
		}
		const actions = this.options.actions;
		if (!actions) {
			this.setFlash(
				effect.inPlace === "stop" ? "Stopping the turn is unavailable here." : "Prompt cancel is unavailable here.",
			);
			return;
		}
		if (effect.inPlace === "cancelPrompt") {
			// There is one conversation, so the waiting prompt is this operator's to withdraw.
			if (this.options.view().prompts.length === 0) {
				this.setFlash("No prompt waiting.");
				return;
			}
			this.setFlash(actions.cancelPrompt());
			return;
		}
		this.setFlash(actions.stop());
	}

	/** Start or stop the bridge; the bridge settles the poll loop before the line lands. */
	private toggleBridge(): void {
		const outcome = this.options.actions?.toggleBridge();
		if (!outcome) {
			this.setFlash("Starting and stopping the bridge is unavailable here.");
			return;
		}
		if (typeof outcome === "string") {
			this.setFlash(outcome);
			return;
		}
		this.setFlash(this.options.view().connection === "open" ? "Stopping…" : "Starting…");
		void outcome.then(
			(line) => this.setFlash(line),
			() => this.setFlash("Start or stop failed."),
		);
	}

	/** The view is live and the flash is plain state, so there is nothing to invalidate. */
	invalidate(): void {}

	render(width: number): string[] {
		const target = Math.max(1, width);
		const theme = this.options.theme;
		const view = this.options.view();
		const lines = [titleRule(theme, target, `wechat${SEPARATORS.item}control`), "", ...statusBody(view, theme, target)];
		if (this.flash) lines.push("", clip(`  ${paint(theme, "meta", this.flash)}`, target));
		lines.push(...screenFooter(theme, target, screenHint(theme, target, this.hints())));
		return lines;
	}
}
