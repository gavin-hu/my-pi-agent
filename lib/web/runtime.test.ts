import { describe, expect, test } from "bun:test";
import { THEME_JS, THEME_TOGGLE_JS, WEB_THEME_STORAGE_KEY } from "./runtime.ts";

describe("web theme runtime", () => {
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
});
