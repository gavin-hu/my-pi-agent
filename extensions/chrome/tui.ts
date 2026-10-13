/**
 * The chrome extension's TUI components: a themed header and a decorated
 * editor.
 *
 * `ChromeHeader` reproduces Pi's built-in header structure (brand mark,
 * version, key-hint row) and drives every color from the active theme's
 * tokens. It adds no session or model data; the version is Pi's own. The
 * hint row is resolved from the `KeybindingsManager` the host passes to the
 * editor factory, so the header degrades to mark + version when that manager
 * is unavailable.
 *
 * `ChromeEditor` extends Pi's `CustomEditor` and only splices a themed badge
 * into the top border. Text editing and every application shortcut stay in the
 * base class. Both components build their themed strings in `render` from a
 * live theme getter, so a theme change needs no rebuild.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	CustomEditor,
	VERSION,
	type CustomEditorOptions,
	type KeybindingsManager,
	type Theme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type EditorTheme,
	type Keybinding,
	sliceByColumn,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { SEPARATORS } from "../../lib/ui.ts";
import { CONFIG } from "./config.ts";

/** How the header's brand mark is drawn. */
export type HeaderMark = "wordmark" | "logo" | "none";

/** The header's user-configurable shape. */
export interface HeaderView {
	mark: HeaderMark;
	showVersion: boolean;
	showHints: boolean;
}

/** `ThemeColor` token per thinking level, for the editor badge. */
const THINKING_TOKENS: Record<string, ThemeColor> = {
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

/** A reproduced two-line half-block mark, themed from `accent` and `warning`. */
function logoLines(theme: Theme): string[] {
	return [theme.fg("accent", "█▀█ "), theme.fg("accent", "█▀ ") + theme.fg("warning", "█")];
}

/**
 * A single left/right line: `left` at column 0, `right` right-aligned, and a
 * one-column minimum gap. `right` is dropped when it cannot fit; neither zone
 * is ever truncated into an ellipsis.
 */
function formatLine(width: number, left: string, right: string): string {
	if (right) {
		const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		return truncateToWidth(left + " ".repeat(pad) + right, width, "");
	}
	return truncateToWidth(left, width, "");
}

/** The themed header component. */
export class ChromeHeader implements Component {
	constructor(
		private readonly getTheme: () => Theme,
		private readonly view: () => HeaderView,
		private readonly getKeybindings: () => KeybindingsManager | undefined,
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
		let right = view.showHints ? this.hintText(theme) : "";
		// Drop the hint row whole, then the version, before touching the mark.
		if (right && visibleWidth(left) + 2 + visibleWidth(right) > w) right = "";
		if (mark && visibleWidth(left) > w) left = mark;
		lines.push(formatLine(w, left, right));
		return lines;
	}

	/** The dim key list (right) and muted label, joined with the shared separator. */
	private hintText(theme: Theme): string {
		const keybindings = this.getKeybindings();
		if (!keybindings) return "";
		const parts: string[] = [];
		for (const hint of CONFIG.header.hints) {
			const keys = keybindings.getKeys(hint.action as Keybinding);
			if (keys.length === 0) continue;
			parts.push(theme.fg("dim", keys.join("/")) + theme.fg("muted", ` ${hint.label}`));
		}
		return parts.join(theme.fg("dim", SEPARATORS.item));
	}
}

/**
 * Splice `badge` into the top border immediately before the top-right corner.
 * `base` is expected to be exactly `width` columns; a badge that does not fit
 * leaves the border untouched.
 */
export function decorateTopBorder(base: string, badge: string | undefined, width: number): string {
	if (!badge) return base;
	const w = Math.max(1, width);
	const badgeWidth = visibleWidth(badge);
	if (badgeWidth + 1 > w) return base;
	const head = sliceByColumn(base, 0, w - badgeWidth - 1);
	const corner = sliceByColumn(base, w - 1, 1);
	return truncateToWidth(head + badge + corner, w);
}

/** Pi's editor with a themed badge showing the current prompt mode. */
export class ChromeEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getTheme: () => Theme,
		private readonly badgeEnabled: () => boolean,
		private readonly getThinkingLevel: () => ThinkingLevel | undefined,
		onKeybindings?: (keybindings: KeybindingsManager) => void,
		options?: CustomEditorOptions,
	) {
		super(tui, theme, keybindings, options);
		onKeybindings?.(keybindings);
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const base = super.renderTopBorder(width, hiddenLineCount);
		if (!this.badgeEnabled()) return base;
		return decorateTopBorder(base, this.badge(), width);
	}

	/** The badge: `bash` while the text starts with `!`, else the thinking level. */
	private badge(): string {
		const theme = this.getTheme();
		const glyph = CONFIG.editor.badgeGlyph;
		if (this.getText().startsWith("!")) {
			return ` ${theme.fg("bashMode", `${glyph} bash`)} `;
		}
		const level = this.getThinkingLevel();
		const token = level ? THINKING_TOKENS[level] : undefined;
		if (token) return ` ${theme.fg(token, `${glyph} ${level}`)} `;
		return ` ${theme.fg("muted", glyph)} `;
	}
}

/** Header factory passed to `ctx.ui.setHeader`. */
export function createHeader(
	getTheme: () => Theme,
	view: () => HeaderView,
	getKeybindings: () => KeybindingsManager | undefined,
): (tui: TUI, theme: Theme) => Component {
	return () => new ChromeHeader(getTheme, view, getKeybindings, VERSION);
}

/** Editor factory passed to `ctx.ui.setEditorComponent`. */
export function createEditor(
	getTheme: () => Theme,
	badgeEnabled: () => boolean,
	getThinkingLevel: () => ThinkingLevel | undefined,
	onKeybindings?: (keybindings: KeybindingsManager) => void,
): (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => ChromeEditor {
	return (tui, theme, keybindings) =>
		new ChromeEditor(tui, theme, keybindings, getTheme, badgeEnabled, getThinkingLevel, onKeybindings);
}
