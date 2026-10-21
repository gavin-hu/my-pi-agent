/**
 * Mounting a dock screen: rails suppressed, an optional repaint tick, and one
 * teardown.
 *
 * Pi mounts a `ctx.ui.custom` screen in the editor slot the above-editor rails
 * share, so every screen wraps itself in `withRailsSuppressed`. Three of them —
 * `/jobs`, `/watch`, and `/memory` — also poll while they are open (a log pane,
 * a line pane, a store another process can edit), and each re-derived the same
 * `let timer` / `stopTimer` / `setInterval(...).unref?.()` / `finally` skeleton
 * around its own component. The rails lifetime and the timer lifetime are the
 * same window, so they are one helper rather than two wrappers each caller
 * stacks and unwinds by hand.
 *
 * The timer is a seam (`RepeatTimer`), so a test drives the tick instead of
 * waiting for one, and it is armed after the mount returns: a component whose
 * constructor throws leaves no timer behind.
 *
 * Value-only: the timer handle lives in the caller's closure.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { withRailsSuppressed } from "./rails.ts";
import { defaultInterval, type RepeatTimer } from "./timer.ts";

/** What the host accepts back from a screen's mount. */
export type ScreenComponent = Component & { dispose?(): void };

/** What a mounted screen is given: the host's mount parameters, narrowed. */
export interface PolledScreen {
	/** The host's component handle; a screen that needs an `Editor` builds it from this. */
	readonly tui: TUI;
	/** The theme the host handed the mount. */
	readonly theme: Theme;
	/** Ask the host to repaint. */
	requestRender(): void;
	/** Close the screen, as its own close key would. */
	close(): void;
	/** The terminal's height in rows, or `undefined` when the host cannot say. */
	viewportRows(): number | undefined;
}

export interface PolledScreenOptions<Screen> {
	/** How often `poll` runs while the screen is open, in ms. */
	pollMs: number;
	/** Run once per tick; `screen` is what `mount` returned. */
	poll(screen: Screen, handles: PolledScreen): void;
	/** Timer seam; defaults to an unref'd interval. */
	timer?: RepeatTimer;
}

/**
 * Show one polled dock screen and resolve when it closes.
 *
 * The caller still owns the `ctx.mode !== "tui"` branch, because the text
 * fallback differs per command; everything from the mount to the teardown is
 * here.
 */
export async function withPolledScreen<Screen extends ScreenComponent>(
	pi: Pick<ExtensionAPI, "events">,
	ctx: Pick<ExtensionContext, "ui">,
	mount: (handles: PolledScreen) => Screen,
	options: PolledScreenOptions<Screen>,
): Promise<void> {
	const { pollMs, poll, timer = defaultInterval } = options;
	let stop: (() => void) | undefined;
	try {
		await withRailsSuppressed(pi, () =>
			ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const handles: PolledScreen = {
					tui,
					theme,
					requestRender: () => tui.requestRender(),
					close: () => done(),
					viewportRows: () => tui.terminal?.rows,
				};
				const screen = mount(handles);
				stop = timer(pollMs, () => poll(screen, handles));
				return screen;
			}),
		);
	} finally {
		stop?.();
	}
}
