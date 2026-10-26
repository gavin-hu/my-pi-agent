/**
 * The key table: the binding, the hint it contributes, and the help line it owes.
 *
 * The point of the table is that these cannot drift — a key with no help line, a
 * help line for a key the section does not offer, or a hint naming a binding that
 * does not exist all fail here.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import type { PanelSection } from "./types.ts";
import { helpKeyIds, helpRows, hintsFor, keyFor, PANEL_KEYS } from "./tui/keys.ts";

const SECTIONS: readonly PanelSection[] = ["extensions", "skills", "settings"];

describe("the key table", () => {
	test("binds each action once", () => {
		const ids = PANEL_KEYS.map((key) => key.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	test("documents every binding a section offers, and nothing it does not", () => {
		for (const section of SECTIONS) {
			const offered = PANEL_KEYS.filter((key) => key.sections.includes(section)).map((key) => key.id);
			const documented = helpKeyIds(section);

			expect({ section, missing: offered.filter((id) => !documented.includes(id)) }).toEqual({ section, missing: [] });
			expect({ section, extra: documented.filter((id) => !offered.includes(id)) }).toEqual({ section, extra: [] });
		}
	});

	test("prints each binding's own label in the help block", () => {
		for (const section of SECTIONS) {
			const text = helpRows(fakeTheme, 120, section).join("\n");
			for (const key of PANEL_KEYS) {
				if (!key.sections.includes(section)) continue;
				expect({ section, key: key.label, shown: text.includes(key.label) }).toEqual({
					section,
					key: key.label,
					shown: true,
				});
			}
		}
	});

	test("fits the width it is given", () => {
		for (const width of [40, 60, 120]) {
			for (const section of SECTIONS) {
				for (const line of helpRows(fakeTheme, width, section)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("reading a key", () => {
	test("reads the shared keys in every section", () => {
		for (const section of SECTIONS) {
			expect(keyFor("\u001b", section)).toBe("close");
			expect(keyFor("s", section)).toBe("scope");
			expect(keyFor("/", section)).toBe("filter");
			expect(keyFor("?", section)).toBe("help");
			expect(keyFor("R", section)).toBe("reload");
			expect(keyFor("!", section)).toBe("attention");
		}
	});

	test("switches sections with the arrows and the tab, both ways", () => {
		for (const section of SECTIONS) {
			expect(keyFor("\u001b[C", section)).toBe("nextSection");
			expect(keyFor("l", section)).toBe("nextSection");
			expect(keyFor("\t", section)).toBe("nextSection");
			expect(keyFor("\u001b[D", section)).toBe("previousSection");
			expect(keyFor("h", section)).toBe("previousSection");
			expect(keyFor("\u001b[Z", section)).toBe("previousSection");
		}
	});

	test("offers a section's own keys only there", () => {
		expect(keyFor("r", "extensions")).toBe("refresh");
		expect(keyFor("r", "settings")).toBeUndefined();
		expect(keyFor("r", "skills")).toBeUndefined();
		expect(keyFor("u", "settings")).toBe("reset");
		expect(keyFor("J", "settings")).toBe("json");
		expect(keyFor("u", "extensions")).toBeUndefined();
		expect(keyFor("J", "extensions")).toBeUndefined();
		expect(keyFor("x", "extensions")).toBe("inherit");
		expect(keyFor("x", "settings")).toBeUndefined();
	});

	test("keeps activation off the scope key's letter", () => {
		expect(keyFor(" ", "extensions")).toBe("toggle");
		expect(keyFor("\r", "extensions")).toBe("detail");
		expect(keyFor(" ", "settings")).toBe("change");
		expect(keyFor("\r", "settings")).toBe("change");
		// A letter that is not bound is left to navigation.
		expect(keyFor("z", "extensions")).toBeUndefined();
	});
});

describe("the hint row", () => {
	const idle = { expanded: false, refreshing: false, projectScope: false, dirty: false, help: false };
	const text = (section: PanelSection, state: Partial<typeof idle> = {}): string =>
		hintsFor(section, { ...idle, ...state })
			.map((hint) => (typeof hint === "string" ? hint : hint.text))
			.join(" · ");

	test("leads with the keys a reader needs first", () => {
		expect(text("extensions").startsWith("Esc close · ←/→ section · Space toggle · Enter detail · / filter")).toBe(
			true,
		);
		expect(text("settings")).toContain("Space change");
		expect(text("settings")).toContain("u reset");
	});

	test("names both states the toggle key can be in", () => {
		expect(text("extensions", { expanded: true })).toContain("Enter collapse");
		expect(text("extensions")).toContain("Enter detail");
		expect(text("extensions", { help: true })).toContain("? hide");
		expect(text("extensions")).toContain("? keys");
	});

	test("offers a binding only when it would do something", () => {
		expect(text("extensions")).not.toContain("x inherit");
		expect(text("extensions", { projectScope: true })).toContain("x inherit");
		expect(text("extensions")).not.toContain("R reload");
		expect(text("extensions", { dirty: true })).toContain("R reload");
		expect(text("extensions")).toContain("r refresh");
		expect(text("extensions", { refreshing: true })).toContain("refreshing…");
		expect(text("skills")).not.toContain("r refresh");
	});
});
