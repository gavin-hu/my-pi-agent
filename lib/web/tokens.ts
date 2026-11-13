/**
 * The Bytefly web palette and scales.
 *
 * The colour set is **derived** from the terminal themes — `themes/bytefly-dark.json` and
 * `themes/bytefly-light.json` — so a served page and the terminal cannot drift: a page is the same
 * product in another medium. A token exists here as a mapping to a theme var, a resolution of a
 * theme colour, or a step the theme has no name for. The web's own language — the UI face, mono
 * only where the text *is* code, the radii, the two shadows — is stated on top of it.
 *
 * Value-only: the CSS is a constant computed at module load, with no state.
 */

import darkTheme from "../../themes/bytefly-dark.json";
import lightTheme from "../../themes/bytefly-light.json";

/** The two appearances a page draws. */
export type Appearance = "dark" | "light";

/** A theme document, as far as a palette reads it. */
interface ThemeDocument {
	vars: Record<string, string>;
	colors: Record<string, string | number>;
}

const THEMES: Record<Appearance, ThemeDocument> = {
	dark: darkTheme as ThemeDocument,
	light: lightTheme as ThemeDocument,
};

/**
 * Each web token, and the theme var that states it. `--dim` is the one colour absent from this
 * table: a theme states it for a terminal, and a page asks more of it (see `paletteOf`).
 */
const ROLES: ReadonlyArray<readonly [token: string, variable: string]> = [
	["--canvas", "canvas"],
	["--surface", "canvasSubtle"],
	["--border", "borderMuted"],
	["--border-strong", "border"],
	["--text", "text"],
	["--muted", "muted"],
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

/** The syntax token names, as a highlighter writes the class suffix, and the theme colour behind one. */
const SYNTAX_ALIASES: ReadonlyArray<readonly [string, string]> = [
	["comment", "syntaxComment"],
	["keyword", "syntaxKeyword"],
	["string", "syntaxString"],
	["number", "syntaxNumber"],
	["literal", "syntaxNumber"],
	["tag", "syntaxString"],
	["attr", "syntaxFunction"],
	["prop", "syntaxFunction"],
	["var", "syntaxType"],
];

/**
 * What a theme cannot name, one entry per appearance.
 *
 * `raisedStep` lifts a plane off the surface, `dimStep` takes the faint tier one step down from
 * `muted`, `accentAlpha` tints a selected row, and `scrim`/`shadow` are a page's overlays and
 * elevation rather than colours on a grid.
 */
const DERIVED: Record<
	Appearance,
	{ raisedStep: number; dimStep: number; accentAlpha: number; scrim: string; shadow1: string; shadow2: string }
> = {
	dark: {
		raisedStep: 0.06,
		dimStep: 0.04,
		// A card's paper is this tint over a surface, and the board holds its faint tier to
		// 4.5:1 there: at the 15% a selected row can take, `--dim` reaches 4.09:1 (dark) and
		// 4.31:1 (light), so the tint is the strength both jobs can share.
		accentAlpha: 0.08,
		scrim: "rgba(3,6,12,.62)",
		shadow1: "0 1px 2px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.35)",
		shadow2: "0 8px 24px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.4)",
	},
	light: {
		// A smaller step: at the dark one, a label on the raised plane drops under AA.
		raisedStep: 0.03,
		dimStep: 0.08,
		accentAlpha: 0.06,
		scrim: "rgba(15,23,42,.32)",
		shadow1: "0 1px 2px rgba(16,24,40,.06),0 2px 8px rgba(16,24,40,.08)",
		shadow2: "0 8px 24px rgba(16,24,40,.12),0 1px 3px rgba(16,24,40,.08)",
	},
};

/** The per-appearance steps above, for tests that hold a derivation to its inputs. */
export const WEB_DERIVATION = DERIVED;

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

/** A theme colour value — a hex or the name of one of its vars — as a colour. */
function resolve(theme: ThemeDocument, value: string | number): string {
	if (typeof value === "number") return String(value);
	return value.startsWith("#") ? value : (theme.vars[value] ?? value);
}

/**
 * `#rrggbb` mixed toward another colour: `t` of the way from `a` to `b`.
 *
 * Exported so a test can hold a derivation to its inputs — a value that clears a floor by a
 * hundredth has to be checked as a relation, not as the hex it happens to produce today.
 */
export function mix(a: string, b: string, t: number): string {
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
 * Every colour is the theme's, except two that a terminal does not ask for. `--dim` is one step
 * off `muted` toward the canvas: a terminal asks 3:1 of its `dim` on a canvas, while the kit asks
 * 4.5 where a page reads it, and the theme's value reaches 4.08:1 (dark) and 4.05:1 (light) on a
 * raised plane. And `--accent-soft` carries the alpha both of its jobs can share — a selected row
 * and a card's paper, which the board holds to the same 4.5. A floor is a guarantee, so it does
 * not move to keep a mapping literal.
 */
function paletteOf(appearance: Appearance): Record<string, string> {
	const theme = THEMES[appearance];
	const steps = DERIVED[appearance];
	const tokens: Record<string, string> = {};
	for (const [token, variable] of ROLES) tokens[token] = theme.vars[variable] ?? "";
	tokens["--dim"] = mix(theme.vars.muted ?? "", theme.vars.canvas ?? "", steps.dimStep);
	// One step above `--surface`, for a block that must read as a plane rather than an outline.
	tokens["--raised"] = mix(theme.vars.canvasSubtle ?? "", theme.vars.text ?? "", steps.raisedStep);
	tokens["--accent-soft"] = rgba(theme.vars.blue ?? "", steps.accentAlpha);
	// A label on the accent fill is the canvas colour: the light theme's dark blue takes white,
	// and the dark theme's light blue takes the canvas it sits on.
	tokens["--on-accent"] = theme.vars.canvas ?? "";
	tokens["--scrim"] = steps.scrim;
	tokens["--shadow-1"] = steps.shadow1;
	tokens["--shadow-2"] = steps.shadow2;
	for (const [token, name] of SYNTAX_ALIASES) tokens[`--tok-${token}`] = resolve(theme, theme.colors[name] ?? "");
	return tokens;
}

/** Every token value per appearance, for tests and for building the CSS. */
export const WEB_THEME_TOKENS: { dark: Record<string, string>; light: Record<string, string> } = {
	dark: paletteOf("dark"),
	light: paletteOf("light"),
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
 * The theme CSS: the theme's dark tokens at `:root`, an explicit light override, the system light
 * fallback, and the `tok-*` colour rules. Pages prepend this to their own component CSS.
 */
export const WEB_THEME_CSS = `:root{${declarations(WEB_THEME_TOKENS.dark)};${SCALES};color-scheme:dark}
:root[data-theme="light"]{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme]){${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}
${SYNTAX_RULES}
/* Paper is white: print the light palette whatever the screen is showing. */
@media print{:root{${declarations(WEB_THEME_TOKENS.light)};color-scheme:light}}`;
