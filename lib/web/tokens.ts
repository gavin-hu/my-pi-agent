/**
 * The Bytefly web palette and scales.
 *
 * The colour set is **derived** from the Bytefly terminal themes
 * (`themes/bytefly-dark.json`, `themes/bytefly-light.json`) so the browser and
 * the TUI cannot drift: a token only exists here as a mapping to a theme var or
 * a resolved `colors.*` entry. Web-only values (type, space, radius, motion)
 * are added on top.
 *
 * Value-only: the CSS is a constant computed at module load, with no state.
 */

import darkTheme from "../../themes/bytefly-dark.json";
import lightTheme from "../../themes/bytefly-light.json";

interface ThemeJson {
	vars: Record<string, string>;
	colors: Record<string, string | number>;
}

const DARK = darkTheme as unknown as ThemeJson;
const LIGHT = lightTheme as unknown as ThemeJson;

/** Web custom property -> Bytefly theme var. `--accent-soft` is derived. */
const VAR_TOKENS: ReadonlyArray<readonly [string, string]> = [
	["--canvas", "canvas"],
	["--surface", "canvasSubtle"],
	["--surface-raised", "selectionBg"],
	["--selected", "selectionBg"],
	["--border", "borderMuted"],
	["--border-strong", "border"],
	["--text", "text"],
	["--muted", "muted"],
	["--dim", "dim"],
	["--accent", "blue"],
	["--accent-alt", "purple"],
	["--accent-2", "pink"],
	["--success", "green"],
	["--danger", "red"],
	["--warn", "yellow"],
	["--success-soft", "successBg"],
	["--danger-soft", "errorBg"],
	["--search-soft", "searchBg"],
];

/** Syntax token class custom property -> Bytefly theme color name. */
const SYNTAX_TOKENS: ReadonlyArray<readonly [string, string]> = [
	["--tok-comment", "syntaxComment"],
	["--tok-keyword", "syntaxKeyword"],
	["--tok-string", "syntaxString"],
	["--tok-number", "syntaxNumber"],
	["--tok-literal", "syntaxNumber"],
	["--tok-tag", "syntaxString"],
	["--tok-attr", "syntaxFunction"],
	["--tok-prop", "syntaxFunction"],
	["--tok-var", "syntaxType"],
];

/** Theme-independent scales: fonts, sizes, spacing, radius, motion, focus. */
const SCALES =
	'--font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
	'--font-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;' +
	"--fs-xs:12px;--fs-sm:13px;--fs-md:14px;--fs-base:15px;--fs-lg:19px;--fs-xl:24px;--fs-code:13px;" +
	"--lh-tight:1.25;--lh-snug:1.4;--lh-normal:1.5;--lh-relaxed:1.6;" +
	"--fw-normal:400;--fw-medium:500;--fw-semibold:600;--fw-bold:700;" +
	"--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-7:32px;--space-8:48px;" +
	"--radius-sm:4px;--radius-md:6px;--radius-lg:10px;--radius-pill:999px;" +
	"--motion-fast:80ms;--motion-base:140ms;--motion-ease:cubic-bezier(.2,.6,.2,1);--focus-ring:2px";

/** Resolve a theme color value (a hex, a var name, or a number) to a string. */
function resolve(theme: ThemeJson, value: string | number): string {
	if (typeof value === "number") return String(value);
	if (value.startsWith("#")) return value;
	return theme.vars[value] ?? value;
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

/** The full custom-property set for one appearance. */
function paletteOf(theme: ThemeJson, accentAlpha: number): Record<string, string> {
	const palette: Record<string, string> = {};
	for (const [token, name] of VAR_TOKENS) palette[token] = theme.vars[name];
	palette["--accent-soft"] = rgba(palette["--accent"] ?? "#000000", accentAlpha);
	for (const [token, name] of SYNTAX_TOKENS) palette[token] = resolve(theme, theme.colors[name] ?? "");
	return palette;
}

/** Every token value per appearance, for tests and for building the CSS. */
export const WEB_THEME_TOKENS: { dark: Record<string, string>; light: Record<string, string> } = {
	dark: paletteOf(DARK, 0.15),
	light: paletteOf(LIGHT, 0.1),
};

/** `a{color:var(--tok-keyword)}…` for each syntax token. */
const SYNTAX_RULES = SYNTAX_TOKENS.map(([token]) => `.tok-${token.slice("--tok-".length)}{color:var(${token})}`).join(
	"",
);

function declarations(tokens: Record<string, string>): string {
	return Object.entries(tokens)
		.map(([token, value]) => `${token}:${value}`)
		.join(";");
}

/**
 * The theme CSS: Bytefly-derived dark tokens at `:root`, an explicit light
 * override, the system light fallback, and the `tok-*` colour rules. Pages
 * prepend this to their own component CSS.
 */
export const WEB_THEME_CSS = `:root{${declarations(WEB_THEME_TOKENS.dark)};${SCALES};color-scheme:dark}
:root[data-theme="light"]{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme]){${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}
${SYNTAX_RULES}`;
