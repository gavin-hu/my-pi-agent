import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
	name: string;
	appearance: string;
	vars: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: Record<string, string | number>;
}

const THEMES = [
	{ file: "nocturne-dark.json", name: "nocturne-dark", appearance: "dark" },
	{ file: "nocturne-light.json", name: "nocturne-light", appearance: "light" },
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

for (const expected of THEMES) {
	const themePath = fileURLToPath(new URL(`../../themes/${expected.file}`, import.meta.url));
	const theme = JSON.parse(readFileSync(themePath, "utf8")) as Theme;

	describe(`theme ${expected.name}`, () => {
		test("declares the expected identity", () => {
			expect(theme.name).toBe(expected.name);
			expect(theme.appearance).toBe(expected.appearance);
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
	});
}
