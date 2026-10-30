import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TUI_TOKENS, type TuiRole } from "../lib/tui/tokens.ts";

// Pi's complete theme token set (theme-schema.json). Required tokens must be
// present; optional tokens may be omitted but these themes define them all so
// every UI surface is palette-controlled.
const REQUIRED_COLORS = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"selectedBg",
	"userMessageBg",
	"userMessageText",
	"customMessageBg",
	"customMessageText",
	"customMessageLabel",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
] as const;

const OPTIONAL_COLORS = [
	"scrollbarTrack",
	"scrollbarThumb",
	"searchMatchBg",
	"searchMatchText",
	"thinkingMax",
] as const;
const ALL_COLORS = new Set<string>([...REQUIRED_COLORS, ...OPTIONAL_COLORS]);

interface Theme {
	$schema?: string;
	name: string;
	appearance: string;
	vars: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: Record<string, string | number>;
}

/** The variable that names the terminal canvas, which no color token stands for. */
const CANVAS = "canvas";

const TOOL_PANELS = ["toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const;

/**
 * Every role this package and Pi paint onto another color, with the WCAG 2
 * ratio it must reach there. Text is 4.5, a subtle or decorative mark is 3,
 * and a scrollbar thumb only has to be distinguishable from its track.
 * `userMessageBg` is the terminal default, so it is skipped wherever it is a surface.
 */
const CONTRAST_RULES: ReadonlyArray<readonly [token: string, surfaces: readonly string[], minimum: number]> = [
	["text", [CANVAS, "selectedBg", ...TOOL_PANELS], 4.5],
	["muted", [CANVAS, "selectedBg", "customMessageBg", ...TOOL_PANELS], 4.5],
	["dim", [CANVAS, "selectedBg", ...TOOL_PANELS], 3],
	["toolTitle", TOOL_PANELS, 4.5],
	["toolOutput", [CANVAS, ...TOOL_PANELS], 4.5],
	["accent", [CANVAS, "selectedBg"], 4.5],
	["success", [CANVAS], 4.5],
	["error", [CANVAS], 4.5],
	["warning", [CANVAS], 4.5],
	["toolDiffAdded", TOOL_PANELS, 4.5],
	["toolDiffRemoved", TOOL_PANELS, 4.5],
	["toolDiffContext", TOOL_PANELS, 4.5],
	["syntaxComment", [CANVAS], 4.5],
	["syntaxKeyword", [CANVAS], 4.5],
	["syntaxFunction", [CANVAS], 4.5],
	["syntaxString", [CANVAS], 4.5],
	["syntaxNumber", [CANVAS], 4.5],
	["syntaxType", [CANVAS], 4.5],
	["mdHeading", [CANVAS], 4.5],
	["mdLink", [CANVAS], 4.5],
	["mdCode", [CANVAS], 4.5],
	["mdCodeBlock", [CANVAS], 4.5],
	["mdCodeBlockBorder", [CANVAS], 4.5],
	["mdQuote", [CANVAS], 4.5],
	["mdListBullet", [CANVAS], 4.5],
	["searchMatchText", ["searchMatchBg"], 4.5],
	["border", [CANVAS, "customMessageBg"], 3],
	["borderMuted", [CANVAS], 3],
	["scrollbarThumb", ["scrollbarTrack"], 2],
];

/**
 * The semantic roles a component paints with, split by what the WCAG floor means
 * for each. A text role is read, so it needs AA's 4.5; a rule is a one-column
 * non-text mark, so it needs the 3.0 that WCAG sets for graphics.
 */
const TEXT_ROLES: readonly TuiRole[] = [
	"accent",
	"title",
	"label",
	"meta",
	"faint",
	"ok",
	"warn",
	"bad",
	"info",
	"hue1",
	"hue2",
	"hue3",
	"hue4",
	"hue5",
];
const HUE_ROLES: readonly TuiRole[] = ["hue1", "hue2", "hue3", "hue4", "hue5"];
const LINE_ROLES: readonly TuiRole[] = ["rule", "ruleStrong"];
const TEXT_MINIMUM = 4.5;
const LINE_MINIMUM = 3;

/**
 * The roles a selected list row paints on `selectedBg`: `rows.ts` draws the label
 * in `accent` and the trailing text in `meta` once a row is focused.
 */
const SELECTED_ROW_ROLES: readonly TuiRole[] = ["accent", "meta"];

const THEMES = [
	{ file: "bytefly-dark.json", name: "bytefly-dark", appearance: "dark" },
	{ file: "bytefly-light.json", name: "bytefly-light", appearance: "light" },
] as const;

const isHex = (value: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);

/** Resolve a color value to its terminal-usable form, following var refs. */
function resolve(theme: Theme, value: string | number, seen: readonly string[] = []): string | number {
	if (typeof value === "number") return value;
	if (value === "" || isHex(value)) return value;
	if (/^oklch\(/i.test(value) || /^okhsl\(/i.test(value)) return value;
	if (!(value in theme.vars)) throw new Error(`unknown color value or var: ${value}`);
	if (seen.includes(value)) throw new Error(`circular var reference: ${[...seen, value].join(" -> ")}`);
	return resolve(theme, theme.vars[value], [...seen, value]);
}

/** A color token's color as six-digit hex, or undefined for the terminal default. */
function hexOf(theme: Theme, value: string | number | undefined): string | undefined {
	if (value === undefined) return undefined;
	const resolved = resolve(theme, value);
	if (resolved === "") return undefined;
	if (typeof resolved !== "string")
		throw new Error(`theme uses 256-color index ${resolved}, which has no fixed luminance`);
	if (resolved.length !== 4) return resolved;
	return `#${[...resolved.slice(1)].map((digit) => digit.repeat(2)).join("")}`;
}

/** The hex a role is painted on: the canvas variable, or the color of the named token. */
function surfaceOf(theme: Theme, name: string): string | undefined {
	return hexOf(theme, name === CANVAS ? theme.vars[CANVAS] : theme.colors[name]);
}

/** WCAG 2 relative luminance of a hex color. */
function relativeLuminance(hex: string): number {
	const [red, green, blue] = [1, 3, 5]
		.map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
		.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2 contrast ratio, 1-21. */
function contrastRatio(one: string, other: string): number {
	const lighter = Math.max(relativeLuminance(one), relativeLuminance(other));
	const darker = Math.min(relativeLuminance(one), relativeLuminance(other));
	return (lighter + 0.05) / (darker + 0.05);
}

for (const expected of THEMES) {
	const themePath = fileURLToPath(new URL(`../themes/${expected.file}`, import.meta.url));
	const theme = JSON.parse(readFileSync(themePath, "utf8")) as Theme;

	describe(`theme ${expected.name}`, () => {
		test("declares the expected identity", () => {
			expect(theme.name).toBe(expected.name);
			expect(theme.appearance).toBe(expected.appearance);
			// Pi only hot-reloads <agent-dir>/themes/<name>.json, so the two must agree.
			expect(theme.name).toBe(expected.file.replace(/\.json$/, ""));
		});

		test("points $schema at Pi's published theme schema", () => {
			expect(theme.$schema).toBe("https://pi.dev/schemas/theme.schema.json");
		});

		test("declares the appearance its canvas is designed for", () => {
			const canvas = hexOf(theme, theme.vars[CANVAS]);
			expect(canvas, `vars.${CANVAS}`).toBeDefined();
			const designed = relativeLuminance(canvas as string) < 0.5 ? "dark" : "light";
			expect(designed).toBe(theme.appearance);
		});

		test("defines every required token and no unknown tokens", () => {
			const keys = Object.keys(theme.colors);
			for (const token of REQUIRED_COLORS) {
				expect(keys).toContain(token);
			}
			// schema sets additionalProperties: false
			for (const key of keys) {
				expect(ALL_COLORS.has(key)).toBe(true);
			}
		});

		test("covers all optional tokens too", () => {
			for (const token of OPTIONAL_COLORS) {
				expect(theme.colors[token]).toBeDefined();
			}
		});

		test("colours the tool name with the accent", () => {
			// The tool block spends its one recurring colour on the tool name.
			expect(theme.colors.toolTitle).toBe(theme.colors.accent);
		});

		test("every color and var resolves", () => {
			for (const [token, value] of Object.entries(theme.colors)) {
				expect(() => resolve(theme, value), `colors.${token}`).not.toThrow();
			}
			for (const [name, value] of Object.entries(theme.vars)) {
				expect(() => resolve(theme, value), `vars.${name}`).not.toThrow();
			}
		});

		test("vars are concrete hex colors", () => {
			for (const [name, value] of Object.entries(theme.vars)) {
				expect(typeof value, `vars.${name}`).toBe("string");
				expect(isHex(value as string), `vars.${name}=${value}`).toBe(true);
			}
		});

		test("export colors resolve", () => {
			for (const [key, value] of Object.entries(theme.export ?? {})) {
				expect(() => resolve(theme, value), `export.${key}`).not.toThrow();
			}
		});

		test("every variable is used", () => {
			const referenced = new Set(
				[...Object.values(theme.colors), ...Object.values(theme.export ?? {}), ...Object.values(theme.vars)].map(
					String,
				),
			);
			expect(Object.keys(theme.vars).filter((name) => !referenced.has(name))).toEqual([]);
		});

		test("every semantic role has a token this theme defines", () => {
			for (const role of Object.keys(TUI_TOKENS) as TuiRole[]) {
				expect(theme.colors[TUI_TOKENS[role]], `role ${role}`).toBeDefined();
			}
		});

		test("keeps every semantic role above its WCAG floor on the canvas", () => {
			const canvas = hexOf(theme, theme.vars[CANVAS]) as string;
			for (const role of TEXT_ROLES) {
				expect(
					contrastRatio(hexOf(theme, theme.colors[TUI_TOKENS[role]]) as string, canvas),
					`role ${role} (${TUI_TOKENS[role]}) on canvas`,
				).toBeGreaterThanOrEqual(TEXT_MINIMUM);
			}
			for (const role of LINE_ROLES) {
				expect(
					contrastRatio(hexOf(theme, theme.colors[TUI_TOKENS[role]]) as string, canvas),
					`role ${role} (${TUI_TOKENS[role]}) on canvas`,
				).toBeGreaterThanOrEqual(LINE_MINIMUM);
			}
		});

		test("keeps the categorical hues distinct from one another", () => {
			// A screen separates its categories by hue alone once the labels are scanned
			// past, so a palette that collapses two of them has to fail here rather than
			// in a picture nobody re-reads.
			const drawn = HUE_ROLES.map((role) => hexOf(theme, theme.colors[TUI_TOKENS[role]]));
			expect(drawn.every((hex) => hex !== undefined)).toBe(true);
			expect(new Set(drawn).size).toBe(HUE_ROLES.length);
		});

		test("keeps the selected row readable", () => {
			const selected = surfaceOf(theme, "selectedBg");
			// A theme that leaves the selection to the terminal has nothing to measure.
			if (selected === undefined) return;
			for (const role of SELECTED_ROW_ROLES) {
				expect(
					contrastRatio(hexOf(theme, theme.colors[TUI_TOKENS[role]]) as string, selected),
					`role ${role} on selectedBg`,
				).toBeGreaterThanOrEqual(TEXT_MINIMUM);
			}
		});

		test("keeps every role readable on the surfaces it is painted on", () => {
			for (const [token, surfaces, minimum] of CONTRAST_RULES) {
				const foreground = hexOf(theme, theme.colors[token]);
				expect(foreground, `colors.${token}`).toBeDefined();
				for (const surface of surfaces) {
					const background = surfaceOf(theme, surface);
					// The terminal default background has no fixed color to measure against.
					if (background === undefined) continue;
					expect(
						contrastRatio(foreground as string, background),
						`colors.${token} on ${surface}`,
					).toBeGreaterThanOrEqual(minimum);
				}
			}
		});
	});
}

/**
 * The metric itself, against the two ratios anyone can look up: black on white is
 * the maximum, and `#767676` on white is the usual "just over AA" boundary. A
 * broken luminance formula would otherwise pass every theme quietly.
 */
describe("contrast metric", () => {
	test("spans 1 to 21 and lands on the AA boundary", () => {
		expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
		expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
	});

	test("is symmetric, so the argument order never matters", () => {
		expect(contrastRatio("#0d1117", "#c9d1d9")).toBeCloseTo(contrastRatio("#c9d1d9", "#0d1117"), 5);
	});
});

/** One role mapping, two palettes: the pair must not drift apart. */
describe("theme pair", () => {
	const load = (file: string): Theme =>
		JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${file}`, import.meta.url)), "utf8")) as Theme;
	const dark = load("bytefly-dark.json");
	const light = load("bytefly-light.json");

	test("the two files share one role mapping", () => {
		expect(light.colors).toEqual(dark.colors);
	});

	test("the two files declare the same variables", () => {
		expect(Object.keys(light.vars).sort()).toEqual(Object.keys(dark.vars).sort());
	});
});
