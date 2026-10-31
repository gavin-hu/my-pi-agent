/**
 * `PanelComponent`'s keys: the focused row's own action — a toggle, a cycle, a
 * scope or section switch — the click that focuses a row, and the keys that do
 * nothing while a filter or a refusal is in the way.
 */

import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { coloringTheme } from "../../../test/helpers/fakes.ts";
import { buildPanel, enabledItem, selectedLine } from "../../../test/helpers/fixtures/panel.ts";
import { fakeSettingsSurface } from "../../../test/helpers/fixtures/settings.ts";
import { makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem } from "../../../test/helpers/fixtures/picker.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { ResourceItem } from "../picker/types.ts";
import { PanelComponent } from "./tui.ts";

describe("PanelComponent input", () => {
	test("navigation skips group headers", async () => {
		const { component, store } = buildPanel({
			items: [enabledItem("plan"), makeItem({ path: "/agent/extensions/auto.ts" })],
			reports: [],
		});

		component.handleInput("j");
		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths.at(-1)).toEqual(["-extensions/auto.ts"]);
	});

	test("space toggles the focused item and marks the screen dirty", async () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], reports: [makeReport("plan")] });

		expect(component.render(60).join("\n")).not.toContain("Saved");
		component.handleInput(" ");
		await settle();
		await settle();

		expect(component.render(60).join("\n")).toContain("Saved · reload to apply");
	});

	test("space explains a report with no item instead of doing nothing", async () => {
		const { component, store } = buildPanel({ items: [], reports: [makeReport("bytefly")] });

		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths).toHaveLength(0);
		const text = component.render(80).join("\n");
		expect(text).toContain("bytefly is not resolved; manage it with pi config.");
		expect(text).not.toContain("Esc close");
	});

	test("s warns instead of switching when the project is untrusted", () => {
		const { component, runtime } = buildPanel({ items: [enabledItem("plan")], reports: [], trusted: false });

		component.handleInput("s");

		expect(runtime.scope()).toBe("global");
		expect(component.render(80).join("\n")).toContain("not trusted");
	});

	test("s switches to project scope when trusted", () => {
		const { component, runtime } = buildPanel({ items: [enabledItem("plan")], reports: [] });

		component.handleInput("s");

		expect(runtime.scope()).toBe("project");
	});

	test("x clears the project override the toggle wrote", async () => {
		const item = makeItem({ path: "/agent/extensions/auto.ts" });
		const { component, projectStore } = buildPanel({ items: [item], reports: [] });

		component.handleInput("s");
		component.handleInput(" ");
		await settle();
		await settle();
		expect(projectStore.calls.setProjectExtensionPaths.at(-1)).toEqual([
			"/agent/extensions/auto.ts",
			"-/agent/extensions/auto.ts",
		]);

		component.handleInput("x");
		await settle();
		await settle();

		expect(projectStore.calls.setProjectExtensionPaths.at(-1)).toEqual([]);
		const row = component
			.render(80)
			.find((line) => line.includes("auto.ts") && (line.includes("◼") || line.includes("◻")));
		expect(row).toContain(GLYPHS.boxOn);
		expect(component.render(80).join("\n")).toContain("Saved · reload to apply");
	});

	test("x explains a row with no project override and writes nothing", async () => {
		const { component, projectStore } = buildPanel({ items: [enabledItem("plan")], reports: [] });

		component.handleInput("s");
		component.handleInput("x");
		await settle();
		await settle();

		expect(projectStore.calls.setProjectExtensionPaths).toEqual([]);
		const text = component.render(80).join("\n");
		expect(text).toContain("No project override for plan/index.ts.");
		expect(text).not.toContain("Esc close");
	});

	test("offers x in Project scope only", () => {
		const global = buildPanel({ items: [enabledItem("plan")], reports: [] });
		expect(global.component.render(120).join("\n")).not.toContain("x inherit");

		global.component.handleInput("x");
		expect(global.store.calls.setExtensionPaths).toEqual([]);

		const project = buildPanel({ items: [enabledItem("plan")], reports: [] });
		project.component.handleInput("s");
		expect(project.component.render(120).join("\n")).toContain("x inherit");
	});

	test("Escape closes the screen", () => {
		const { component, closedCount } = buildPanel({ items: [enabledItem("plan")], reports: [] });

		component.handleInput("\u001b");

		expect(closedCount()).toBe(1);
	});

	test("drops whole hint keys rather than truncating one", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], reports: [makeReport("plan")] });

		const narrow = component.render(44).join("\n");
		expect(narrow).toContain("Esc close");
		expect(narrow).not.toContain("s scope");
		expect(component.render(140).join("\n")).toContain("s scope");
	});

	test("focuses the row under a click", () => {
		const { component } = buildPanel({ items: [enabledItem("alpha"), enabledItem("beta")], reports: [] });

		component.render(80);
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 5 } as any)).toEqual({ handled: true });
		expect(selectedLine(component)).toContain("beta");

		component.handleMouse({ type: "click", button: "left", x: 10, y: 4 } as any);
		expect(selectedLine(component)).toContain("alpha");
	});

	test("ignores a click on the frame or a group header", () => {
		const { component } = buildPanel({ items: [enabledItem("alpha"), enabledItem("beta")], reports: [] });

		component.render(80);
		const before = selectedLine(component);
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 0 } as any)).toBeUndefined();
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 3 } as any)).toBeUndefined();
		expect(selectedLine(component)).toBe(before);
	});

	test("keeps the focus when two rows share a directory name and the list reorders", () => {
		let items: ResourceItem[] = [enabledItem("plan"), makeItem({ path: "/home/me/.pi/extensions/plan/extra.ts" })];
		const runtime = {
			scope: () => "global" as const,
			setScope: () => {},
			items: (kind: "extensions" | "skills") => (kind === "extensions" ? items : []),
			disabledCount: () => 0,
			projectAvailable: () => true,
			isDirty: () => false,
			toggle: async () => {},
			clearOverride: async () => {},
			onChange: () => () => {},
		};
		const component = new PanelComponent({
			runtime,
			reports: () => [],
			settings: fakeSettingsSurface().surface,
			skills: () => new Map(),
			theme: coloringTheme,
			agentDir: "/agent",
			cwd: "/proj",
			viewportRows: 24,
			requestRender: () => {},
			refresh: () => {},
			reload: () => {},
			onClose: () => {},
		});

		component.render(60);
		component.handleInput("j");
		expect(component.render(60).join("\n")).toContain("[accent]extra");

		items = [enabledItem("alpha"), enabledItem("plan"), makeItem({ path: "/home/me/.pi/extensions/plan/extra.ts" })];
		expect(component.render(60).join("\n")).toContain("[accent]extra");
	});
});
