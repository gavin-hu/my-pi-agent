/**
 * The chrome extension's header component.
 *
 * `ChromeHeader` reproduces Pi's built-in header structure (brand mark and
 * version) and drives every color from the active theme's tokens. It adds no
 * session or model data; the version is Pi's own. Themed strings are built in
 * `render` from a live theme getter, so a theme change needs no rebuild.
 */

import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** How the header's brand mark is drawn. */
export type HeaderMark = "wordmark" | "logo" | "none";

/** The header's user-configurable shape. */
export interface HeaderView {
	mark: HeaderMark;
	showVersion: boolean;
}

/** A reproduced two-line half-block mark, themed from `accent` and `warning`. */
function logoLines(theme: Theme): string[] {
	return [theme.fg("accent", "█▀█ "), theme.fg("accent", "█▀ ") + theme.fg("warning", "█")];
}

/** The themed header component. */
export class ChromeHeader implements Component {
	constructor(
		private readonly getTheme: () => Theme,
		private readonly view: () => HeaderView,
		private readonly version: string,
	) {}

	invalidate(): void {
		// Every themed string is built in `render` from the live theme, so there
		// is nothing cached to clear.
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.getTheme();
		const view = this.view();
		const lines: string[] = [""];
		if (view.mark === "logo") {
			for (const line of logoLines(theme)) if (visibleWidth(line) <= w) lines.push(line);
		}

		const mark = view.mark === "none" ? "" : theme.fg("accent", "Pi");
		const version = view.showVersion && this.version ? theme.fg("muted", `v${this.version}`) : "";
		let left = mark && version ? `${mark} ${version}` : mark || version;
		// Shed the version before touching the mark.
		if (mark && visibleWidth(left) > w) left = mark;
		lines.push(truncateToWidth(left, w, ""));
		return lines;
	}
}

/** Header factory passed to `ctx.ui.setHeader`. */
export function createHeader(getTheme: () => Theme, view: () => HeaderView): (tui: TUI, theme: Theme) => Component {
	return () => new ChromeHeader(getTheme, view, VERSION);
}
