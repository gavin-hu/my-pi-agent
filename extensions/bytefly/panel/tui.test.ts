import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { withLeaf } from "../../../test/helpers/config.ts";
import { coloringTheme, fakeTheme, roleSgrTheme, ROLE_SGR } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import {
	makeDiscovery,
	makeItem,
	makeStore,
	packageExtension,
	type FakeStore,
} from "../../../test/helpers/fixtures/picker.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { ResourceItem, Settings } from "../picker/types.ts";
import { createExtensionsPickerRuntime } from "../picker/runtime.ts";
import { nextValue, type SettingsSnapshot, settingViews, storedValue } from "./settings.ts";
import type { SettingsSurface } from "./settings-runtime.ts";
import { PanelComponent } from "./tui.ts";

const packageItem = (name: string, enabled = true): ResourceItem => packageExtension(name, enabled) as ResourceItem;

/** A copy of `source` without the leaf at `path`; the unset writer's inverse, in memory. */
function withoutLeaf(source: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | undefined {
	const [head, ...rest] = path;
	if (head === undefined) return source;
	const next = { ...source };
	if (rest.length === 0) {
		delete next[head];
	} else {
		const child = source[head] as Record<string, unknown> | undefined;
		if (!child || typeof child !== "object") return source;
		const pruned = withoutLeaf(child, rest);
		if (pruned === undefined) delete next[head];
		else next[head] = pruned;
	}
	return Object.keys(next).length === 0 ? undefined : next;
}

/** A settings surface over an in-memory snapshot, for rendering and interaction. */
function makeSettings(
	options: {
		app?: Settings;
		global?: Record<string, unknown>;
		project?: Record<string, unknown>;
		themes?: readonly string[];
	} = {},
) {
	const snapshot: SettingsSnapshot = {
		app: options.app ?? {},
		global: options.global ?? {},
		project: options.project ?? {},
		themes: options.themes ?? [],
	};
	const changes: string[] = [];
	let dirty = false;
	const surface: SettingsSurface = {
		views: (scope) => settingViews(snapshot, scope),
		setValue: async (scope, id, raw) => {
			const view = settingViews(snapshot, scope).find((entry) => entry.id === id);
			if (!view?.config) return false;
			const document = scope === "global" ? snapshot.global : snapshot.project;
			const section = (document[view.config.section] ?? {}) as Record<string, unknown>;
			document[view.config.section] = withLeaf(section, view.config.path, raw);
			dirty = true;
			changes.push(`${scope}:${id}=${raw}`);
			return true;
		},
		change: async (scope, id) => {
			const view = settingViews(snapshot, scope).find((entry) => entry.id === id);
			if (!view) return;
			const next = nextValue(view, view.value);
			const config = view.config;
			if (view.source === "app") {
				const app = snapshot.app as unknown as Record<string, unknown>;
				const key = id === "byteflyUi" ? "quietStartup" : id;
				app[key] = storedValue(view, next.value);
			} else if (config) {
				const document = scope === "global" ? snapshot.global : snapshot.project;
				const section = (document[config.section] ?? {}) as Record<string, unknown>;
				document[config.section] = withLeaf(section, config.path, storedValue(view, next.value));
			}
			dirty = true;
			changes.push(`${scope}:${id}`);
		},
		reset: async (scope, id) => {
			const view = settingViews(snapshot, scope).find((entry) => entry.id === id);
			const config = view?.config;
			if (!config) return false;
			const document = scope === "global" ? snapshot.global : snapshot.project;
			const section = document[config.section] as Record<string, unknown> | undefined;
			if (!section || typeof section !== "object") return false;
			const next = withoutLeaf(section, config.path);
			if (next === undefined) delete document[config.section];
			else document[config.section] = next;
			dirty = true;
			changes.push(`${scope}:${id}=reset`);
			return true;
		},
		sectionDocument: (scope, section) => (scope === "global" ? snapshot.global : snapshot.project)[section],
		isDirty: () => dirty,
	};
	return { surface, changes, snapshot, isDirty: () => dirty };
}

function build(options: {
	items: ResourceItem[];
	reports?: ExtensionReport[];
	trusted?: boolean;
	store?: FakeStore;
	rows?: number;
	width?: number;
	theme?: unknown;
	filter?: string;
	section?: "extensions" | "settings";
	refresh?: (force?: boolean) => void | Promise<void>;
	needsProbe?: boolean;
	initialRefresh?: boolean;
	app?: Settings;
	globalDoc?: Record<string, unknown>;
	projectDoc?: Record<string, unknown>;
	themes?: readonly string[];
	settings?: SettingsSurface;
}) {
	const store = options.store ?? makeStore();
	const { discovery, projectStore } = makeDiscovery({
		global: options.items,
		globalStore: store,
		trusted: options.trusted ?? true,
	});
	// Mirrors the command: a runtime refusal or write failure lands in the frame.
	const holder: { component?: PanelComponent } = {};
	const runtime = createExtensionsPickerRuntime({
		discovery,
		cwd: "/proj",
		agentDir: "/agent",
		onError: (message) => holder.component?.notify(message),
	});
	let closed = 0;
	const reports = options.reports ?? [];
	const settings =
		options.settings ??
		makeSettings({
			app: options.app,
			global: options.globalDoc,
			project: options.projectDoc,
			themes: options.themes,
		}).surface;
	const component = new PanelComponent({
		runtime,
		reports: () => reports,
		settings,
		filter: options.filter,
		section: options.section,
		theme: (options.theme as typeof fakeTheme) ?? fakeTheme,
		agentDir: "/agent",
		cwd: "/proj",
		viewportRows: options.rows ?? 24,
		requestRender: () => {},
		refresh: options.refresh ?? (() => {}),
		needsProbe: options.needsProbe,
		initialRefresh: options.initialRefresh,
		onClose: () => {
			closed += 1;
		},
	});
	holder.component = component;
	return { component, runtime, store, projectStore, settings, closedCount: () => closed };
}

/** Move the focus to the row whose label contains `label`, rendering as it goes. */
function focus(component: PanelComponent, label: string): void {
	component.render(80);
	for (let step = 0; step < 40; step += 1) {
		const line = component.render(80).find((candidate) => candidate.startsWith("❯"));
		if (line?.includes(label)) return;
		component.handleInput("j");
	}
	throw new Error(`never reached ${label}`);
}

describe("PanelComponent rendering", () => {
	test("joins each item to its report and shows both", () => {
		const { component } = build({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "degraded")])],
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("plan/index.ts");
		expect(text).toContain("1 degraded");
	});

	test("draws a label-first title rule and a checkbox column", () => {
		const { component } = build({ items: [packageItem("plan")], reports: [] });

		const lines = component.render(60);
		expect(lines[0]).toContain("bytefly ─");
		expect(lines.join("\n")).toContain(GLYPHS.boxOn);
	});

	test("renders no glyph and no health for an item with no report", () => {
		const { component } = build({ items: [packageItem("memory")], reports: [] });

		const text = component.render(80).join("\n");
		expect(text).toContain("memory/index.ts");
		expect(text).not.toContain(GLYPHS.check);
		expect(text).not.toContain("ok");
	});

	test("keeps every line inside the width at 44, 64, and 96", () => {
		const items = Array.from({ length: 12 }, (_, index) => packageItem(`ext-${String(index).padStart(2, "0")}`));
		const reports = [
			makeReport("ext-00", [makeFinding("git", "missing", "a very long detail ".repeat(6), "and a longer hint")]),
			makeReport("ext-01", [makeFinding("unpdf", "degraded")]),
		];
		for (const width of [44, 64, 96]) {
			const { component } = build({ items, reports });
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("fits the terminal height, collapsing the detail pane when rows run out", () => {
		const items = Array.from({ length: 12 }, (_, index) => packageItem(`ext-${String(index).padStart(2, "0")}`));
		const reports = [makeReport("ext-00", [makeFinding("git", "missing", "missing git", "install git")])];
		for (const rows of [10, 14, 24, 40]) {
			const { component } = build({ items, reports, rows });
			expect(component.render(80).length).toBeLessThanOrEqual(rows);
		}
	});

	test("abbreviates the summary on a narrow terminal", () => {
		const { component } = build({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [makeReport("plan")],
		});
		expect(component.render(96).join("\n")).toContain("2 extensions");
		expect(component.render(44).join("\n")).toContain("2 ext");
	});

	test("narrows the screen to one extension", () => {
		const { component } = build({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [makeReport("plan")],
			filter: "plan",
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("plan only");
		expect(text).toContain("plan/index.ts");
		expect(text).not.toContain("todo/index.ts");
	});

	test("shows the focused row's findings and moves them with the selection", () => {
		const { component } = build({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [
				makeReport("plan", [makeFinding("git", "missing", "plan needs git", "install git")]),
				makeReport("todo", [makeFinding("todo.json", "missing", "todo is broken", "fix todo")]),
			],
		});

		expect(component.render(70).join("\n")).toContain("plan needs git");
		component.handleInput("j");
		expect(component.render(70).join("\n")).toContain("todo is broken");
	});

	test("shows notes only once Enter expands the detail", () => {
		const { component } = build({
			items: [packageItem("bytefly")],
			reports: [makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])],
		});

		expect(component.render(70).join("\n")).not.toContain("TUI only");
		component.handleInput("\r");
		expect(component.render(70).join("\n")).toContain("TUI only");
	});

	test("expands only the focused row", () => {
		const { component } = build({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [
				makeReport("plan", [makeFinding("platform", "info", "plan note")]),
				makeReport("todo", [makeFinding("platform", "info", "todo note")]),
			],
		});

		component.handleInput("\r");
		expect(component.render(70).join("\n")).toContain("plan note");

		component.handleInput("j");
		expect(component.render(70).join("\n")).not.toContain("todo note");

		// The expanded row is remembered, not carried by the cursor.
		component.handleInput("k");
		expect(component.render(70).join("\n")).toContain("plan note");
	});

	test("flips the Enter hint with the focused row", () => {
		const { component } = build({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
		});

		expect(component.render(96).join("\n")).toContain("Enter detail");
		component.handleInput("\r");
		expect(component.render(96).join("\n")).toContain("Enter collapse");
		component.handleInput("j");
		expect(component.render(96).join("\n")).toContain("Enter detail");
	});

	test("keeps the frame inside the terminal when an expanded list is clipped", () => {
		const items = Array.from({ length: 40 }, (_, index) => packageItem(`ext-${String(index).padStart(2, "0")}`));
		const notes = Array.from({ length: 8 }, (_, index) => makeFinding(`note-${index}`, "info", `note ${index}`));
		const { component } = build({ items, reports: [makeReport("ext-00", notes)], rows: 40 });

		component.handleInput("\r");
		const lines = component.render(80);
		expect(lines.length).toBeLessThanOrEqual(40);
		expect(lines.join("\n")).toContain("showing");
	});

	test("grows the detail pane to the free height when expanded", () => {
		const notes = Array.from({ length: 8 }, (_, index) => makeFinding(`note-${index}`, "info", `note ${index}`));
		const { component } = build({
			items: [packageItem("bytefly")],
			reports: [makeReport("bytefly", notes)],
			rows: 40,
		});

		expect(component.render(80).join("\n")).not.toContain("note 7");
		component.handleInput("\r");
		const text = component.render(80);
		expect(text.join("\n")).toContain("note 7");
		expect(text.length).toBeLessThanOrEqual(40);
	});

	test("reads a settings-off row as off while the detail still names its findings", () => {
		const { component } = build({
			items: [packageItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing", "missing git", "install git")])],
		});

		const lines = component.render(80);
		const row = lines.find((line) => line.includes("plan/index.ts"));
		expect(row).toContain("off");
		expect(row).not.toContain("1 missing");
		// The pane still explains what is wrong before the row is turned back on.
		expect(lines.join("\n")).toContain("git: missing git");
	});

	test("names the environment's disable list on the row", () => {
		const { component } = build({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("state", "info", "disabled through env")], false)],
		});

		const row = component.render(80).find((line) => line.includes("plan/index.ts"));
		expect(row).toContain("env disabled");
	});

	test("shows an unreported row's resource path in the detail pane", () => {
		const { component } = build({ items: [packageItem("memory")], reports: [] });
		expect(component.render(80).join("\n")).toContain("/pkg/extensions/memory/index.ts");
	});

	test("sanitizes report text before it reaches the terminal", () => {
		const { component } = build({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "missing", "bad\u001b[31mtext")])],
		});
		expect(component.render(70).join("\n")).not.toContain("\u001b");
	});

	test("accents the focused row and dims a disabled row", () => {
		const { component } = build({
			items: [packageItem("alpha"), packageItem("zulu", false)],
			reports: [],
			theme: coloringTheme,
		});
		const text = component.render(60).join("\n");
		expect(text).toContain("[accent]alpha/index.ts");
		expect(text).toContain("[dim]zulu/index.ts");
	});

	test("reports an empty result", () => {
		const { component } = build({ items: [], reports: [] });
		expect(component.render(60).join("\n")).toContain("No extensions found.");
	});
});

