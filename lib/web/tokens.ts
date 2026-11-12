/**
 * The Bytefly web palette and scales.
 *
 * The web is its own medium, so its palette is its own: a terminal picks colours for glyphs on a
 * cell grid, and a page picks them for type, fills and elevation on a canvas. The TUI's themes
 * (`themes/bytefly-*.json`) therefore no longer feed this file — a theme change restyles the
 * terminal and leaves a served page alone, which is the deliberate trade the kit made when it
 * moved from a terminal's skin to a web one.
 *
 * What the kit keeps is the *shape* of the contract: a token name, one value per appearance, and
 * every component reading `var(--token)`. A page that says `var(--accent)` cannot know which
 * palette answered it, so the palette can change without a page or a component moving.
 *
 * Value-only: the CSS is a constant computed at module load, with no state.
 */

/** One appearance's colours and the two shadows, before derivation. */
interface Palette {
	/** The page's own background. */
	canvas: string;
	/** Chrome and the plane a card sits on. */
	surface: string;
	border: string;
	borderStrong: string;
	text: string;
	muted: string;
	dim: string;
	accent: string;
	accentAlt: string;
	accent2: string;
	success: string;
	danger: string;
	warn: string;
	/** Syntax roles, keyed by the `--tok-*` suffix a highlighter writes. */
	syntax: Record<"comment" | "keyword" | "string" | "number" | "function" | "type", string>;
	/** Elevation: a card, a menu and a key sheet; a dialog and a palette panel. */
	shadow1: string;
	shadow2: string;
	/** The scrim a dialog dims the page with. */
	scrim: string;
	/** The label colour on an accent fill. */
	onAccent: string;
	/** How far `--raised` sits above `--surface`: enough to see, not enough to shout. */
	raisedStep: number;
	/** The accent's alpha for a selected row, a tinted chip, a soft fill. */
	accentAlpha: number;
}

/** Dark: a slate canvas, one indigo accent, and two soft shadows. */
const DARK: Palette = {
	canvas: "#0b0f16",
	surface: "#111826",
	border: "#232f42",
	borderStrong: "#33425c",
	text: "#e8eef8",
	muted: "#a3b1c6",
	dim: "#6b7c93",
	accent: "#8b9dff",
	accentAlt: "#b69cff",
	accent2: "#f472b6",
	success: "#4ade80",
	danger: "#f87171",
	warn: "#fbbf24",
	syntax: {
		comment: "#7b8aa1",
		keyword: "#b69cff",
		string: "#7ee2a8",
		number: "#f0b37e",
		function: "#8b9dff",
		type: "#67d4e8",
	},
	shadow1: "0 1px 2px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.35)",
	shadow2: "0 8px 24px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.4)",
	scrim: "rgba(3,6,12,.62)",
	onAccent: "#0b0f16",
	raisedStep: 0.06,
	accentAlpha: 0.16,
};

/** Light: a near-white page, the same accent one step darker so it stays readable. */
const LIGHT: Palette = {
	canvas: "#f6f7f9",
	surface: "#ffffff",
	border: "#e4e8ee",
	borderStrong: "#cfd6e0",
	text: "#111827",
	muted: "#5b6779",
	dim: "#6e7a8e",
	accent: "#4f46e5",
	accentAlt: "#7c3aed",
	accent2: "#db2777",
	success: "#15803d",
	danger: "#dc2626",
	warn: "#b45309",
	syntax: {
		comment: "#6b7280",
		keyword: "#7c3aed",
		string: "#0f7b46",
		number: "#b45309",
		function: "#4f46e5",
		type: "#0e7490",
	},
	shadow1: "0 1px 2px rgba(16,24,40,.06),0 2px 8px rgba(16,24,40,.08)",
	shadow2: "0 8px 24px rgba(16,24,40,.12),0 1px 3px rgba(16,24,40,.08)",
	scrim: "rgba(15,23,42,.32)",
	onAccent: "#ffffff",
	raisedStep: 0.11,
	accentAlpha: 0.1,
};

/** Theme-independent scales: fonts, sizes, spacing, radius, motion, focus. */
const SCALES =
	'--font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
	'--font-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;' +
	"--fs-xs:12px;--fs-sm:13px;--fs-md:14px;--fs-base:15px;--fs-lg:19px;--fs-xl:24px;--fs-code:13px;" +
	"--lh-tight:1.25;--lh-snug:1.4;--lh-normal:1.5;--lh-relaxed:1.6;" +
	"--fw-normal:400;--fw-medium:500;--fw-semibold:600;--fw-bold:700;" +
	"--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-7:32px;--space-8:48px;" +
	"--radius-sm:4px;--radius-md:6px;--radius-lg:8px;--radius-badge:4px;" +
	"--measure-prose:78ch;" +
	"--motion-fast:80ms;--motion-base:140ms;--motion-ease:cubic-bezier(.2,.6,.2,1);--focus-ring:2px";

