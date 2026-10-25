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

/** Web custom property -> Bytefly theme var. `--accent-soft`, `--raised`, `--on-accent`,
 * `--scrim`, and `--shadow` are derived, so no appearance-only colour enters the kit. */
const VAR_TOKENS: ReadonlyArray<readonly [string, string]> = [
	["--canvas", "canvas"],
	["--surface", "canvasSubtle"],
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
 * Overlays are not palette entries: a scrim dims what is behind it and a shadow
 * lifts a panel off it, so each appearance needs its own alpha rather than the
 * theme's colours.
 */
/**
 * How far `--raised` sits above `--surface`: enough to see, not enough to shout.
 *
 * The light theme takes a smaller step because its accent is darker: at the dark
 * step, `--accent` on `--raised` falls to 4.34:1 and the owner chips on a raised row
 * stop being readable.
 */
const RAISED_STEP: Record<"dark" | "light", number> = { dark: 0.06, light: 0.03 };

const OVERLAYS: Record<"dark" | "light", { scrim: string; shadow: string }> = {
	dark: { scrim: "rgba(0,0,0,.5)", shadow: "0 8px 24px rgba(0,0,0,.4)" },
	light: { scrim: "rgba(15,23,42,.3)", shadow: "0 8px 24px rgba(15,23,42,.14)" },
};

/** The full custom-property set for one appearance. */
function paletteOf(theme: ThemeJson, appearance: "dark" | "light", accentAlpha: number): Record<string, string> {
	const palette: Record<string, string> = {};
	for (const [token, name] of VAR_TOKENS) palette[token] = theme.vars[name];
	palette["--accent-soft"] = rgba(palette["--accent"] ?? "#000000", accentAlpha);
	// One step above `--surface`, for a block that must read as a plane rather than an
	// outline: the theme offers only two neutral fills, and a surface one hairline
	// lighter than the page is what made a dashboard look like a wireframe.
	palette["--raised"] = mix(palette["--surface"] ?? "#000000", palette["--text"] ?? "#ffffff", RAISED_STEP[appearance]);
	// A label on the accent fill is the canvas colour: a light blue button takes dark
	// text, and the same derivation gives white on the light theme's darker blue.
	palette["--on-accent"] = palette["--canvas"];
	palette["--scrim"] = OVERLAYS[appearance].scrim;
	palette["--shadow"] = OVERLAYS[appearance].shadow;
	for (const [token, name] of SYNTAX_TOKENS) palette[token] = resolve(theme, theme.colors[name] ?? "");
	return palette;
}

/** Every token value per appearance, for tests and for building the CSS. */
export const WEB_THEME_TOKENS: { dark: Record<string, string>; light: Record<string, string> } = {
	dark: paletteOf(DARK, "dark", 0.15),
	light: paletteOf(LIGHT, "light", 0.1),
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
${SYNTAX_RULES}
/* Paper is white: print the light palette whatever the screen is showing. */
@media print{:root{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}`;
