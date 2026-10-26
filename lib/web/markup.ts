/**
 * Pure HTML atoms shared by the Bytefly browser pages.
 *
 * Each helper returns a string with every dynamic *value* escaped through
 * `lib/escape.ts`. Fields documented as trusted (`css`, an `icon` glyph, an
 * attribute key) are code-authored constants, never model or file text.
 */

import { escapeHtml } from "../escape.ts";
import { THEME_JS_PATH } from "./runtime.ts";
import { WEB_THEME_TOKENS } from "./tokens.ts";

/** Options for {@link docHead}. */
export interface DocHeadOptions {
	/** Page title, escaped. */
	title: string;
	/** Trusted CSS assembled by the page. */
	css: string;
}

/**
 * A page's browser-tab title: `<page> · <subject> · <count>`.
 *
 * One convention across the served pages, so a strip of tabs reads as one product. The
 * page's name comes first, lowercase and the same word its header's `brandLockup`
 * carries; then what the page is showing; then the count a reader opens the tab for. A
 * part the page does not have is left out rather than drawn empty, so a board with
 * nothing open reads `board · my-pi-agent` and a plan reads `plan review · <its title>`.
 */
export function tabTitle(product: string, subject?: string, count?: string): string {
	const kept = [product, subject, count];
	return kept.filter((part) => part !== undefined && part !== "").join(" · ");
}

/**
 * The same body, as the browser receives it.
 *
 * The board's count is live, so its tab is repainted on every frame and this rule has to
 * cross into the bundle. It is written as concatenation with no backtick and no
 * interpolation, because the bundle is a template the source is spliced into.
 */
export const TAB_TITLE_JS = String(tabTitle);

/**
 * The shared document head: charset, viewport, colour scheme, title, the page
 * CSS, and the pre-paint theme bootstrap. The body and its scripts stay with
 * each page.
 */
export function docHead(options: DocHeadOptions): string {
	return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(options.title)}</title>
${markIcon()}
<style>${options.css}</style>
<script src="${THEME_JS_PATH}"></script>`;
}

/**
 * The mark's blocks: `█▀█` over `█▀ █`, as `[x, height]` per row in a 4x2 grid.
 *
 * One shape, three places — the header lockup, the tab icon, and the TUI header's
 * half-blocks — so it is written once. The rows differ: the top fills x=2, the bottom
 * leaves it empty and fills x=3, which is what makes the mark read as two glyphs.
 */
const MARK_ROWS: ReadonlyArray<{ group: "top" | "bottom"; rects: ReadonlyArray<readonly [number, number]> }> = [
	{
		group: "top",
		rects: [
			[0, 1],
			[1, 0.5],
			[2, 1],
		],
	},
	{
		group: "bottom",
		rects: [
			[0, 1],
			[1, 0.5],
			[3, 1],
		],
	},
];

/** One row of the mark, as `<rect>`s starting at `y`. */
function markRowRects(row: (typeof MARK_ROWS)[number], y: number): string {
	return row.rects.map(([x, height]) => `<rect x="${x}" y="${y}" width="1" height="${height}"/>`).join("");
}

/**
 * The mark as a standalone SVG, in one appearance's colours.
 *
 * A favicon is its own document: it cannot read the page's tokens, so the fills are
 * resolved here from the same palette the page paints with, and each appearance gets
 * its own icon.
 */
function markSvg(fills: { top: string; bottom: string }): string {
	const rows = MARK_ROWS.map((row, index) => `<g fill="${fills[row.group]}">${markRowRects(row, index)}</g>`);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2">${rows.join("")}</svg>`;
}

/**
 * The tab icon: the mark, in the appearance the reader's system is in.
 *
 * The dark icon is the plain `rel="icon"` — the page paints dark at `:root`, and a
 * browser that reads no `media` query on an icon keeps it. The light one is the
 * override, so a light tab does not carry a mark tuned for a dark one.
 */
export function markIcon(): string {
	const dark = encodeURIComponent(
		markSvg({ top: WEB_THEME_TOKENS.dark["--accent"], bottom: WEB_THEME_TOKENS.dark["--warn"] }),
	);
	const light = encodeURIComponent(
		markSvg({ top: WEB_THEME_TOKENS.light["--accent"], bottom: WEB_THEME_TOKENS.light["--warn"] }),
	);
	return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${dark}">
<link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: light)" href="data:image/svg+xml,${light}">`;
}

