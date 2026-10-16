import { describe, expect, test } from "bun:test";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { paint, TUI_TOKENS, token, type TuiRole } from "./tokens.ts";

const ROLES = Object.keys(TUI_TOKENS) as TuiRole[];

describe("TUI_TOKENS", () => {
	test("every role resolves to a theme color", () => {
		for (const role of ROLES) {
			expect(typeof TUI_TOKENS[role]).toBe("string");
			expect(token(role)).toBe(TUI_TOKENS[role]);
		}
	});

	test("paint routes each role through the theme's own color", () => {
		const painted = ROLES.map((role) => paint(coloringTheme, role, "x"));
		expect(painted).toEqual(ROLES.map((role) => `[${TUI_TOKENS[role]}]x`));
	});

	test("paint returns the themed text unchanged by the identity theme", () => {
		expect(paint(fakeTheme, "title", "Extensions")).toBe("Extensions");
	});

	test("status roles map to the semantic status colors", () => {
		expect(TUI_TOKENS.ok).toBe("success");
		expect(TUI_TOKENS.warn).toBe("warning");
		expect(TUI_TOKENS.bad).toBe("error");
	});

	test("structure roles map to the divider colors", () => {
		expect(TUI_TOKENS.rule).toBe("borderMuted");
		expect(TUI_TOKENS.ruleStrong).toBe("border");
	});
});
