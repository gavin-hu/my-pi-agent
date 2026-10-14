import { describe, expect, test } from "bun:test";
import { THEME_JS, THEME_TOGGLE_JS, WEB_BASE_CSS, WEB_THEME_CSS, WEB_THEME_STORAGE_KEY } from "./web-theme.ts";

describe("web theme", () => {
	test("keeps one stable storage key shared by both surfaces", () => {
		expect(WEB_THEME_STORAGE_KEY).toBe("pi-web-theme");
		expect(THEME_JS).toContain(WEB_THEME_STORAGE_KEY);
		expect(THEME_TOGGLE_JS).toContain(WEB_THEME_STORAGE_KEY);
	});

	test("applies a saved theme before paint", () => {
		expect(THEME_JS).toContain("data-theme");
		expect(() => new Function(THEME_JS)).not.toThrow();
	});

	test("wires the toggle to the shared element contract", () => {
		expect(THEME_TOGGLE_JS).toContain('getElementById("theme-toggle")');
		expect(THEME_TOGGLE_JS).toContain(".theme-glyph");
		expect(THEME_TOGGLE_JS).toContain("prefers-color-scheme: light");
		expect(THEME_TOGGLE_JS).toContain("data-theme");
		expect(() => new Function(THEME_TOGGLE_JS)).not.toThrow();
	});

	test("defines the dark base, the explicit light override, and the system fallback", () => {
		expect(WEB_THEME_CSS).toContain("--canvas:#0d1117");
		expect(WEB_THEME_CSS).toContain(':root[data-theme="light"]');
		expect(WEB_THEME_CSS).toContain("prefers-color-scheme:light");
	});

	test("carries the shared syntax-token classes", () => {
		for (const token of ["comment", "string", "number", "keyword", "literal", "tag", "attr", "prop", "var"]) {
			expect(WEB_THEME_CSS).toContain(`.tok-${token}{`);
		}
	});

	test("carries the shared base rules", () => {
		expect(WEB_BASE_CSS).toContain(":focus-visible");
		expect(WEB_BASE_CSS).toContain(".skip");
		expect(WEB_BASE_CSS).toContain(".sr-only");
	});
});