describe("PanelComponent input", () => {
	test("navigation skips group headers", async () => {
		const { component, store } = build({
			items: [packageItem("plan"), makeItem({ path: "/agent/extensions/auto.ts" })],
			reports: [],
		});

		// Starts on the package row; `j` steps past the top-level header.
		component.handleInput("j");
		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths.at(-1)).toEqual(["-extensions/auto.ts"]);
	});

	test("space toggles the focused item and marks the screen dirty", async () => {
		const { component } = build({ items: [packageItem("plan")], reports: [makeReport("plan")] });

		expect(component.render(60).join("\n")).not.toContain("Saved");
		component.handleInput(" ");
		await settle();
		await settle();

		expect(component.render(60).join("\n")).toContain("Saved · reload to apply");
	});

	test("space explains a report with no item instead of doing nothing", async () => {
		const { component, store } = build({ items: [], reports: [makeReport("bytefly")] });

		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths).toHaveLength(0);
		const text = component.render(80).join("\n");
		expect(text).toContain("bytefly is not resolved; manage it with pi config.");
		expect(text).not.toContain("Esc close");
	});

	test("Tab warns instead of switching when the project is untrusted", () => {
		const { component, runtime } = build({ items: [packageItem("plan")], reports: [], trusted: false });

		component.handleInput("\t");

		expect(runtime.scope()).toBe("global");
		expect(component.render(80).join("\n")).toContain("not trusted");
	});

	test("Tab switches to project scope when trusted", () => {
		const { component, runtime } = build({ items: [packageItem("plan")], reports: [] });

		component.handleInput("\t");

		expect(runtime.scope()).toBe("project");
	});

	test("x clears the project override the toggle wrote", async () => {
		const item = makeItem({ path: "/agent/extensions/auto.ts" });
		const { component, projectStore } = build({ items: [item], reports: [] });

		component.handleInput("\t");
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
		const row = component.render(80).find((line) => line.includes("auto.ts"));
		expect(row).toContain(GLYPHS.boxOn);
		expect(component.render(80).join("\n")).toContain("Saved · reload to apply");
	});

	test("x explains a row with no project override and writes nothing", async () => {
		const { component, projectStore } = build({ items: [packageItem("plan")], reports: [] });

		component.handleInput("\t");
		component.handleInput("x");
		await settle();
		await settle();

		expect(projectStore.calls.setProjectExtensionPaths).toEqual([]);
		const text = component.render(80).join("\n");
		expect(text).toContain("No project override for plan/index.ts.");
		expect(text).not.toContain("Esc close");
	});

	test("offers x in Project scope only", () => {
		const global = build({ items: [packageItem("plan")], reports: [] });
		expect(global.component.render(120).join("\n")).not.toContain("x inherit");

		global.component.handleInput("x");
		expect(global.store.calls.setExtensionPaths).toEqual([]);

		const project = build({ items: [packageItem("plan")], reports: [] });
		project.component.handleInput("\t");
		expect(project.component.render(120).join("\n")).toContain("x inherit");
	});

	test("Escape closes the screen", () => {
		const { component, closedCount } = build({ items: [packageItem("plan")], reports: [] });

		component.handleInput("\u001b");

		expect(closedCount()).toBe(1);
	});

	test("drops whole hint keys rather than truncating one", () => {
		const { component } = build({ items: [packageItem("plan")], reports: [makeReport("plan")] });

		const narrow = component.render(44).join("\n");
		expect(narrow).toContain("Esc close");
		expect(narrow).not.toContain("Tab scope");
		expect(component.render(96).join("\n")).toContain("Tab scope");
	});

	test("focuses the row under a click", () => {
		const { component } = build({ items: [packageItem("alpha"), packageItem("beta")], reports: [] });
		const selected = (): string | undefined => component.render(80).find((line) => line.startsWith("❯"));

		component.render(80);
		// Frame: header, summary, blank, group header, then the rows.
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 5 } as any)).toEqual({ handled: true });
		expect(selected()).toContain("beta/index.ts");

		component.handleMouse({ type: "click", button: "left", x: 10, y: 4 } as any);
		expect(selected()).toContain("alpha/index.ts");
	});

	test("ignores a click on the frame or a group header", () => {
		const { component } = build({ items: [packageItem("alpha"), packageItem("beta")], reports: [] });
		const selected = (): string | undefined => component.render(80).find((line) => line.startsWith("❯"));

		component.render(80);
		const before = selected();
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 0 } as any)).toBeUndefined();
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 3 } as any)).toBeUndefined();
		expect(selected()).toBe(before);
	});

	test("keeps the focus when two rows share a directory name and the list reorders", () => {
		let items: ResourceItem[] = [packageItem("plan"), makeItem({ path: "/home/me/.pi/extensions/plan/extra.ts" })];
		const runtime = {
			scope: () => "global" as const,
			setScope: () => {},
			items: () => items,
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
			settings: makeSettings().surface,
			theme: coloringTheme,
			agentDir: "/agent",
			cwd: "/proj",
			viewportRows: 24,
			requestRender: () => {},
			refresh: () => {},
			onClose: () => {},
		});

		// Package rows sort first, so the user's plan is the second plan row.
		component.render(60);
		component.handleInput("j");
		expect(component.render(60).join("\n")).toContain("[accent]plan/extra.ts");

		// A package that sorts ahead shifts every index; the row key must follow.
		items = [packageItem("alpha"), packageItem("plan"), makeItem({ path: "/home/me/.pi/extensions/plan/extra.ts" })];
		const text = component.render(60).join("\n");
		expect(text).toContain("[accent]plan/extra.ts");
	});
});

