/**
 * The custom header component installed with `ctx.ui.setHeader()`.
 *
 * It reproduces Pi's built-in header identity — the brand mark and the version
 * — and draws the mark from the active theme's tokens rather than the fixed
 * brand palette, so the header follows the bytefly themes. Themed strings are
 * built in `render` from a live theme getter, so a theme change needs no
 * rebuild, and every line is truncated to the width it is given.
 */

import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { HEADER_CONFIG } from "./config.ts";

/** How the header's brand mark is drawn. */
export type HeaderMark = "wordmark" | "logo" | "none";

/** The header's shape. */
export interface HeaderView {
	mark: HeaderMark;
	showVersion: boolean;
}

/** A two-line half-block mark, themed from the configured tokens. */
function logoLines(theme: Theme): string[] {
	const { markColor, markAccent } = HEADER_CONFIG;
	return [`${theme.fg(markColor, "█▀█")} `, `${theme.fg(markColor, "█▀")} ${theme.fg(markAccent, "█")}`];
}

/** The logo reduced to two letters, in the same two tones. */
function wordmark(theme: Theme): string {
	return theme.fg(HEADER_CONFIG.markColor, "P") + theme.fg(HEADER_CONFIG.markAccent, "i");
}

/** Left padding, clamped so a narrow terminal still has one usable column. */
function padding(width: number): string {
	return " ".repeat(Math.min(HEADER_CONFIG.padX, Math.max(0, width - 1)));
}

/** The themed header component. */
export class ByteflyHeader implements Component {
	constructor(
		private readonly getTheme: () => Theme,
		private readonly view: () => HeaderView,
		private readonly version: string,
	) {}

	invalidate(): void {
		// Every themed string is built in `render` from the live theme.
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.getTheme();
		const view = this.view();
		const pad = padding(w);
		const version = view.showVersion && this.version ? theme.fg(HEADER_CONFIG.versionColor, `v${this.version}`) : "";

		if (view.mark === "logo") {
			const [top, bottom] = logoLines(theme);
			// The version rides the mark's first line, so the block reads as one header.
			const head = version ? `${top}${version}` : top;
			const lines = [truncateToWidth(`${pad}${head}`, w, ""), truncateToWidth(`${pad}${bottom}`, w, "")];
			if (version && visibleWidth(`${pad}${top}${version}`) > w) {
				// Shed the version before clipping the mark itself.
				lines[0] = truncateToWidth(`${pad}${top}`, w, "");
			}
			return lines;
		}

		const mark = view.mark === "none" ? "" : wordmark(theme);
		let text = mark && version ? `${mark}${HEADER_CONFIG.gap}${version}` : mark || version;
		// Shed the version before touching the mark.
		if (mark && visibleWidth(`${pad}${text}`) > w) text = mark;
		return [truncateToWidth(`${pad}${text}`, w, "")];
	}
}

/** Header factory passed to `ctx.ui.setHeader`. */
export function createHeader(getTheme: () => Theme, view: () => HeaderView): (tui: TUI, theme: Theme) => Component {
	return () => new ByteflyHeader(getTheme, view, VERSION);
}
