/**
 * The custom footer component installed with `ctx.ui.setFooter()`.
 *
 * The component reads a fresh snapshot on every render and resolves the theme
 * through a getter, so a theme change or a settings change is picked up without
 * rebuilding the component. `createFooter` also subscribes to git branch
 * changes and returns the unsubscribe callback as `dispose`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { renderLine } from "./layout.ts";
import { buildLines } from "./lines.ts";
import type { FooterData, StatusSnapshot, TuiLike } from "./types.ts";

/** A two-line, width-adaptive status bar. */
class StatusBar implements Component {
	/** Unsubscribes the branch watcher; set by `createFooter`. */
	dispose?: () => void;

	constructor(
		private readonly read: () => StatusSnapshot,
		private readonly getTheme: () => Theme,
		private readonly home: string | undefined,
	) {}

	invalidate(): void {
		// The bar recomputes from a fresh snapshot each render, so there is
		// nothing cached to clear. Theme-dependent strings are built in render.
	}

	render(width: number): string[] {
		const snapshot = this.read();
		const theme = this.getTheme();
		const target = Math.max(1, width);
		return buildLines(snapshot, theme, this.home).map((line) => renderLine(line, target, theme));
	}
}

/** Factory passed to `ctx.ui.setFooter()`. */
export function createFooter(
	tui: TuiLike,
	footerData: FooterData,
	read: () => StatusSnapshot,
	getTheme: () => Theme,
	home: string | undefined,
): Component & { dispose?(): void } {
	const bar = new StatusBar(read, getTheme, home);
	bar.dispose = footerData.onBranchChange(() => tui.requestRender());
	return bar;
}
