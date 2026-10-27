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
import { RenderCache } from "../../../../lib/tui/render-cache.ts";
import { snapshotKey } from "./key.ts";
import { renderLine } from "./layout.ts";
import { buildLines } from "./lines.ts";
import type { FooterData, StatusSnapshot, TuiLike } from "../types.ts";

/**
 * A two-line, width-adaptive status bar.
 *
 * The bar is derived from a snapshot the reader rebuilds every frame, so it memoizes on a
 * key rather than on the snapshot's identity: the width, the theme object (its strings are
 * what the memo holds), and `snapshotKey`'s walk over every field the bar could draw. A
 * frame where nothing moved costs the key and a comparison; a frame that moved pays the key
 * as well, which is why the key is measured against the build it saves.
 */
class StatusBar implements Component {
	/** Unsubscribes the branch watcher; set by `createFooter`. */
	dispose?: () => void;
	private readonly cache = new RenderCache();

	constructor(
		private readonly read: () => StatusSnapshot,
		private readonly getTheme: () => Theme,
		private readonly home: string | undefined,
	) {}

	invalidate(): void {
		// Pi calls this on a theme change; the key holds the theme's identity too, so this
		// is what drops themed strings a rebuild would otherwise keep.
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const snapshot = this.read();
		const theme = this.getTheme();
		const target = Math.max(1, width);
		return this.cache.keyed([target, theme, snapshotKey(snapshot)], () =>
			buildLines(snapshot, theme, this.home).map((line) => renderLine(line, target, theme)),
		);
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
