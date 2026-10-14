/**
 * Pure HTML atoms shared by the Bytefly browser pages.
 *
 * Each helper returns a string with every dynamic *value* escaped through
 * `lib/escape.ts`. Fields documented as trusted (`css`, an `icon` glyph, an
 * attribute key) are code-authored constants, never model or file text.
 */

import { escapeHtml } from "../escape.ts";

/** Options for {@link docHead}. */
export interface DocHeadOptions {
	/** Page title, escaped. */
	title: string;
	/** Trusted CSS assembled by the page. */
	css: string;
}

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
<style>${options.css}</style>
<script src="/theme.js"></script>`;
}

/**
 * The Bytefly nameplate: the two-tone half-block mark, the `bytefly` wordmark,
 * and the product name. The mark mirrors the TUI header (`█▀█` / `█▀ █`), drawn
 * as a 4x2 grid so the accent and warning rows stay crisp at any zoom.
 */
export function brandLockup(product: string): string {
	return `<span class="bf-brand"><svg class="bf-mark" viewBox="0 0 4 2" aria-hidden="true"><g class="bf-mark__top"><rect x="0" y="0" width="1" height="1"/><rect x="1" y="0" width="1" height="0.5"/><rect x="2" y="0" width="1" height="1"/></g><g class="bf-mark__bottom"><rect x="0" y="1" width="1" height="1"/><rect x="1" y="1" width="1" height="0.5"/><rect x="3" y="1" width="1" height="1"/></g></svg><span class="bf-wordmark">bytefly</span><span class="bf-context">${escapeHtml(product)}</span></span>`;
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
