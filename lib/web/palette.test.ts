/**
 * The web palette: the theme's colours, the roles the kit maps from them, and the two rows a
 * terminal cannot state.
 *
 * Split from `web.test.ts` when the palette grew its own mapping table: what a page paints is one
 * subject, and the kit's markup, layout and runtime are another.
 */

import { describe, expect, test } from "bun:test";
import { WEB_THEME_CSS, WEB_THEME_TOKENS, mix } from "./tokens.ts";
import { contrast } from "../../test/helpers/contrast.ts";
import darkTheme from "../../themes/bytefly-dark.json";
import lightTheme from "../../themes/bytefly-light.json";

/** A theme document, as this suite reads it. */
interface ThemeDocument {
	vars: Record<string, string>;
	colors: Record<string, string | number>;
}

const THEMES: Record<"dark" | "light", ThemeDocument> = {
	dark: darkTheme as ThemeDocument,
	light: lightTheme as ThemeDocument,
};

/**
 * Each role the kit maps, and the theme var that owns it — the same table `tokens.ts` declares,
 * restated so a mapping change has to be made twice and cannot ride on a passing run.
 */
const MAPPED: ReadonlyArray<readonly [token: string, variable: string]> = [
	["--canvas", "canvas"],
	["--surface", "canvasSubtle"],
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

describe("web tokens", () => {
	test("is the terminal's palette, stated by the two theme files", () => {
		// A page and the terminal are one product: the colours come from `themes/bytefly-*.json`.
		expect(WEB_THEME_TOKENS.dark["--canvas"]).toBe(THEMES.dark.vars.canvas);
		expect(WEB_THEME_TOKENS.dark["--accent"]).toBe(THEMES.dark.vars.blue);
		expect(WEB_THEME_TOKENS.light["--canvas"]).toBe(THEMES.light.vars.canvas);
		expect(WEB_THEME_TOKENS.light["--accent"]).toBe(THEMES.light.vars.blue);
		expect(WEB_THEME_TOKENS.dark["--shadow-1"]).toBeTruthy();
	});

	test("takes every mapped role from its theme var, in both appearances", () => {
		const drifted = (["dark", "light"] as const).flatMap((appearance) =>
			MAPPED.filter(
				([token, variable]) => WEB_THEME_TOKENS[appearance][token] !== THEMES[appearance].vars[variable],
			).map(
				([token, variable]) =>
					`${appearance}: --${token.slice(2)} is ${WEB_THEME_TOKENS[appearance][token]}, the theme's ${variable} is ${THEMES[appearance].vars[variable]}`,
			),
		);
		expect(drifted, "lib/web/tokens.ts: map the role to its theme var, or state why it is derived").toEqual([]);
	});

	test("derives the border pair off the canvas, at a weight a page reads as a hairline", () => {
		// A terminal draws its borders on a cell grid at 3:1, which a page reads as a frame: every
		// separator, every card and the footer took that weight, and the chrome looked heavier than
		// the content it held. So the pair is a step from the canvas toward the text — 0.16/0.26 dark
		// and 0.11/0.20 light — held to its inputs and to the ratio band those steps produce.
		const STEPS = {
			dark: { border: 0.16, strong: 0.26, band: [1.3, 1.6] },
			light: { border: 0.11, strong: 0.2, band: [1.1, 1.4] },
		} as const;
		for (const appearance of ["dark", "light"] as const) {
			const vars = THEMES[appearance].vars;
			const steps = STEPS[appearance];
			const canvas = vars.canvas ?? "";
			const text = vars.text ?? "";
			expect(WEB_THEME_TOKENS[appearance]["--border"]).toBe(mix(canvas, text, steps.border));
			expect(WEB_THEME_TOKENS[appearance]["--border-strong"]).toBe(mix(canvas, text, steps.strong));
			const hairline = contrast(WEB_THEME_TOKENS[appearance]["--border"], canvas);
			expect(hairline, `${appearance} hairline`).toBeGreaterThanOrEqual(steps.band[0]);
			expect(hairline, `${appearance} hairline`).toBeLessThanOrEqual(steps.band[1]);
			// The strong rule stays a step above the hairline, so a border that means something can
			// still be told from a separator.
			expect(contrast(WEB_THEME_TOKENS[appearance]["--border-strong"], canvas)).toBeGreaterThan(hairline);
		}
	});

	test("derives the faint tier off the theme's muted, not the theme's dim", () => {
		// A terminal asks 3:1 of `dim`; the kit asks 4.5 on a raised plane, where the theme's own
		// value reaches 4.08:1 (dark) and 4.05:1 (light). So the row is a step off `muted`, and the
		// step is held to its inputs rather than to the hex it produces: dark clears the floor by
		// 0.14 and the 0.94 ceiling by 0.002, so a hex-only pin would let the next `muted` change
		// drift the palette with nothing red.
		const STEPS = { dark: 0.04, light: 0.08 } as const;
		for (const appearance of ["dark", "light"] as const) {
			const vars = THEMES[appearance].vars;
			expect(WEB_THEME_TOKENS[appearance]["--dim"]).toBe(mix(vars.muted ?? "", vars.canvas ?? "", STEPS[appearance]));
			expect(WEB_THEME_TOKENS[appearance]["--dim"]).not.toBe(vars.dim);
		}
	});

	test("every token resolves in both appearances", () => {
		for (const appearance of ["dark", "light"] as const) {
			for (const [token, value] of Object.entries(WEB_THEME_TOKENS[appearance])) {
				expect(value, `${appearance} ${token}`).toBeTruthy();
			}
		}
	});

	test("carries the shared syntax-token variables", () => {
		for (const token of ["comment", "keyword", "string", "number", "literal", "tag", "attr", "prop", "var"]) {
			expect(WEB_THEME_TOKENS.dark[`--tok-${token}`]).toBeTruthy();
			expect(WEB_THEME_TOKENS.light[`--tok-${token}`]).toBeTruthy();
		}
	});

	test("keeps body text at WCAG AA against both surfaces", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const surface of ["--canvas", "--surface", "--raised"]) {
				expect(contrast(tokens["--text"], tokens[surface]), `${appearance} text/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
				expect(contrast(tokens["--muted"], tokens[surface]), `${appearance} muted/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
				expect(contrast(tokens["--accent"], tokens[surface]), `${appearance} accent/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
			}
		}
	});

	test("derives a raised surface one visible step above the page's", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			// A raised plane needs more than the 1.09:1 a surface has against the canvas.
			expect(contrast(tokens["--raised"], tokens["--canvas"]), `${appearance} raised`).toBeGreaterThanOrEqual(1.1);
			expect(tokens["--raised"]).not.toBe(tokens["--surface"]);
		}
	});

	test("keeps status colours legible as UI", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const token of ["--success", "--danger", "--warn"]) {
				expect(contrast(tokens[token], tokens["--canvas"]), `${appearance} ${token}`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	test("keeps a label on the accent fill at AA", () => {
		// The primary button's label is the one pairing that must clear 4.5 rather than 3.
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			expect(
				contrast(tokens["--on-accent"], tokens["--accent"]),
				`${appearance} on-accent/accent`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	test("keeps the dim role readable where it carries text", () => {
		// `--dim` is the faintest *text* colour now — a card's id and kind, a lane's count, the footer —
		// so AA's 4.5 is its floor, and it must stay at most 0.94 of muted's ratio on the same plane:
		// two quiet colours a hundredth apart are one colour with two names.
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const surface of ["--canvas", "--surface", "--raised"]) {
				const faint = contrast(tokens["--dim"], tokens[surface]);
				const muted = contrast(tokens["--muted"], tokens[surface]);
				expect(faint, `${appearance} dim/${surface}`).toBeGreaterThanOrEqual(4.5);
				expect(faint / muted, `${appearance} dim/muted on ${surface}`).toBeLessThanOrEqual(0.94);
			}
		}
	});

	test("emits the dark base, the explicit light override, and the system fallback", () => {
		expect(WEB_THEME_CSS).toContain(":root{");
		expect(WEB_THEME_CSS).toContain(':root[data-theme="light"]');
		expect(WEB_THEME_CSS).toContain("prefers-color-scheme:light");
		expect(WEB_THEME_CSS).toContain(`--canvas:${THEMES.dark.vars.canvas}`);
		expect(WEB_THEME_CSS).toContain(`--canvas:${THEMES.light.vars.canvas}`);
		expect(WEB_THEME_CSS).toContain(".tok-keyword{color:var(--tok-keyword)}");
	});

	test("prints the light palette last, so paper never takes the dark one", () => {
		// Print resets the tokens, and being last in the sheet is what makes the reset win.
		const printAt = WEB_THEME_CSS.lastIndexOf("@media print{:root{");
		expect(printAt).toBeGreaterThan(WEB_THEME_CSS.lastIndexOf("@media (prefers-color-scheme:light)"));
		expect(WEB_THEME_CSS.slice(printAt)).toContain(`--canvas:${WEB_THEME_TOKENS.light["--canvas"]}`);
		expect(WEB_THEME_CSS.slice(printAt)).toContain("color-scheme:light");
	});
});
