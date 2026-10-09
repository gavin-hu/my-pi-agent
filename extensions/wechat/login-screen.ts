/**
 * The `/wechat login` screen.
 *
 * `LoginScreenComponent` is mounted by `ctx.ui.custom`; it renders the QR (or
 * the login URL when the terminal is too narrow) and closes on Esc. The polling
 * loop is owned by the command, which updates `state` and calls `requestRender`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { screenHeader, screenHint } from "../../lib/tui.ts";

export interface LoginViewState {
	/** Raw `get_qrcode_status` value, or `wait` before the first poll. */
	status: string;
	/** QR as terminal lines. */
	lines: string[];
	/** Login URL, shown when the QR does not fit the terminal. */
	url: string;
	/** An error to show instead of the status, when set. */
	error?: string;
}

const STATUS_TEXT: Record<string, string> = {
	wait: "Waiting for scan…",
	scaned: "Scanned; confirm on your phone…",
	confirmed: "Confirmed.",
	expired: "The QR code expired.",
	need_verifycode: "Enter the verification code…",
	verify_code_blocked: "Too many verification attempts.",
	scaned_but_redirect: "Scanned; finishing…",
	binded_redirect: "Already bound to another instance.",
};

/** A human label for a raw status value. */
export function statusLabel(status: string): string {
	return STATUS_TEXT[status] ?? status;
}

/** The screen body: status or error, then the QR (or the URL) fitted to `width`. */
export function loginBody(state: LoginViewState, width: number): string[] {
	const target = Math.max(1, width);
	const lines: string[] = [];
	if (state.error) lines.push(state.error);
	else lines.push(statusLabel(state.status));

	if (state.lines.length > 0 && visibleWidth(state.lines[0]) <= target) {
		lines.push(...state.lines);
	} else if (state.url) {
		for (let index = 0; index < state.url.length; index += target) {
			lines.push(state.url.slice(index, index + target));
		}
	}
	return lines.map((line) => truncateToWidth(line, target));
}

export interface LoginScreenOptions {
	theme: Theme;
	/** Live view state; read on every render. */
	state: () => LoginViewState;
	/** Called when the user presses Esc. */
	onCancel: () => void;
	/** Repaint after a state change. */
	requestRender: () => void;
}

/** The QR login screen opened by `/wechat login`. */
export class LoginScreenComponent implements Component {
	constructor(private readonly options: LoginScreenOptions) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onCancel();
		}
	}

	/** Stateless: every value is read live from `state()` on render. */
	invalidate(): void {}

	render(width: number): string[] {
		const target = Math.max(1, width);
		const theme = this.options.theme;
		return [
			screenHeader(theme, target, "wechat · login"),
			"",
			...loginBody(this.options.state(), target),
			"",
			screenHint(theme, target, ["Esc cancel"]),
		];
	}
}
