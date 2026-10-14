import { describe, expect, test } from "bun:test";
import { WEB_THEME_CSS, WEB_THEME_TOKENS } from "./tokens.ts";

/** sRGB relative luminance of a `#rgb`/`#rrggbb` colour. */
function luminance(hex: string): number {
	const raw = hex.replace("#", "");
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((c) => c + c)
					.join("")
			: raw;
	const channels = [0, 2, 4].map((offset) => {
		const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours. */
function contrast(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

describe("web tokens", () => {
	test("anchors the palette to the Bytefly theme JSONs", () => {
		expect(WEB_THEME_TOKENS.dark["--canvas"]).toBe("#0d1117");
		expect(WEB_THEME_TOKENS.dark["--accent"]).toBe("#58a6ff");
		expect(WEB_THEME_TOKENS.light["--canvas"]).toBe("#ffffff");
		expect(WEB_THEME_TOKENS.light["--accent"]).toBe("#0969da");
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
			for (const surface of ["--canvas", "--surface"]) {
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

	test("keeps status colours legible as UI", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const token of ["--success", "--danger", "--warn"]) {
				expect(contrast(tokens[token], tokens["--canvas"]), `${appearance} ${token}`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	test("emits the dark base, the explicit light override, and the system fallback", () => {
		expect(WEB_THEME_CSS).toContain(":root{");
		expect(WEB_THEME_CSS).toContain(':root[data-theme="light"]');
		expect(WEB_THEME_CSS).toContain("prefers-color-scheme:light");
		expect(WEB_THEME_CSS).toContain("--canvas:#0d1117");
		expect(WEB_THEME_CSS).toContain("--canvas:#ffffff");
		expect(WEB_THEME_CSS).toContain(".tok-keyword{color:var(--tok-keyword)}");
	});
});
