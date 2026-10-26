/**
 * `PanelComponent`'s section switching: which section a key or a click selects,
 * what the bar and the detail row show for it, and what a short terminal keeps.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ROLE_SGR, roleSgrTheme } from "../../../test/helpers/fakes.ts";
import {
	buildPanel,
	enabledItem,
	fakeSettingsSurface,
	focusPanel,
	selectedLine,
	settingsSnapshot,
} from "../../../test/helpers/fixtures/bytefly.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { Settings } from "../picker/types.ts";
import { type SettingsSurface } from "./settings-runtime.ts";
import { settingViews } from "./settings.ts";

describe("PanelComponent sections", () => {
	test("draws every section name and accents the active one", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], reports: [], theme: roleSgrTheme });

		const text = component.render(90).join("\n");
		expect(text).toContain(`${ROLE_SGR.accent}Extensions`);
		expect(text).toContain(`${ROLE_SGR.other}Skills`);
		expect(text).toContain(`${ROLE_SGR.other}Settings`);
	});

	test("opens on the Settings section when the command asks for it", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [],
			section: "settings",
			theme: roleSgrTheme,
		});

		const text = component.render(80).join("\n");
		expect(text).toContain(`${ROLE_SGR.other}Extensions`);
		expect(text).toContain(`${ROLE_SGR.other}Skills`);
		expect(text).toContain(`${ROLE_SGR.accent}Settings`);
		expect(text).toContain("12 settings");
		expect(text).toContain("Bytefly startup TUI");
		expect(text).toContain("Desktop notifications");
		expect(text).toContain("Watcher matched");
		expect(text).not.toContain("plan/index.ts");
	});

	test("switches sections with the arrow keys and keeps the extension focus", () => {
		const { component } = buildPanel({ items: [enabledItem("alpha"), enabledItem("beta")], reports: [] });

		component.render(80);
		component.handleInput("j");
		expect(selectedLine(component)).toContain("beta/index.ts");

		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Global · 0 skills");

		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Global · 12 settings");

		component.handleInput("\u001b[D");
		expect(component.render(80).join("\n")).toContain("Global · 0 skills");

		component.handleInput("\u001b[D");
		expect(selectedLine(component)).toContain("beta/index.ts");
	});

	test("stops at the ends instead of wrapping", () => {
		const { component } = buildPanel({ items: [enabledItem("alpha")], reports: [] });

		component.handleInput("\u001b[D");
		expect(component.render(80).join("\n")).toContain("1 extension");

		component.handleInput("\u001b[C");
		component.handleInput("\u001b[C");
		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Global · 12 settings");
	});

	test("keeps the scope switch working in Settings", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings" });

		component.handleInput("\t");

		const text = component.render(80).join("\n");
		expect(text).toContain("Project · 10 settings");
		expect(text).toContain("App settings are Global only.");
		expect(text).not.toContain("Bytefly startup TUI");
	});

	test("keeps the focus near the dropped row when a scope switch removes it", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings" });

		component.render(80);
		focusPanel(component, "Theme");

		component.handleInput("\t");
		expect(component.render(80).join("\n")).toContain("Project · 10 settings");
		expect(selectedLine(component)).toContain("Turn finished");
	});

	test("refuses the project scope in Settings when the project is untrusted", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", trusted: false });

		component.handleInput("\t");

		const refused = component.render(80).join("\n");
		expect(refused).toContain("Project is not trusted");
		expect(refused).toContain("Global · 12 settings");
		expect(refused).not.toContain("Esc close");

		component.handleInput("j");
		const restored = component.render(80).join("\n");
		expect(restored).not.toContain("Project is not trusted");
		expect(restored).toContain("Esc close");
	});

	test("shows a refused setting change in the frame", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews(settingsSnapshot(), scope),
			change: async () => {
				throw new Error("disk full");
			},
			setValue: async () => {
				throw new Error("disk full");
			},
			reset: async () => {
				throw new Error("disk full");
			},
			sectionDocument: () => undefined,
			isDirty: () => false,
		};
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", settings: surface });

		component.handleInput(" ");
		await settle();
		await settle();

		const text = component.render(80).join("\n");
		expect(text).toContain("disk full");
		expect(text).not.toContain("Esc close");
	});

	test("clips a long notice to the width like the hint it replaces", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")] });

		component.notify(`refused: ${"a path ".repeat(30)}`);
		for (const width of [30, 60, 90]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps the reload marker when a short terminal collapses the body", async () => {
		const settings = fakeSettingsSurface();
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			rows: 12,
			settings: settings.surface,
		});

		component.handleInput(" ");
		await settle();
		await settle();

		const lines = component.render(80);
		expect(lines.join("\n")).toContain("Saved · reload to apply");
		expect(lines.length).toBeLessThanOrEqual(12);
	});

	test("changes the focused setting with Space and marks the screen dirty", async () => {
		const settings = fakeSettingsSurface();
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", settings: settings.surface });

		component.handleInput(" ");
		await settle();
		await settle();

		expect(settings.changes).toEqual(["global:byteflyUi"]);
		expect(settings.isDirty()).toBe(true);
		const text = component.render(80).join("\n");
		expect(text).toContain("On");
		expect(text).toContain("Saved · reload to apply");
	});

	test("changes the focused setting with Enter too", async () => {
		const settings = fakeSettingsSurface();
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", settings: settings.surface });

		focusPanel(component, "Desktop notifications");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(settings.changes).toEqual(["global:notify.enabled"]);
		expect(component.render(80).join("\n")).toContain("On");
	});

	test("hints the section switch, the scope key, and the change key", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings" });

		const text = component.render(96).join("\n");
		expect(text).toContain("←/→");
		expect(text).toContain("Space change");
		expect(text).toContain("Tab scope");
	});

	test("names the source and target file in the detail pane", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			app: { quietStartup: true } as Settings,
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("Bytefly startup TUI — Pi setting");
		expect(text).toContain(`Global · ${join("/agent", "settings.json")}`);
	});
});
