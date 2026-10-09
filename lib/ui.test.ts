import { describe, expect, test } from "bun:test";
import {
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { fakeTheme } from "../test/helpers/fakes.ts";
import { EXPAND_KEYBINDING, GLYPHS, SEPARATORS, STATUS_KEYS, expandHint, expandKey } from "./ui.ts";

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

describe("expandKey / expandHint", () => {
	test("degrades when the keybinding is unknown", () => {
		const previous = getKeybindings();
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
		try {
			expect(expandKey(fakeTheme)).toBe("");
			expect(expandHint(fakeTheme)).toBe("(to expand)");
		} finally {
			setKeybindings(previous);
		}
	});

	test("renders the bound key", () => {
		const previous = getKeybindings();
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				[EXPAND_KEYBINDING]: { defaultKeys: "ctrl+o", description: "Toggle tool output" },
			}),
		);
		try {
			expect(expandKey(fakeTheme)).toBe("ctrl+o");
			expect(expandHint(fakeTheme)).toBe("(ctrl+o to expand)");
		} finally {
			setKeybindings(previous);
		}
	});
});
