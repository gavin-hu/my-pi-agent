/**
 * The Settings section of `PanelComponent`: changing, resetting, and reviewing a
 * row, its frame, and the theme row's interaction.
 *
 * The catalogue behind it is `settings.test.ts`; the writer is
 * `settings-runtime.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
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
import { settingViews } from "./settings.ts";
import { type SettingsSurface } from "./settings-runtime.ts";

describe("PanelComponent settings actions", () => {
	test("names the reset and JSON keys, and offers no group key in the hint row", () => {
		const { component } = buildPanel({ items: [], section: "settings" });

		const text = component.render(140).join("\n");
		expect(text).toContain("u reset");
		expect(text).not.toContain("[ ]");

		component.handleInput("?");
		const help = component.render(140).join("\n");
		expect(help).toContain("Move to the next or previous row");
		const json = help.split("\n").find((line) => line.includes("Show the section it lives in")) ?? "";
		expect(
			json
				.slice(json.lastIndexOf("╎") + 1)
				.trimStart()
				.startsWith("J "),
		).toBe(true);
	});

	test("resets the focused row and marks the screen saved", async () => {
		const { component } = buildPanel({
			items: [],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focusPanel(component, "Resume after a job");
		component.handleInput("u");
		await settle();

		const text = component.render(80).join("\n");
		const row = text.split("\n").find((line) => line.includes("Resume after a job"));
		expect(row?.trimEnd().endsWith("Off")).toBe(true);
		expect(text).toContain("unsaved changes");
	});

	test("shows a failed reset in the frame instead of behind it", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews(settingsSnapshot(), scope),
			change: async () => {},
			setValue: async () => false,
			reset: async () => {
				throw new Error("read-only file");
			},
			sectionDocument: () => undefined,
			isDirty: () => false,
		};
		const { component } = buildPanel({ items: [], section: "settings", settings: surface });

		focusPanel(component, "Startup screen");
		component.handleInput("u");
		await settle();

		expect(component.render(80).join("\n")).toContain("read-only file");
	});

	test("shows the focused row's section as stored, and closes it when the section changes", () => {
		const { component } = buildPanel({
			items: [],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focusPanel(component, "Resume after a job");
		component.handleInput("J");

		const text = component.render(120).join("\n");
		expect(text).toContain("── job");
		expect(text).toContain('"wakeOnFinish": true');

		component.handleInput("\t");
		const afterSection = component.render(120).join("\n");
		expect(afterSection).not.toContain('"wakeOnFinish": true');
	});

	test("hides the JSON pane on a row with no section and brings it back for one that has", () => {
		const { component } = buildPanel({
			items: [],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focusPanel(component, "Resume after a job");
		component.handleInput("J");
		expect(component.render(120).join("\n")).toContain('"wakeOnFinish": true');

		component.handleInput("g");
		const appRow = component.render(120).join("\n");
		expect(appRow).toContain("Startup screen");
		expect(appRow).not.toContain('"wakeOnFinish": true');

		focusPanel(component, "Resume after a job");
		expect(component.render(120).join("\n")).toContain('"wakeOnFinish": true');
	});

	test("explains that a Pi setting has no section to show", () => {
		const { component } = buildPanel({ items: [], section: "settings" });

		focusPanel(component, "Startup screen");
		component.handleInput("J");

		const text = component.render(120).join("\n");
		expect(text).toContain("bytefly.json has no section");
		expect(text).toContain("Stored in");
		expect(text).toContain(join("/agent", "settings.json"));
	});

	test("jumps between the Settings groups with the bracket keys", () => {
		const { component } = buildPanel({ items: [], section: "settings" });

		component.render(80);
		expect(selectedLine(component)).toContain("Startup screen");

		component.handleInput("]");
		expect(selectedLine(component)).toContain("Desktop notifications");
		component.handleInput("[");
		expect(selectedLine(component)).toContain("Startup screen");

		component.handleInput("G");
		expect(selectedLine(component)).toContain("Session budget");
	});
});

describe("PanelComponent settings review", () => {
	test("keeps the focused setting across a scope switch", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			globalDoc: { notify: { enabled: true } },
		});

		focusPanel(component, "Desktop notifications");
		component.handleInput("s");
		expect(selectedLine(component)).toContain("Desktop notifications");
		component.handleInput("s");
		expect(selectedLine(component)).toContain("Desktop notifications");
	});

	test("names the global file for an inherited row and calls a default a default", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			rows: 40,
			globalDoc: { job: { wakeOnFinish: true } },
		});

		component.handleInput("s");
		focusPanel(component, "Resume after a job");
		let text = component.render(140).join("\n");
		expect(text).toContain(`Inherited from Global · ${join("/agent", "bytefly.json")}`);

		focusPanel(component, "Snapshot before a turn");
		text = component.render(140).join("\n");
		expect(text).toContain(`Default · ${join("/proj", ".pi", "bytefly.json")}`);
		expect(text).not.toContain("Inherited from Global");
	});

	test("names the scope file in the JSON pane, not the value origin", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		component.handleInput("s");
		focusPanel(component, "Resume after a job");
		component.handleInput("J");

		const text = component.render(140).join("\n");
		expect(text).toContain("Inherited from Global");
		expect(text).toContain("── job");
		expect(text).toContain("Not set in this scope.");
		expect(text).not.toContain('"wakeOnFinish": true');
	});

	test("counts the settings it shows in the range row", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", rows: 12 });

		const global = component.render(80).join("\n");
		expect(global).toContain("showing");
		expect(global).toContain("of 15");

		component.handleInput("s");
		expect(component.render(80).join("\n")).toContain("of 13");
	});

	test("ignores a click below the last body row", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], section: "settings", rows: 12 });

		const lines = component.render(80);
		const rangeY = lines.findIndex((line) => line.includes("showing"));
		const hintY = lines.findIndex((line) => line.includes("Esc close"));
		const before = selectedLine(component);

		for (const y of [rangeY, hintY]) {
			expect(component.handleMouse({ type: "click", button: "left", x: 10, y } as any)).toBeUndefined();
		}
		expect(selectedLine(component)).toBe(before);
	});

	test("keeps the saved marker while the JSON pane is open", () => {
		const base = fakeSettingsSurface({ global: { notify: { enabled: true } } });
		const surface: SettingsSurface = { ...base.surface, isDirty: () => true };
		const { component } = buildPanel({ items: [], section: "settings", settings: surface });

		focusPanel(component, "Desktop notifications");
		component.handleInput("J");

		expect(component.render(120).join("\n")).toContain("Saved · reload to apply");
	});

	test("counts the JSON lines it hides", () => {
		const doctor = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`key${index}`, `value ${index}`]));
		const { component } = buildPanel({ items: [], section: "settings", rows: 16, globalDoc: { doctor } });

		focusPanel(component, "Health check at startup");
		component.handleInput("J");

		expect(component.render(120).join("\n")).toContain("… 10 more lines");
	});

	test("does not claim a hidden JSON pane on an app row", () => {
		const { component } = buildPanel({ items: [], section: "settings", globalDoc: { notify: { enabled: true } } });

		focusPanel(component, "Desktop notifications");
		component.handleInput("J");
		component.handleInput("g");

		const text = component.render(120).join("\n");
		expect(text).toContain("Startup screen");
		expect(text).toContain("u reset");
		expect(text).not.toContain('"enabled": true');
	});

	test("keeps the label and the caret while editing a long value on a narrow terminal", () => {
		const { component } = buildPanel({ items: [], section: "settings", globalDoc: { price: { budget: 0 } } });

		focusPanel(component, "Session budget");
		component.handleInput(" ");
		component.handleInput("1234567890");

		const line = component.render(30).find((candidate) => candidate.startsWith("❯")) ?? "";
		expect(line).toContain("Session");
		expect(line).toContain("▏");
		expect(line).toContain("…");
	});

	test("fits an eight-row terminal in both scopes and while dirty", () => {
		for (const project of [false, true]) {
			const { component } = buildPanel({ items: [], section: "settings", rows: 8 });
			if (project) {
				component.render(80);
				component.handleInput("s");
			}
			expect(component.render(80).length).toBeLessThanOrEqual(8);
		}

		const base = fakeSettingsSurface({ global: { notify: { enabled: true } } });
		const surface: SettingsSurface = { ...base.surface, isDirty: () => true };
		const dirty = buildPanel({ items: [], section: "settings", rows: 8, settings: surface }).component;
		const lines = dirty.render(80);
		expect(lines.length).toBeLessThanOrEqual(8);
		expect(lines.join("\n")).toContain("unsaved changes");

		focusPanel(dirty, "Desktop notifications");
		dirty.handleInput("J");
		const withJson = dirty.render(80);
		expect(withJson.length).toBeLessThanOrEqual(8);
		expect(withJson.join("\n")).toContain("unsaved changes");
	});
});

describe("PanelComponent settings frame", () => {
	test("shows every curated setting and nothing that left the catalogue", () => {
		// Tall enough for the whole catalogue: at 96 columns the list scrolls a shorter terminal.
		const { component } = buildPanel({ items: [], section: "settings", rows: 40 });
		const text = component.render(96).join("\n");

		for (const gone of ["Notification title", "Probe timeout", "Rail glyph", "Base ref", "Snapshots kept"]) {
			expect(text, gone).not.toContain(gone);
		}
		expect(text).toContain("Session budget");
	});

	test("scrolls the list on a 24-row terminal, saying how much it shows", () => {
		// Fifteen rows and five headings are taller than a 24-row terminal, which is the trade the
		// catalogue's cap states: the screen keeps its frame and scrolls the list.
		const { component } = buildPanel({ items: [], section: "settings", rows: 24 });
		const lines = component.render(96);

		expect(lines).toHaveLength(24);
		expect(lines.join("\n")).toContain("showing 1–13 of 15");
	});

	test("fits the whole catalogue on a terminal tall enough for it", () => {
		const { component } = buildPanel({ items: [], section: "settings", rows: 40 });
		const lines = component.render(96);

		expect(lines).toHaveLength(26);
		expect(lines.join("\n")).not.toContain("showing");
		expect(lines.join("\n")).toContain("Session budget");
	});

	test("keeps a value beside its label on a wide terminal", () => {
		const { component } = buildPanel({ items: [], section: "settings" });
		const line = component.render(120).find((candidate) => candidate.includes("When a turn ends")) ?? "";

		const labelAt = line.indexOf("When a turn ends");
		const valueAt = line.indexOf("On");
		expect(labelAt).toBeGreaterThanOrEqual(0);
		expect(valueAt).toBeGreaterThan(labelAt);
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	test("spends three rows on the focused row's block below the pane breakpoint", () => {
		const { component } = buildPanel({ items: [], section: "settings", rows: 24 });
		const lines = component.render(80);
		const head = lines.findIndex((line) => line.includes("About"));

		expect(head).toBeGreaterThan(0);
		// The row above already carries the name and the value, so the block below
		// the list is the sentence's two lines and where the value is written.
		expect(lines[head + 2]).toContain("Stored in");
		expect(lines[head + 3] ?? "").toBe("");
	});
});

describe("PanelComponent theme setting", () => {
	test("renders the Theme row and cycles the resolved names", async () => {
		const { component } = buildPanel({
			items: [],
			section: "settings",
			themes: ["system", "bytefly-dark", "bytefly-light"],
			app: { theme: "system" } as Settings,
		});

		focusPanel(component, "Theme");
		expect(component.render(80).join("\n")).toContain("Theme");

		component.handleInput(" ");
		await settle();
		await settle();

		const after = component.render(80).join("\n");
		expect(after).toContain("bytefly-dark");
		expect(after).toContain("unsaved changes");
	});

	test("omits the Theme row in Project scope", () => {
		const { component } = buildPanel({ items: [], section: "settings", themes: ["system", "bytefly-dark"] });

		component.render(80);
		component.handleInput("s");

		expect(component.render(80).join("\n")).not.toContain("Theme");
	});
});
