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
 * the top rule and the closing rule, clamp a screen's body to the terminal, and
 * render the key-hint footer, so each screen keeps its own layout but not its
 * own copy of the arithmetic or hint vocabulary.
 *
 * No runtime dependencies beyond `@earendil-works/pi-tui`: the theme is passed
 * in, and the viewport options are explicit.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type EditorTheme, type OverlayOptions } from "@earendil-works/pi-tui";
import { SEPARATORS } from "./glyphs.ts";
import { BODY_INDENT } from "./indent.ts";
import { plainRule } from "./rules.ts";
import { paint, type TuiRole } from "./tokens.ts";

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
 * One key-hint entry: plain faint text, or text in a chosen role so a primary
 * action (approve, submit) stands out from the scroll hints.
 */
export type ScreenHint = string | { text: string; color?: TuiRole };

/**
 * A key-hint footer indented by `indent` columns (default `BODY_INDENT`, which
 * hangs it under a screen's title rule), joined with ` · `. Plain hints are
 * `faint`; an object hint names a role (`faint` when omitted). Hints are added while they
 * fit, so a narrow terminal drops whole keys instead of truncating one in half.
 * The first hint is always kept; the result is clipped to `width`.
 */
export function screenHint(theme: Theme, width: number, hints: ScreenHint[], indent = BODY_INDENT): string {
	const target = Math.max(1, width);
	// Keep a column for the hint itself, however deep the caller indents.
	const lead = " ".repeat(Math.max(0, Math.min(Math.floor(indent), target - 1)));
	const render = (hint: ScreenHint): string =>
		typeof hint === "string" ? paint(theme, "faint", hint) : paint(theme, hint.color ?? "faint", hint.text);
	const separator = paint(theme, "faint", SEPARATORS.item);
	const kept: ScreenHint[] = [];
	for (const hint of hints) {
		const candidate = [...kept, hint].map(render).join(separator);
		if (kept.length > 0 && visibleWidth(`${lead}${candidate}`) > target) break;
		kept.push(hint);
	}
	return truncateToWidth(`${lead}${kept.map(render).join(separator)}`, target);
}

/**
 * The bottom of a screen: a blank row, its key-hint row, and the closing rule.
 *
 * {@link dockListFrame} ends a docked list screen with this, and a screen that
 * lays out its own rows — `/context`, the WeChat login and control screens —
 * closes its block with it too, so no screen spells the three rows out alone. A
 * screen whose row above the hint varies (a scroll gauge or a blank) places its
 * own rule with `plainRule` instead.
 */
export function screenFooter(theme: Theme, width: number, hint: string): string[] {
	return ["", hint, plainRule(theme, width)];
}

/**
 * The sections of a docked list screen, assembled by {@link dockListFrame}.
 * `body`, `range`, and `detail` lines are built (and truncated) by the caller;
 * the frame only places them.
 */
export interface DockListFrame {
	/** The active theme, used for the closing rule. */
	theme: Theme;
	/** The screen width in columns, used for the closing rule. */
	width: number;
	/** The pre-rendered header line, usually `titleRule(theme, width, title)`. */
	header: string;
	/** A summary line under the header; a blank line follows it. */
	summary?: string;
	/** The list rows, or the screen's single empty-state line. */
	body: string[];
	/** A scroll-range row printed after the body. */
	range?: string;
	/**
	 * Focused-row footnotes printed after a blank line, so they do not read as one
	 * more row. Empty means no block and no blank line.
	 */
	detail?: string[];
	/**
	 * Draw the blank line above the detail block. Defaults to true. A caller that
	 * has already shed every optional row on a short terminal passes false so the
	 * block itself survives without its separator.
	 */
	detailBlank?: boolean;
	/** The key-hint row. */
	hint: string;
}

/**
 * The rows a detail block costs: its lines plus the blank line above it.
 *
 * Callers feed this to `fitRows` so the block cannot push the hint row off a
 * short terminal. It is the companion to {@link dockListFrame}, which places the
 * block; the two have to agree on when the block exists.
 */
export function detailBlockRows(detail: readonly string[] | undefined, blank = true): number {
	if (detail === undefined || detail.length === 0) return 0;
	return detail.length + (blank ? 1 : 0);
}

/**
 * Assemble a docked list screen: the caller's header rule, an optional summary
 * and its blank line, the body, an optional range row, optional detail rows after
 * their own blank line, the key-hint row, and the closing rule.
 *
 * This is the convention every docked list screen shares — the bytefly panel,
 * `/jobs`, `/watch`, `/todos`, `/memory`, and `/rewind`. The header line is built
 * by the caller (usually `titleRule`), so the frame never picks the *opening*
 * rule style; the closing rule is always the muted fill, matching the closing
 * rule Pi's built-in selectors draw and the bottom border of the editor slot the
 * screen replaces.
 */
export function dockListFrame(frame: DockListFrame): string[] {
	const lines: string[] = [frame.header];
	if (frame.summary !== undefined) lines.push(frame.summary, "");
	lines.push(...frame.body);
	if (frame.range !== undefined) lines.push(frame.range);
	if (frame.detail !== undefined && frame.detail.length > 0) {
		if (frame.detailBlank !== false) lines.push("");
		lines.push(...frame.detail);
	}
	lines.push(...screenFooter(frame.theme, frame.width, frame.hint));
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

/** Minimal editor theme for an extension-owned inline editor, on semantic roles. */
export function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => paint(theme, "rule", text),
		selectList: {
			selectedPrefix: (text) => paint(theme, "accent", text),
			selectedText: (text) => paint(theme, "accent", text),
			description: (text) => paint(theme, "meta", text),
			scrollInfo: (text) => paint(theme, "faint", text),
			noMatch: (text) => paint(theme, "warn", text),
		},
	};
}