describe("PanelComponent sections", () => {
	test("draws both section names and accents the active one", () => {
		const { component } = build({ items: [packageItem("plan")], reports: [], theme: roleSgrTheme });

		const text = component.render(90).join("\n");
		expect(text).toContain(`${ROLE_SGR.accent}Extensions`);
		expect(text).toContain(`${ROLE_SGR.other}Settings`);
	});

	test("opens on the Settings section when the command asks for it", () => {
		const { component } = build({
			items: [packageItem("plan")],
			reports: [],
			section: "settings",
			theme: roleSgrTheme,
		});

		const text = component.render(80).join("\n");
		expect(text).toContain(`${ROLE_SGR.other}Extensions`);
		expect(text).toContain(`${ROLE_SGR.accent}Settings`);
		expect(text).toContain("29 settings");
		expect(text).toContain("Bytefly startup TUI");
		expect(text).toContain("Desktop notifications");
		expect(text).toContain("Delivery method");
		// The pane scrolls, so the assertion names a row the first screen shows rather
		// than one further down the catalogue.
		expect(text).toContain("Watcher matched");
		expect(text).not.toContain("No settings yet.");
		expect(text).not.toContain("plan/index.ts");
	});

	test("switches sections with the arrow keys and keeps the extension focus", () => {
		const { component } = build({ items: [packageItem("alpha"), packageItem("beta")], reports: [] });
		const selectedLine = (): string | undefined => component.render(80).find((line) => line.startsWith("❯"));

		component.render(80);
		component.handleInput("j");
		expect(selectedLine()).toContain("beta/index.ts");

		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Global · 29 settings");

		component.handleInput("\u001b[D");
		expect(selectedLine()).toContain("beta/index.ts");
	});

	test("keeps the scope switch working in Settings", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings" });

		component.handleInput("\t");

		const text = component.render(80).join("\n");
		expect(text).toContain("Project · 25 settings");
		expect(text).toContain("App settings are Global only.");
		expect(text).not.toContain("Bytefly startup TUI");
	});

	test("keeps the focus near the dropped row when a scope switch removes it", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings" });
		const selected = (): string | undefined => component.render(80).find((line) => line.startsWith("❯"));

		component.render(80);
		// Five group jumps land on the Terminal row, which is an app row: Project
		// drops it, and the cursor must land nearby rather than back at the top.
		component.handleInput("g");
		for (let index = 0; index < 5; index += 1) component.handleInput("]");
		expect(selected()).toContain("Theme");

		component.handleInput("\t");
		expect(component.render(80).join("\n")).toContain("Project · 25 settings");
		expect(selected()).toContain("Prune after (days)");
	});

	test("refuses the project scope in Settings when the project is untrusted", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", trusted: false });

		component.handleInput("\t");

		const refused = component.render(80).join("\n");
		expect(refused).toContain("Project is not trusted");
		expect(refused).toContain("Global · 29 settings");
		// The notice takes the hint row, so the key hints step aside while it shows.
		expect(refused).not.toContain("Esc close");

		component.handleInput("j");
		const restored = component.render(80).join("\n");
		expect(restored).not.toContain("Project is not trusted");
		expect(restored).toContain("Esc close");
	});

	test("shows a refused setting change in the frame", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews({ app: {}, global: {}, project: {}, themes: [] }, scope),
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
		const { component } = build({ items: [packageItem("plan")], section: "settings", settings: surface });

		component.handleInput(" ");
		await settle();
		await settle();

		const text = component.render(80).join("\n");
		expect(text).toContain("disk full");
		expect(text).not.toContain("Esc close");
	});

	test("clips a long notice to the width like the hint it replaces", () => {
		const { component } = build({ items: [packageItem("plan")] });

		component.notify(`refused: ${"a path ".repeat(30)}`);
		for (const width of [30, 60, 90]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps the reload marker when a short terminal collapses the body", async () => {
		const settings = makeSettings();
		const { component } = build({
			items: [packageItem("plan")],
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
		const settings = makeSettings();
		const { component } = build({ items: [packageItem("plan")], section: "settings", settings: settings.surface });

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
		const settings = makeSettings();
		const { component } = build({ items: [packageItem("plan")], section: "settings", settings: settings.surface });

		component.handleInput("j");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(settings.changes).toEqual(["global:notify.enabled"]);
		expect(component.render(80).join("\n")).toContain("On");
	});

	test("hints the section switch, the scope key, and the change key", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings" });

		const text = component.render(96).join("\n");
		expect(text).toContain("←/→");
		expect(text).toContain("Space change");
		expect(text).toContain("Tab scope");
	});

	test("names the source and target file in the detail pane", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			app: { quietStartup: true } as Settings,
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("Bytefly startup TUI — Pi setting");
		expect(text).toContain(`Global · ${join("/agent", "settings.json")}`);
	});

	test("keeps every line within the width in both sections", () => {
		for (const section of ["extensions", "settings"] as const) {
			const { component } = build({ items: [packageItem("plan")], reports: [], section });
			for (const width of [80, 48, 40]) {
				for (const line of component.render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});
});

describe("PanelComponent refresh", () => {
	test("re-probes once on r and shows a busy hint", async () => {
		let finish: () => void = () => {};
		let refreshes = 0;
		const { component } = build({
			items: [packageItem("plan")],
			reports: [],
			refresh: () => {
				refreshes += 1;
				return new Promise<void>((resolve) => {
					finish = resolve;
				});
			},
		});

		component.handleInput("r");
		component.handleInput("r");
		expect(refreshes).toBe(1);
		expect(component.render(80).join("\n")).toContain("refreshing");
		finish();
		await settle();
		expect(component.render(80).join("\n")).not.toContain("refreshing");
	});

	test("surfaces a failed refresh as a notice and clears the busy state", async () => {
		const { component } = build({
			items: [packageItem("plan")],
			reports: [],
			refresh: () => Promise.reject(new Error("probe exploded")),
		});

		component.handleInput("r");
		await settle();

		const failed = component.render(80).join("\n");
		expect(failed).toContain("Could not refresh: probe exploded");
		expect(failed).not.toContain("refreshing");
		expect(failed).not.toContain("Esc close");

		component.handleInput("j");
		expect(component.render(80).join("\n")).toContain("Esc close");
	});
});

describe("PanelComponent probing", () => {
	test("primes once and shows the busy hint while it runs", async () => {
		const calls: boolean[] = [];
		const { component } = build({
			items: [packageItem("plan")],
			needsProbe: true,
			refresh: async (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		component.prime();
		expect(calls).toHaveLength(1);
		expect(component.render(80).join("\n")).toContain("refreshing");
		await settle();
		expect(calls).toEqual([false]);
		expect(component.render(80).join("\n")).not.toContain("refreshing");
	});

	test("waits for the first Extensions view", () => {
		const calls: boolean[] = [];
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			needsProbe: true,
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([]);
		component.handleInput("\u001b[D");
		expect(calls).toEqual([false]);
	});

	test("forces the first probe when the command asked to refresh", () => {
		const calls: boolean[] = [];
		const { component } = build({
			items: [packageItem("plan")],
			needsProbe: true,
			initialRefresh: true,
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([true]);
	});

	test("does nothing without needsProbe", () => {
		const calls: boolean[] = [];
		const { component } = build({
			items: [packageItem("plan")],
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([]);
	});
});

describe("PanelComponent text editing", () => {
	/** Walk the focus down to the row whose label matches. */
	test("opens the editor on the rail glyph and the probe timeout", () => {
		const rail = build({ items: [], section: "settings", globalDoc: { chrome: { rail: "┃" } } });
		focus(rail.component, "Rail glyph");
		rail.component.handleInput(" ");

		// A text row never cycles: Space opens the editor on the current glyph.
		const railText = rail.component.render(80).join("\n");
		expect(railText).toContain("┃▏");
		expect(railText).toContain("Esc cancel");

		const timeout = build({ items: [], section: "settings", globalDoc: { doctor: { timeoutMs: 3000 } } });
		focus(timeout.component, "Probe timeout");
		timeout.component.handleInput("\r");

		expect(timeout.component.render(80).join("\n")).toContain("3000▏");
	});

	test("Enter opens the editor on the stored value and shows the editor keys", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { notify: { title: "Pi" } } });

		focus(component, "Notification title");
		component.handleInput("\r");

		const text = component.render(80).join("\n");
		expect(text).toContain("Pi▏");
		expect(text).toContain("Esc cancel");
		expect(text).not.toContain("Esc close");
	});

	test("typing and Enter store the value", async () => {
		const settings = makeSettings({ global: { notify: { title: "Pi" } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Notification title");
		component.handleInput("\r");
		for (const char of "lot") component.handleInput(char);
		component.handleInput("\r");
		await settle();
		await settle();

		expect(settings.changes).toContain("global:notify.title=Pilot");
		expect(component.render(80).join("\n")).toContain("Saved · reload to apply");
	});

	test("Esc cancels without writing", async () => {
		const settings = makeSettings({ global: { notify: { title: "Pi" } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Notification title");
		component.handleInput("\r");
		component.handleInput("x");
		component.handleInput("\u001b");
		await settle();

		expect(settings.changes.filter((change) => change.includes("notify.title"))).toEqual([]);
		expect(component.render(80).join("\n")).not.toContain("Pi▏");
	});

	test("keeps the editor open when the runtime refuses the value", async () => {
		const base = makeSettings({ global: { notify: { title: "Pi" } } });
		const refusing: SettingsSurface = { ...base.surface, setValue: async () => false };
		const { component } = build({ items: [], section: "settings", settings: refusing });

		focus(component, "Notification title");
		component.handleInput("\r");
		component.handleInput("!");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(component.render(80).join("\n")).toContain("Pi!▏");
	});

	test("inserts at the caret and refuses characters past the limit", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { notify: { title: "Pi" } } });

		focus(component, "Notification title");
		component.handleInput("\r");
		component.handleInput("\u001b[D"); // left
		component.handleInput("o");
		expect(component.render(80).join("\n")).toContain("Po▏i");

		// Move to the end and overrun the 40-character rule.
		component.handleInput("\u0005");
		for (let step = 0; step < 45; step += 1) component.handleInput("x");
		const text = component.render(80).join("\n");
		expect(text).toContain(`${"Poi"}${"x".repeat(37)}`);
		expect(text).not.toContain("x".repeat(38));
	});
	test("strips bracketed-paste markers from a pasted value", async () => {
		const settings = makeSettings({ global: { notify: { title: "Pi" } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Notification title");
		component.handleInput("\r");
		// A terminal wraps a paste in `\x1b[200~` … `\x1b[201~` before the component
		// sees it; their ESC is dropped as a control character, so the marker text
		// itself has to be stripped or it lands in the stored value.
		component.handleInput("\x1b[200~Build finished\x1b[201~");

		const text = component.render(80).join("\n");
		expect(text).toContain("PiBuild finished▏");
		expect(text).not.toContain("[200~");

		component.handleInput("\r");
		await settle();
		await settle();
		expect(settings.changes).toContain("global:notify.title=PiBuild finished");
	});
});

describe("PanelComponent settings actions", () => {
	test("names the reset, JSON, and group keys in the hint row", () => {
		const { component } = build({ items: [], section: "settings" });

		const text = component.render(120).join("\n");
		expect(text).toContain("u reset");
		expect(text).toContain("J JSON");
		expect(text).toContain("[ ] group");
	});

	test("resets the focused row and marks the screen saved", async () => {
		const { component } = build({
			items: [],
			section: "settings",
			globalDoc: { rewind: { max: 50, autoSnapshots: false } },
		});

		focus(component, "Snapshots kept");
		component.handleInput("u");
		await settle();

		const text = component.render(80).join("\n");
		const row = text.split("\n").find((line) => line.includes("Snapshots kept"));
		// The stored 50 is gone, so the row falls back to the loader's 20.
		expect(row?.trimEnd().endsWith("20")).toBe(true);
		expect(text).toContain("Saved");
	});

	test("shows a failed reset in the frame instead of behind it", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews({ app: {}, global: {}, project: {}, themes: [] }, scope),
			change: async () => {},
			setValue: async () => false,
			reset: async () => {
				throw new Error("read-only file");
			},
			sectionDocument: () => undefined,
			isDirty: () => false,
		};
		const { component } = build({ items: [], section: "settings", settings: surface });

		focus(component, "Bytefly startup TUI");
		component.handleInput("u");
		await settle();

		expect(component.render(80).join("\n")).toContain("read-only file");
	});

	test("shows the focused row's section as stored, and closes it on Tab", () => {
		const { component } = build({
			items: [],
			section: "settings",
			globalDoc: { worktree: { baseRef: "head" } },
		});

		focus(component, "Base ref");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain("worktree");
		expect(text).toContain('"baseRef": "head"');
		expect(text).toContain("J hide");

		component.handleInput("\t");
		const afterScope = component.render(80).join("\n");
		expect(afterScope).not.toContain('"baseRef": "head"');
	});

	test("does not reopen the JSON pane after the focus visits a Global-only row", () => {
		const { component } = build({
			items: [],
			section: "settings",
			globalDoc: { worktree: { baseRef: "head" } },
		});

		focus(component, "Base ref");
		component.handleInput("J");
		expect(component.render(80).join("\n")).toContain('"baseRef": "head"');

		// Land on an app row (no section), then walk back to the same config row.
		component.handleInput("g");
		expect(component.render(80).join("\n")).not.toContain('"baseRef": "head"');
		focus(component, "Base ref");
		expect(component.render(80).join("\n")).not.toContain('"baseRef": "head"');
	});

	test("explains that a Pi setting has no section to show", () => {
		const { component } = build({ items: [], section: "settings" });

		focus(component, "Bytefly startup TUI");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain("bytefly.json has no section");
		expect(text).not.toContain("J hide");
	});

	test("jumps to the next and previous group and stops at the ends", () => {
		const { component } = build({ items: [], section: "settings" });
		const selected = (): string | undefined => component.render(80).find((line) => line.startsWith("❯"));

		component.render(80);
		expect(selected()).toContain("Bytefly startup TUI");

		component.handleInput("]");
		expect(selected()).toContain("Desktop notifications");
		component.handleInput("[");
		expect(selected()).toContain("Bytefly startup TUI");
		// The first group has no predecessor: the key stays put instead of wrapping.
		component.handleInput("[");
		expect(selected()).toContain("Bytefly startup TUI");

		component.handleInput("G");
		expect(selected()).toContain("Inject notes");
		component.handleInput("]");
		expect(selected()).toContain("Inject notes");
	});
});

describe("PanelComponent settings review fixes", () => {
	test("keeps the focused setting across a scope switch", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			globalDoc: { notify: { title: "Pi" } },
		});
		const selected = (): string => component.render(80).find((line) => line.startsWith("❯")) ?? "";

		focus(component, "Notification title");
		component.handleInput("\t");
		expect(selected()).toContain("Notification title");
		component.handleInput("\t");
		expect(selected()).toContain("Notification title");
	});

	test("names the global file for an inherited row and calls a default a default", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			rows: 40,
			globalDoc: { worktree: { baseRef: "head" } },
		});

		component.handleInput("\t");
		focus(component, "Base ref");
		let text = component.render(80).join("\n");
		expect(text).toContain(`Inherited from Global · ${join("/agent", "bytefly.json")}`);

		focus(component, "Fetch remote");
		text = component.render(80).join("\n");
		expect(text).toContain(`Default · ${join("/proj", ".pi", "bytefly.json")}`);
		expect(text).not.toContain("Inherited from Global");
	});

	test("names the scope file in the JSON pane, not the value origin", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			globalDoc: { worktree: { baseRef: "head" } },
		});

		component.handleInput("\t");
		focus(component, "Base ref");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain(`worktree — Project · ${join("/proj", ".pi", "bytefly.json")}`);
		expect(text).toContain("Not set in this scope.");
	});

	test("counts settings, not group headings, in the range row", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", rows: 12 });

		const global = component.render(80).join("\n");
		expect(global).toContain("showing");
		expect(global).toContain("of 29");
		expect(global).not.toContain("of 39");

		component.handleInput("\t");
		expect(component.render(80).join("\n")).toContain("of 25");
	});

	test("ignores a click below the last body row", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", rows: 24 });
		const selected = (): string => component.render(80).find((line) => line.startsWith("❯")) ?? "";

		const lines = component.render(80);
		const rangeY = lines.findIndex((line) => line.includes("showing"));
		const hintY = lines.findIndex((line) => line.includes("Esc close"));
		const before = selected();

		for (const y of [rangeY, hintY]) {
			expect(component.handleMouse({ type: "click", button: "left", x: 10, y } as never)).toBeUndefined();
		}
		expect(selected()).toBe(before);
	});

	test("keeps the saved marker while the JSON pane is open", () => {
		const base = makeSettings({ global: { notify: { enabled: true } } });
		const surface: SettingsSurface = { ...base.surface, isDirty: () => true };
		const { component } = build({ items: [], section: "settings", settings: surface });

		focus(component, "Desktop notifications");
		component.handleInput("J");

		expect(component.render(80).join("\n")).toContain("Saved · reload to apply");
	});

	test("counts the JSON lines it hides", () => {
		const doctor = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`key${index}`, `value ${index}`]));
		const { component } = build({ items: [], section: "settings", rows: 14, globalDoc: { doctor } });

		focus(component, "Proactive health check");
		component.handleInput("J");

		// Twelve JSON lines in a three-line room: two are shown and the marker
		// replaces the third, so ten are hidden.
		expect(component.render(80).join("\n")).toContain("… 10 more lines");
	});

	test("does not claim a hidden JSON pane on an app row", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { notify: { enabled: true } } });

		focus(component, "Desktop notifications");
		component.handleInput("J");
		component.handleInput("g");

		const text = component.render(80).join("\n");
		expect(text).toContain("Bytefly startup TUI — Pi setting");
		expect(text).toContain("J JSON");
		expect(text).not.toContain("J hide");
	});

	test("keeps the label and the caret while editing a long value on a narrow terminal", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { notify: { title: "Pi" } } });

		focus(component, "Notification title");
		component.handleInput(" ");
		component.handleInput("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");

		const line = component.render(30).find((candidate) => candidate.startsWith("❯")) ?? "";
		expect(line).toContain("Notification");
		expect(line).toContain("▏");
		expect(line).toContain("…");
	});

	test("fits an eight-row terminal in both scopes and while dirty", () => {
		for (const project of [false, true]) {
			const { component } = build({ items: [], section: "settings", rows: 8 });
			if (project) {
				component.render(80);
				component.handleInput("\t");
			}
			expect(component.render(80).length).toBeLessThanOrEqual(8);
		}

		const base = makeSettings({ global: { notify: { enabled: true } } });
		const surface: SettingsSurface = { ...base.surface, isDirty: () => true };
		const dirty = build({ items: [], section: "settings", rows: 8, settings: surface }).component;
		const lines = dirty.render(80);
		expect(lines.length).toBeLessThanOrEqual(8);
		expect(lines.join("\n")).toContain("Saved · reload to apply");

		focus(dirty, "Desktop notifications");
		dirty.handleInput("J");
		const withJson = dirty.render(80);
		expect(withJson.length).toBeLessThanOrEqual(8);
		expect(withJson.join("\n")).toContain("Saved · reload to apply");
	});
});

describe("PanelComponent theme setting", () => {
	test("renders Theme under Terminal and cycles the resolved names", async () => {
		const { component } = build({
			items: [],
			section: "settings",
			themes: ["system", "bytefly-dark", "bytefly-light"],
			app: { theme: "system" } as Settings,
		});

		focus(component, "Theme");
		const before = component.render(80).join("\n");
		expect(before).toContain("Terminal (2)");
		expect(before).toContain("Theme");

		component.handleInput(" ");
		await settle();
		await settle();

		const after = component.render(80).join("\n");
		expect(after).toContain("bytefly-dark");
		expect(after).toContain("Saved · reload to apply");
	});

	test("omits the Theme row in Project scope", () => {
		const { component } = build({ items: [], section: "settings", themes: ["system", "bytefly-dark"] });

		component.render(80);
		component.handleInput("\t");

		expect(component.render(80).join("\n")).not.toContain("Theme");
	});
});
