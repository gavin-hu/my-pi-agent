import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import {
	makeDiscovery,
	makeItem,
	makeStore,
	packageExtension,
	type FakeStore,
} from "../../../test/helpers/fixtures/picker.ts";
import type { ResourceItem } from "../picker/types.ts";
import { createExtensionsPickerRuntime } from "../picker/runtime.ts";
import { PanelComponent } from "./tui.ts";

/** Let a fire-and-forget toggle or refresh settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const packageItem = (name: string, enabled = true): ResourceItem => packageExtension(name, enabled) as ResourceItem;

function build(options: {
	items: ResourceItem[];
	reports?: ExtensionReport[];
	trusted?: boolean;
	store?: FakeStore;
	rows?: number;
	width?: number;
	theme?: unknown;
	filter?: string;
	refresh?: () => void | Promise<void>;
}) {
	const store = options.store ?? makeStore();
	const { discovery } = makeDiscovery({
		global: options.items,
		globalStore: store,
		trusted: options.trusted ?? true,
	});
	const runtime = createExtensionsPickerRuntime({ discovery, cwd: "/proj", agentDir: "/agent" });
	let closed = 0;
	const notices: string[] = [];
	const reports = options.reports ?? [];
	const component = new PanelComponent({
		runtime,
		reports: () => reports,
		filter: options.filter,
		theme: (options.theme as typeof fakeTheme) ?? fakeTheme,
		agentDir: "/agent",
		viewportRows: options.rows ?? 24,
		requestRender: () => {},
		refresh: options.refresh ?? (() => {}),
		onClose: () => {
			closed += 1;
		},
		onNotice: (message) => notices.push(message),
	});
	return { component, runtime, store, notices, closedCount: () => closed };
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

	test("space does nothing on a report with no item", async () => {
		const { component, store } = build({ items: [], reports: [makeReport("bytefly")] });

		component.handleInput(" ");
		await settle();

		expect(store.calls.setExtensionPaths).toHaveLength(0);
	});

	test("Tab warns instead of switching when the project is untrusted", () => {
		const { component, runtime, notices } = build({ items: [packageItem("plan")], reports: [], trusted: false });

		component.handleInput("\t");

		expect(runtime.scope()).toBe("global");
		expect(notices.at(-1)).toContain("not trusted");
	});

	test("Tab switches to project scope when trusted", () => {
		const { component, runtime } = build({ items: [packageItem("plan")], reports: [] });

		component.handleInput("\t");

		expect(runtime.scope()).toBe("project");
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
			onChange: () => () => {},
		};
		const component = new PanelComponent({
			runtime,
			reports: () => [],
			theme: coloringTheme,
			agentDir: "/agent",
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
		const { component, notices } = build({
			items: [packageItem("plan")],
			reports: [],
			refresh: () => Promise.reject(new Error("probe exploded")),
		});

		component.handleInput("r");
		await settle();

		expect(notices.at(-1)).toContain("Could not refresh: probe exploded");
		expect(component.render(80).join("\n")).not.toContain("refreshing");
	});
});