/** The syntax token names, as a highlighter writes the class suffix. */
const SYNTAX_ALIASES: ReadonlyArray<readonly [string, keyof Palette["syntax"]]> = [
	["comment", "comment"],
	["keyword", "keyword"],
	["string", "string"],
	["number", "number"],
	["literal", "number"],
	["tag", "string"],
	["attr", "function"],
	["prop", "function"],
	["var", "type"],
];

/** `#rrggbb` mixed toward another colour: `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
	const channel = (hex: string, at: number): number => Number.parseInt(hex.replace("#", "").slice(at, at + 2), 16);
	const between = (x: number, y: number): number => Math.round(x + (y - x) * t);
	const r = between(channel(a, 0), channel(b, 0));
	const g = between(channel(a, 2), channel(b, 2));
	const bl = between(channel(a, 4), channel(b, 4));
	return `#${[r, g, bl].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** `#rrggbb` (or `#rgb`) plus alpha -> `rgba(r,g,b,a)`. */
function rgba(hex: string, alpha: number): string {
	const raw = hex.replace("#", "");
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((char) => char + char)
					.join("")
			: raw;
	const r = Number.parseInt(full.slice(0, 2), 16);
	const g = Number.parseInt(full.slice(2, 4), 16);
	const b = Number.parseInt(full.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The full custom-property set for one appearance.
 *
 * Three values are derived rather than stated, because each one is a rule rather than a choice:
 * `--accent-soft` is the accent at the alpha this appearance needs, `--raised` one step above the
 * surface (a raised plane is the same neutral, lighter), and the two `--*-soft` tones are their
 * own colour at a tint. A hand-picked value for any of them is the drift this function prevents.
 */
function paletteOf(palette: Palette): Record<string, string> {
	const tokens: Record<string, string> = {
		"--canvas": palette.canvas,
		"--surface": palette.surface,
		"--raised": mix(palette.surface, palette.text, palette.raisedStep),
		"--border": palette.border,
		"--border-strong": palette.borderStrong,
		"--text": palette.text,
		"--muted": palette.muted,
		"--dim": palette.dim,
		"--accent": palette.accent,
		"--accent-alt": palette.accentAlt,
		"--accent-2": palette.accent2,
		"--accent-soft": rgba(palette.accent, palette.accentAlpha),
		"--on-accent": palette.onAccent,
		"--success": palette.success,
		"--danger": palette.danger,
		"--warn": palette.warn,
		"--success-soft": rgba(palette.success, 0.14),
		"--danger-soft": rgba(palette.danger, 0.14),
		"--search-soft": rgba(palette.warn, 0.18),
		"--scrim": palette.scrim,
		"--shadow-1": palette.shadow1,
		"--shadow-2": palette.shadow2,
	};
	for (const [token, role] of SYNTAX_ALIASES) tokens[`--tok-${token}`] = palette.syntax[role];
	return tokens;
}

/** Every token value per appearance, for tests and for building the CSS. */
export const WEB_THEME_TOKENS: { dark: Record<string, string>; light: Record<string, string> } = {
	dark: paletteOf(DARK),
	light: paletteOf(LIGHT),
};

/** `a{color:var(--tok-keyword)}…` for each syntax token. */
const SYNTAX_RULES = [...new Set(SYNTAX_ALIASES.map(([token]) => token))]
	.map((token) => `.tok-${token}{color:var(--tok-${token})}`)
	.join("");

function declarations(tokens: Record<string, string>): string {
	return Object.entries(tokens)
		.map(([token, value]) => `${token}:${value}`)
		.join(";");
}

/**
 * The theme CSS: the kit's dark tokens at `:root`, an explicit light override, the system light
 * fallback, and the `tok-*` colour rules. Pages prepend this to their own component CSS.
 */
export const WEB_THEME_CSS = `:root{${declarations(WEB_THEME_TOKENS.dark)};${SCALES};color-scheme:dark}
:root[data-theme="light"]{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme]){${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}
${SYNTAX_RULES}
/* Paper is white: print the light palette whatever the screen is showing. */
@media print{:root{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}`;
