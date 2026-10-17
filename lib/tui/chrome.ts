/**
 * Small TUI helpers shared by extension screens (rewind, jobs, plan-mode,
 * todo).
 *
 * `FULL_SCREEN_OVERLAY` is for the one surface that must own the whole terminal:
 * the plan read/review screen. Every list screen (`/bytefly`, `/todos`, `/jobs`,
 * `/rewind`) stays in the dock's editor slot so they match each other and leave
 * the transcript visible.
 *
 * Screens are full-width, terminal-height-aware components. These helpers build
 * the top rule, clamp a screen's body to the terminal, and render the key-hint
 * footer, so each screen keeps its own layout but not its own copy of the
 * arithmetic or hint vocabulary.
 *
 * No runtime dependencies beyond `@earendil-works/pi-tui`: the theme is passed
 * in, and the viewport options are explicit.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type EditorTheme, type OverlayOptions } from "@earendil-works/pi-tui";
import { SEPARATORS } from "./glyphs.ts";
import { BODY_INDENT } from "./indent.ts";

/**
 * `ctx.ui.custom` options that give a screen the whole terminal.
 *
 * Without `overlay`, Pi mounts the component in the editor slot of its dock,
 * where it shares the terminal with the transcript, status line, widgets, and
 * footer. A screen sized to `terminal.rows` then overflows the slot and the
 * layout clips its bottom — losing the screen's own footer. Mounting as a
 * full-screen overlay keeps the row budget equal to the terminal's, however
 * much chrome the dock carries; keep the chrome budget small on dock-mounted
 * list screens so their footer survives the slot.
 */
export const FULL_SCREEN_OVERLAY: { overlay: true; overlayOptions: OverlayOptions } = {
	overlay: true,
	overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
};

/** A row count, or a live getter so a screen re-sizes with the terminal. */
export type ViewportRowsSource = number | (() => number | undefined);

interface ViewportRowsOptions {
	/** Header, summary, detail, footer, and blank rows the screen spends around the body. */
	chrome: number;
	/** Body rows when the terminal height is unknown. */
	fallback: number;
}

/**
 * How many body rows fit in the terminal. When the height is known the screen
 * fills it (`rows - chrome`), shrinking on short terminals rather than
 * overflowing; `fallback` is used only when the height is unknown. A getter is
 * resolved per call so a resized terminal is picked up on the next render.
 */
export function viewportRows(source: ViewportRowsSource | undefined, options: ViewportRowsOptions): number {
	const rows = typeof source === "function" ? source() : source;
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return Math.max(1, options.fallback);
	return Math.max(1, rows - options.chrome);
}

/**
 * One key-hint entry: plain dim text, or text in a chosen semantic color so a
 * primary action (approve, submit) stands out from the scroll hints.
 */
export type ScreenHint = string | { text: string; color?: ThemeColor };

/**
 * A key-hint footer indented by `indent` columns (default `BODY_INDENT`, which
 * hangs it under a screen's title rule), joined with ` · `. Plain hints are dim;
 * an object hint uses its color (dim when omitted). Hints are added while they
 * fit, so a narrow terminal drops whole keys instead of truncating one in half.
 * The first hint is always kept; the result is clipped to `width`.
 */
export function screenHint(theme: Theme, width: number, hints: ScreenHint[], indent = BODY_INDENT): string {
	const target = Math.max(1, width);
	// Keep a column for the hint itself, however deep the caller indents.
	const lead = " ".repeat(Math.max(0, Math.min(Math.floor(indent), target - 1)));
	const render = (hint: ScreenHint): string =>
		typeof hint === "string" ? theme.fg("dim", hint) : theme.fg(hint.color ?? "dim", hint.text);
	const separator = theme.fg("dim", SEPARATORS.item);
	const kept: ScreenHint[] = [];
	for (const hint of hints) {
		const candidate = [...kept, hint].map(render).join(separator);
		if (kept.length > 0 && visibleWidth(`${lead}${candidate}`) > target) break;
		kept.push(hint);
	}
	return truncateToWidth(`${lead}${kept.map(render).join(separator)}`, target);
}

/**
 * The sections of a docked list screen, assembled by {@link dockListFrame}.
 * `body`, `range`, and `detail` lines are built (and truncated) by the caller;
 * the frame only places them.
 */
export interface DockListFrame {
	/** The pre-rendered header line, usually `titleRule(theme, width, title)`. */
	header: string;
	/** A summary line under the header; a blank line follows it. */
	summary?: string;
	/** The list rows, or the screen's single empty-state line. */
	body: string[];
	/** A scroll-range row printed after the body. */
	range?: string;
	/** Focused-row footnotes printed after the range. */
	detail?: string[];
	/** The key-hint row. */
	hint: string;
}

/**
 * Assemble a docked list screen: the caller's header rule, an optional summary
 * and its blank line, the body, an optional range row, optional detail rows, and
 * the blank-line-padded key-hint footer.
 *
 * This is the convention every docked list screen shares — the bytefly panel,
 * `/jobs`, `/watch`, `/todos`, `/memory`, and `/rewind`. The header line is built
 * by the caller (usually `titleRule`), so the frame never picks a rule style.
 */
export function dockListFrame(frame: DockListFrame): string[] {
	const lines: string[] = [frame.header];
	if (frame.summary !== undefined) lines.push(frame.summary, "");
	lines.push(...frame.body);
	if (frame.range !== undefined) lines.push(frame.range);
	if (frame.detail !== undefined) lines.push(...frame.detail);
	lines.push("", frame.hint, "");
	return lines;
}

/**
 * Reuse the previous render's `Text` component when it is one, so a tool
 * renderer updates in place instead of allocating on every render. Every
 * extension's `renderCall`/`renderResult` uses this idiom.
 */
export function reuseText(last: unknown, initial = ""): Text {
	return last instanceof Text ? last : new Text(initial, 0, 0);
}

/**
 * A tool result's own `details`, or `undefined` when it is Pi's rejection
 * result.
 *
 * Pi validates a call before `execute`; a validation failure or a permission
 * block returns `{ content, details: {}, isError: true }` with the reason only
 * in `content`. A tool's own details always carries at least one field, so an
 * empty object marks that rejection. Renderers use this to fall back to the
 * message instead of reading an empty object as state.
 */
export function toolDetails<T extends object>(details: unknown): T | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	return Object.keys(details).length > 0 ? (details as T) : undefined;
}

/** Minimal editor theme for an extension-owned inline editor, on semantic tokens. */
export function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("borderMuted", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}
