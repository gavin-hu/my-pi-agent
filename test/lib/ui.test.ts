import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS, SEPARATORS, STATUS_KEYS } from "../../lib/ui.ts";

describe("GLYPHS", () => {
	test("every glyph is exactly one visible column", () => {
		for (const [name, glyph] of Object.entries(GLYPHS)) {
			expect(visibleWidth(glyph), name).toBe(1);
		}
	});

	test("glyphs are distinct, so chips stay distinguishable", () => {
		const values = Object.values(GLYPHS);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("SEPARATORS", () => {
	test("item and group separators are padded and distinct", () => {
		expect(SEPARATORS.item).toBe(" · ");
		expect(SEPARATORS.group).toBe(" │ ");
		expect(visibleWidth(SEPARATORS.item)).toBe(3);
		expect(visibleWidth(SEPARATORS.group)).toBe(3);
	});
});

describe("STATUS_KEYS", () => {
	test("keys are non-empty, untrimmed-safe, and unique", () => {
		const values = Object.values(STATUS_KEYS);
		for (const key of values) {
			expect(key.length).toBeGreaterThan(0);
			expect(key.trim()).toBe(key);
		}
		expect(new Set(values).size).toBe(values.length);
	});
});