/**
 * The Bytefly nameplate: the two-tone half-block mark, the `bytefly` wordmark,
 * and the product name. The mark mirrors the TUI header (`█▀█` / `█▀ █`), drawn
 * as a 4x2 grid so the accent and warning rows stay crisp at any zoom.
 */
export function brandLockup(product: string): string {
	const rows = MARK_ROWS.map((row, index) => `<g class="bf-mark__${row.group}">${markRowRects(row, index)}</g>`);
	return `<span class="bf-brand"><svg class="bf-mark" viewBox="0 0 4 2" aria-hidden="true">${rows.join("")}</svg><span class="bf-wordmark">bytefly</span><span class="bf-context">${escapeHtml(product)}</span></span>`;
}

/**
 * The theme toggle button. Keeps the `#theme-toggle` id and `.theme-glyph`
 * span the shared `THEME_TOGGLE_JS` scripts find.
 */
export function themeToggle(): string {
	return `<button type="button" class="bf-btn bf-btn--icon bf-theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span class="theme-glyph" aria-hidden="true">\u263E</span></button>`;
}

/** A chip's tone, mapping to a `bf-chip--*` modifier. */
export type ChipTone = "accent" | "success" | "warn" | "danger";

/** Options for {@link chip}. */
export interface ChipOptions {
	/** Visible text, escaped. */
	label: string;
	/** Optional tone modifier. */
	tone?: ChipTone;
	/** Trusted leading glyph or SVG. */
	icon?: string;
}

/** A compact status chip. */
export function chip(options: ChipOptions): string {
	const tone = options.tone ? ` bf-chip--${options.tone}` : "";
	const icon = options.icon ? `<span class="bf-chip__icon" aria-hidden="true">${options.icon}</span>` : "";
	return `<span class="bf-chip${tone}">${icon}${escapeHtml(options.label)}</span>`;
}

/** A button variant, mapping to a `bf-btn--*` modifier. */
export type ButtonVariant = "primary" | "ghost" | "icon";

/** Options for {@link button}. */
export interface ButtonOptions {
	/** Visible text, escaped. */
	label: string;
	/** Optional variant modifier. */
	variant?: ButtonVariant;
	/** Element id. */
	id?: string;
	/** Tooltip and accessible name. */
	title?: string;
	/** Sets `aria-pressed` when defined. */
	pressed?: boolean;
	/** Extra code-authored attributes; keys and values are escaped. */
	attrs?: Record<string, string>;
}

/** A `type="button"` control wired to the kit classes. */
export function button(options: ButtonOptions): string {
	const classes = options.variant ? `bf-btn bf-btn--${options.variant}` : "bf-btn";
	const attrs: Array<[string, string]> = [];
	if (options.id) attrs.push(["id", options.id]);
	if (options.title) attrs.push(["title", options.title]);
	if (options.pressed !== undefined) attrs.push(["aria-pressed", String(options.pressed)]);
	for (const [key, value] of Object.entries(options.attrs ?? {})) attrs.push([key, value]);
	const rendered = attrs.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join("");
	return `<button type="button" class="${classes}"${rendered}>${escapeHtml(options.label)}</button>`;
}

/** One row of the keyboard sheet: the key or chord, and what it does. */
export interface KeyHint {
	/** The key or chord, one `<kbd>` per entry; a single string is one key, chord, or alias run. */
	keys: string | readonly string[];
	/** What the key does. */
	label: string;
}

/**
 * The `?` keyboard sheet: the dialog of key/label rows both pages share, hidden
 * until the client opens it.
 *
 * The ids are the contract with `keysDialogScript` in `runtime.ts` — `#keys-dialog`
 * for the sheet, `#keys-close` for its own close button — and the trigger button
 * is the page's own concern, since the two pages name it differently.
 */
export function keysSheet(rows: readonly KeyHint[]): string {
	const kbd = (key: string): string => `<kbd class="bf-kbd">${escapeHtml(key)}</kbd>`;
	const body = rows
		.map((row) => {
			const keys = typeof row.keys === "string" ? kbd(row.keys) : row.keys.map(kbd).join(" ");
			return `<div><dt>${keys}</dt><dd>${escapeHtml(row.label)}</dd></div>`;
		})
		.join("\n");
	return `<div class="bf-dialog" id="keys-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="keys-title">
<div class="bf-dialog__head"><h2 id="keys-title">Keyboard shortcuts</h2><span class="bf-spacer"></span><button type="button" class="bf-btn" id="keys-close">Close</button></div>
<dl class="bf-keys">${body}</dl>
</div>
</div>`;
}
