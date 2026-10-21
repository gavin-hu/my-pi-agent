/**
 * The bytefly panel capability: the merged extension model, its text
 * projection, the settings catalogue and runtime, the two section views, the
 * editing and cursor arithmetic, the docked component, and the `/bytefly`
 * command.
 *
 * Screen tests assert fields, roles, ordering, and width/height bounds; the
 * shared dock frame, cursor, and render-cache contracts live in `lib/tui/`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import pkg from "../../../package.json";
import { withLeaf } from "../../../test/helpers/config.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { coloringTheme, fakeTheme, makeFakePi, ROLE_SGR, roleSgrTheme } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import {
	makeDiscovery,
	makeItem,
	makeStore,
	packageExtension,
	type FakeStore,
} from "../../../test/helpers/fixtures/picker.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { settle } from "../../../test/helpers/process.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import { ListCursor } from "../../../lib/tui/cursor.ts";
import type { ResourceItem, Settings, WriteScope } from "../picker/types.ts";
import { resourceKey } from "../picker/resources.ts";
import { createExtensionsPickerRuntime } from "../picker/runtime.ts";
import { registerPanel } from "./commands.ts";
import {
	formatHeadline,
	formatListing,
	formatRow,
	formatSettingsHeadline,
	formatSettingsListing,
	panelCounts,
	sectionSegments,
	settingsSummarySegments,
	summarySegments,
} from "./format.ts";
import { buildPanelModel, extensionName, REPORT_ONLY_LABEL } from "./join.ts";
import {
	nextValue,
	rowsForScope,
	SETTING_ROWS,
	type SettingDescriptor,
	type SettingsSnapshot,
	settingViews,
	storedValue,
	textError,
	UNTRUSTED_SETTINGS_NOTE,
} from "./settings.ts";
import {
	configPath,
	createSettingsRuntime,
	type SettingsRuntime,
	type SettingsRuntimeDeps,
	type SettingsSurface,
} from "./settings-runtime.ts";
import { SHIPPED_THEMES_DIR, shippedThemeNames } from "./themes.ts";
import { PanelComponent } from "./tui.ts";
import { entriesOf, entryKey, isSelectable, nextRow, selectableRange, settingEntries } from "./tui/entries.ts";
import { applyEditKey, type EditingState } from "./tui/editing.ts";
import {
	BODY_START,
	countsLine,
	detailRows,
	fitOptionalLines,
	groupLine,
	noticeLine,
	savedLine,
	sectionBar,
	totalRows,
} from "./tui/frame.ts";
import { clampSelection, firstRow, lastRow, moveRows, retainFocus } from "./tui/nav.ts";
import { extensionDetail, extensionHints, extensionRow, extensionSummary } from "./tui/extensions-view.ts";
import {
	editHints,
	projectNote,
	sectionJsonPane,
	settingDetail,
	settingRow,
	settingsHints,
	settingsSummary,
} from "./tui/settings-view.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import type { UpdateOutcome } from "../update/state.ts";

const packageItem = (name: string, enabled = true): ResourceItem => packageExtension(name, enabled) as ResourceItem;
const topLevel = (path: string): ResourceItem => makeItem({ path });
const userItem = (name: string, fileName = "index.ts"): ResourceItem =>
	makeItem({ path: `/home/me/.pi/extensions/${name}/${fileName}` });

function textModel(items: ResourceItem[] = [packageItem("plan"), packageItem("todo"), packageItem("memory", false)]) {
	return buildPanelModel({
		items,
		reports: [makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")])],
		agentDir: "/agent",
	});
}

function findRow(model: ReturnType<typeof textModel>, label: string) {
	const row = model.rows.find((candidate) => candidate.label === label);
	if (!row) throw new Error(`missing row ${label}`);
	return row;
}

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
	return {
		app: overrides.app ?? {},
		global: overrides.global ?? {},
		project: overrides.project ?? {},
		themes: overrides.themes ?? [],
	};
}

function descriptor(id: string): SettingDescriptor {
	const found = SETTING_ROWS.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing row ${id}`);
	return found;
}

function viewOf(snap: SettingsSnapshot, scope: WriteScope, id: string) {
	const found = settingViews(snap, scope).find((entry) => entry.id === id);
	if (!found) throw new Error(`missing view ${id}`);
	return found;
}

/** The `bytefly.json` document that states one row's leaf, for a read test. */
function documentFor(row: SettingDescriptor, value: unknown): Record<string, unknown> {
	const config = row.config;
	if (!config) return {};
	let patch: unknown = value;
	for (const key of [...config.path].reverse()) patch = { [key]: patch };
	return { [config.section]: patch };
}

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
	const state: SettingsSnapshot = {
		app: options.app ?? {},
		global: options.global ?? {},
		project: options.project ?? {},
		themes: options.themes ?? [],
	};
	const changes: string[] = [];
	let dirty = false;
	const surface: SettingsSurface = {
		views: (scope) => settingViews(state, scope),
		setValue: async (scope, id, raw) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			if (!view?.config) return false;
			const document = scope === "global" ? state.global : state.project;
			const section = (document[view.config.section] ?? {}) as Record<string, unknown>;
			document[view.config.section] = withLeaf(section, view.config.path, raw);
			dirty = true;
			changes.push(`${scope}:${id}=${raw}`);
			return true;
		},
		change: async (scope, id) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			if (!view) return;
			const next = nextValue(view, view.value);
			const config = view.config;
			if (view.source === "app") {
				const app = state.app as unknown as Record<string, unknown>;
				const key = id === "byteflyUi" ? "quietStartup" : id;
				app[key] = storedValue(view, next.value);
			} else if (config) {
				const document = scope === "global" ? state.global : state.project;
				const section = (document[config.section] ?? {}) as Record<string, unknown>;
				document[config.section] = withLeaf(section, config.path, storedValue(view, next.value));
			}
			dirty = true;
			changes.push(`${scope}:${id}`);
		},
		reset: async (scope, id) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			const config = view?.config;
			if (!config) return false;
			const document = scope === "global" ? state.global : state.project;
			const section = document[config.section] as Record<string, unknown> | undefined;
			if (!section || typeof section !== "object") return false;
			const next = withoutLeaf(section, config.path);
			if (next === undefined) delete document[config.section];
			else document[config.section] = next;
			dirty = true;
			changes.push(`${scope}:${id}=reset`);
			return true;
		},
		sectionDocument: (scope, section) => (scope === "global" ? state.global : state.project)[section],
		isDirty: () => dirty,
	};
	return { surface, changes, snapshot: state, isDirty: () => dirty };
}

function build(options: {
	items: ResourceItem[];
	reports?: ExtensionReport[];
	trusted?: boolean;
	store?: FakeStore;
	rows?: number;
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

const selectedLine = (component: PanelComponent): string | undefined =>
	component.render(80).find((line) => line.startsWith("❯"));

describe("panel model", () => {
	test("takes the extension directory, not the display name", () => {
		expect(extensionName("/pkg/extensions/web-access/index.ts")).toBe("web-access");
		expect(extensionName("/agent/extensions/a.ts")).toBe("extensions");
	});

	test("joins a subfolder item to its report on the directory name", () => {
		const report = makeReport("web-access", [makeFinding("unpdf", "degraded")]);
		const model = buildPanelModel({ items: [packageItem("web-access")], reports: [report], agentDir: "/agent" });

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("web-access/index.ts");
		expect(model.rows[0]?.report).toBe(report);
	});

	test("keys a flat item by its resource identity and matches no report", () => {
		const item = topLevel("/agent/extensions/a.ts");
		const model = buildPanelModel({ items: [item], reports: [makeReport("plan")], agentDir: "/agent" });

		expect(model.rows[0]?.key).toBe("auto:/agent/extensions/a.ts");
		expect(model.rows[0]?.report).toBeUndefined();
	});

	test("appends a report with no item in one trailing group", () => {
		const model = buildPanelModel({
			items: [packageItem("todo")],
			reports: [makeReport("todo"), makeReport("bytefly")],
			agentDir: "/agent",
		});

		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const last = model.rows.at(-1);
		expect(last?.key).toBe("report:bytefly");
		expect(last?.item).toBeUndefined();
		expect(last?.report?.extension).toBe("bytefly");
	});

	test("gives no report to every resource that shares a directory name", () => {
		const planReport = makeReport("plan", [makeFinding("git", "missing", "no git", "install git")]);
		const model = buildPanelModel({
			items: [packageItem("plan"), userItem("plan"), packageItem("todo")],
			reports: [planReport, makeReport("todo")],
			agentDir: "/agent",
		});

		const planRows = model.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		expect(planRows).toHaveLength(2);
		expect(planRows.every((row) => row.report === undefined)).toBe(true);

		const todo = model.rows.find((row) => row.item && extensionName(row.item.path) === "todo");
		expect(todo?.report?.extension).toBe("todo");

		// The unclaimed report surfaces under `Not resolved` with its findings intact.
		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const other = model.rows.find((row) => !row.item);
		expect(other?.key).toBe("report:plan");
		expect(other?.report?.findings).toEqual(planReport.findings);
	});

	test("keeps distinct keys for flat items sharing a directory and gives them no health", () => {
		const first = topLevel("/agent/extensions/a.ts");
		const second = makeItem({
			path: "/pkg/extensions/b.ts",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
		});
		const model = buildPanelModel({
			items: [first, second],
			reports: [makeReport("extensions", [makeFinding("x", "missing")])],
			agentDir: "/agent",
		});

		const itemRows = model.rows.filter((row) => row.item);
		expect(itemRows).toHaveLength(2);
		expect(new Set(itemRows.map((row) => row.key)).size).toBe(2);
		expect(itemRows.every((row) => row.report === undefined)).toBe(true);
		expect(model.rows.some((row) => !row.item && row.report?.extension === "extensions")).toBe(true);
	});

	test("preserves the picker's groups and order", () => {
		const model = buildPanelModel({
			items: [topLevel("/agent/extensions/a.ts"), packageItem("plan")],
			reports: [],
			agentDir: "/agent",
		});

		expect(model.groups).toHaveLength(2);
		expect(model.groups[0]?.label).toContain("npm:pkg");
		expect(model.rows[0]?.label).toBe("plan/index.ts");
		expect(model.rows[1]?.label).toBe("a.ts");
	});

	test("narrows to one extension directory and drops empty groups", () => {
		const model = buildPanelModel({
			items: [packageItem("plan"), packageItem("todo")],
			reports: [makeReport("plan"), makeReport("todo")],
			agentDir: "/agent",
			filter: "todo",
		});

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("todo/index.ts");
		expect(model.groups.every((group) => group.count > 0)).toBe(true);
	});

	test("retains the focused row identity when a shared directory name is rebuilt", () => {
		const packagePlan = packageItem("plan");
		const userPlan = userItem("plan", "extra.ts");
		const before = buildPanelModel({ items: [packagePlan, userPlan], reports: [], agentDir: "/agent" });
		const planRows = before.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		const focusedKey = planRows[1]?.key;
		expect(focusedKey).toBe(resourceKey(userPlan));

		const after = buildPanelModel({
			items: [packageItem("alpha"), userPlan, packagePlan],
			reports: [],
			agentDir: "/agent",
		});
		expect(after.rows.find((row) => row.key === focusedKey)?.item?.path).toBe(userPlan.path);
	});
});

describe("panel text projection", () => {
	test("counts rows, off extensions, and problem findings", () => {
		expect(panelCounts(textModel())).toEqual({ extensions: 3, off: 1, missing: 1, degraded: 0 });
	});

	test("counts a report once when the model carries it on more than one row", () => {
		const report = makeReport("plan", [makeFinding("git", "missing"), makeFinding("jq", "degraded")]);
		const single = buildPanelModel({ items: [packageItem("plan")], reports: [report], agentDir: "/agent" });
		const row = single.rows[0];
		if (!row) throw new Error("expected a row");
		const duplicated = { ...single, rows: [...single.rows, { ...row, key: "duplicate" }] };

		expect(panelCounts(duplicated)).toEqual({ extensions: 2, off: 0, missing: 1, degraded: 1 });
	});

	test("does not count the findings of an off row as problems", () => {
		const off = buildPanelModel({
			items: [packageItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		});

		expect(panelCounts(off)).toEqual({ extensions: 1, off: 1, missing: 0, degraded: 0 });
	});

	test("states the scope, counts, and problems", () => {
		expect(formatHeadline(textModel(), "global")).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
		expect(formatHeadline(textModel(), "global", { compact: true })).toBe(
			"bytefly: Global · 3 ext · 1 off · 1 missing",
		);
		expect(formatHeadline(textModel(), "project")).toContain("Project");
	});

	test("names a narrowed extension through the summary segments", () => {
		const narrowed = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "degraded")])],
			agentDir: "/agent",
			filter: "plan",
		});
		expect(
			summarySegments(narrowed, "global", { filter: "plan" })
				.map((segment) => segment.text)
				.join(" · "),
		).toBe("Global · plan only · 1 degraded");
		expect(formatHeadline(narrowed, "global")).toBe("bytefly: Global · 1 extension · 1 degraded");
	});

	test("colors the headline by meaning: scope accent, counts meta, problems bad or warn", () => {
		expect(summarySegments(textModel(), "global").map((segment) => segment.color)).toEqual([
			"accent",
			"meta",
			"meta",
			"bad",
		]);
		const degradedOnly = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("unpdf", "degraded")])],
			agentDir: "/agent",
		});
		expect(summarySegments(degradedOnly, "global").at(-1)?.color).toBe("warn");
	});

	test("orders the two section names and accents the active one", () => {
		expect(sectionSegments("extensions")).toEqual([
			{ text: "Extensions", color: "accent" },
			{ text: "Settings", color: "faint" },
		]);
		expect(sectionSegments("settings")).toEqual([
			{ text: "Extensions", color: "faint" },
			{ text: "Settings", color: "accent" },
		]);
		expect(settingsSummarySegments("global", 11).map((segment) => segment.text)).toEqual(["Global", "11 settings"]);
		expect(settingsSummarySegments("project", 8).map((segment) => segment.text)).toEqual(["Project", "8 settings"]);
		expect(formatSettingsHeadline(28)).toBe("bytefly: Settings · Global · 28 settings");
	});

	test("renders a row without a report with no glyph and no summary", () => {
		const row = findRow(textModel([packageItem("memory")]), "memory/index.ts");

		expect(formatRow(row)).toContain("[x] memory/index.ts");
		expect(formatRow(row)).not.toContain(GLYPHS.check);
		expect(formatRow(row)).not.toContain("ok");
	});

	test("suffixes a reported row with its health", () => {
		const row = findRow(textModel(), "plan/index.ts");
		expect(formatRow(row)).toContain(`${GLYPHS.cross} plan/index.ts — 1 missing`);
	});

	test("reads an off row as off, not as its health", () => {
		const off = buildPanelModel({
			items: [packageItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		}).rows[0];
		if (!off) throw new Error("expected a row");

		expect(formatRow(off)).toContain(`${GLYPHS.disabled} plan/index.ts — off`);
		expect(formatRow(off)).not.toContain("missing");
		expect(formatRow(off)).not.toContain("ok");
	});

	test("names the environment's disable list separately from settings", () => {
		const envOff = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("state", "info", "disabled through PI_DISABLED_EXTENSIONS")], false)],
			agentDir: "/agent",
		}).rows[0];
		if (!envOff) throw new Error("expected a row");

		expect(formatRow(envOff)).toContain(`${GLYPHS.disabled} plan/index.ts — env disabled`);
	});

	test("renders a report with no item without a checkbox", () => {
		const reported = buildPanelModel({
			items: [],
			reports: [makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])],
			agentDir: "/agent",
		}).rows[0];
		if (!reported) throw new Error("expected a row");

		expect(formatRow(reported)).toContain("bytefly — ok");
		expect(formatRow(reported)).not.toContain("[");
		expect(formatRow(reported)).not.toContain(GLYPHS.check);
	});

	test("lists groups with a heading and a health suffix per row", () => {
		const text = formatListing(textModel(), "global");
		expect(text.split("\n")[0]).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
		expect(text).toContain("npm:pkg (user) (3)");
		expect(text).toContain(`[x] ${GLYPHS.cross} plan/index.ts — 1 missing`);
		expect(text).toContain(`[ ] ${GLYPHS.disabled} memory/index.ts — off`);
	});

	test("reports an empty result", () => {
		const empty = buildPanelModel({ items: [], reports: [], agentDir: "/agent" });
		expect(formatListing(empty, "global")).toContain("No extensions found.");
	});

	test("lists settings flat, in screen order, with their values", () => {
		const views = settingViews(snapshot(), "global");
		const lines = formatSettingsListing(views).split("\n");

		expect(lines[0]).toBe("bytefly: Settings · Global · 14 settings");
		expect(lines[1]).toContain("Bytefly startup TUI: Off");
		expect(lines).toHaveLength(15);
		expect(lines.join("\n")).not.toContain("Notifications (");
		for (const row of [
			"Bytefly startup TUI: Off",
			"Theme: system",
			"Desktop notifications: Off",
			"Turn finished: On",
			"Needs input: On",
			"Job finished: On",
			"Watcher matched: On",
			"Delivery method: Auto",
			"Wake when a job finishes: Off",
			"Wake on a match: Off",
			"Automatic snapshots: On",
			"Proactive health check: On",
			"Currency: CNY (¥)",
			"Session budget: 0",
		]) {
			expect(lines.join("\n"), row).toContain(row);
		}
	});

	test("sanitizes a settings label and value before printing it", () => {
		const view = { ...viewOf(snapshot(), "global", "byteflyUi"), label: "Bad\u001b[31m", valueLabel: "On\u0007" };
		const text = formatSettingsListing([view]);

		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});
});

describe("settings catalogue", () => {
	test("lists the curated rows in screen order and stays inside the 24-row ceiling", () => {
		expect(SETTING_ROWS.map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"theme",
			"notify.enabled",
			"notify.turnFinished",
			"notify.needsInput",
			"notify.jobFinished",
			"notify.matchFound",
			"notify.method",
			"job.wakeOnFinish",
			"watch.wakeOnMatch",
			"rewind.autoSnapshots",
			"doctor.proactive",
			"price.currency.code",
			"price.budget",
		]);
		expect(SETTING_ROWS.length).toBeLessThanOrEqual(14);
		expect(new Set(SETTING_ROWS.map((entry) => entry.id)).size).toBe(SETTING_ROWS.length);
	});

	test("shows app rows only in Global scope", () => {
		const global = rowsForScope("global").map((entry) => entry.id);
		expect(global).toEqual(SETTING_ROWS.map((entry) => entry.id));
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual(
			rowsForScope("global")
				.filter((entry) => entry.source === "bytefly")
				.map((entry) => entry.id),
		);
		expect(global).toHaveLength(14);
		expect(rowsForScope("project")).toHaveLength(12);
	});

	test("names every row and describes it", () => {
		for (const entry of SETTING_ROWS) {
			expect(entry.label.trim(), entry.id).not.toBe("");
			expect(entry.description.trim(), entry.id).not.toBe("");
		}
	});

	test("reads the defaults when neither file sets a key", () => {
		expect(
			settingViews(snapshot(), "global").map((entry) => [entry.id, entry.value, entry.valueLabel, entry.origin]),
		).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["theme", "system", "system", "default"],
			["notify.enabled", "false", "Off", "default"],
			["notify.turnFinished", "true", "On", "default"],
			["notify.needsInput", "true", "On", "default"],
			["notify.jobFinished", "true", "On", "default"],
			["notify.matchFound", "true", "On", "default"],
			["notify.method", "auto", "Auto", "default"],
			["job.wakeOnFinish", "false", "Off", "default"],
			["watch.wakeOnMatch", "false", "Off", "default"],
			["rewind.autoSnapshots", "true", "On", "default"],
			["doctor.proactive", "true", "On", "default"],
			["price.currency.code", "CNY", "CNY (¥)", "default"],
			["price.budget", "0", "0", "default"],
		]);

		expect(settingViews(snapshot(), "project").map((entry) => entry.origin)).toEqual(
			Array.from({ length: 12 }, () => "default"),
		);
		const inherited = snapshot({ global: { notify: { enabled: true } } });
		expect(viewOf(inherited, "project", "notify.enabled")).toMatchObject({ value: "true", origin: "inherited" });
		expect(viewOf(inherited, "project", "notify.needsInput")).toMatchObject({ value: "true", origin: "default" });
	});

	test("lists the theme names it is given and labels an automatic pair", () => {
		const themes = ["system", "bytefly-dark", "dark", "light"];
		const fixed = snapshot({ themes, app: { theme: "bytefly-dark" } as Settings });
		expect(viewOf(fixed, "global", "theme")).toMatchObject({
			value: "bytefly-dark",
			valueLabel: "bytefly-dark",
			origin: "global",
		});
		expect(viewOf(fixed, "global", "theme").options.map((option) => option.value)).toEqual(themes);

		const automatic = snapshot({ themes, app: { theme: "light/dark" } as Settings });
		expect(viewOf(automatic, "global", "theme")).toMatchObject({
			value: "light/dark",
			valueLabel: "light/dark (automatic)",
			origin: "global",
		});
	});

	test("reads configured app and bytefly values", () => {
		const snap = snapshot({
			app: { quietStartup: true } as Settings,
			global: {
				notify: { enabled: true, method: "osc99" },
				doctor: { proactive: false },
				price: { currency: { code: "USD" } },
				job: { wakeOnFinish: true },
			},
		});

		expect(viewOf(snap, "global", "byteflyUi")).toMatchObject({ valueLabel: "On", origin: "global" });
		expect(viewOf(snap, "global", "notify.enabled")).toMatchObject({ valueLabel: "On", origin: "global" });
		expect(viewOf(snap, "global", "notify.method").valueLabel).toBe("OSC 99");
		expect(viewOf(snap, "global", "doctor.proactive").valueLabel).toBe("Off");
		expect(viewOf(snap, "global", "price.currency.code").valueLabel).toBe("USD ($)");
		expect(viewOf(snap, "global", "job.wakeOnFinish").valueLabel).toBe("On");
	});

	test("reads a hand-set header-only startup as bytefly UI off", () => {
		const snap = snapshot({ app: { quietStartup: "header" } as Settings });
		expect(viewOf(snap, "global", "byteflyUi")).toMatchObject({ valueLabel: "Off", origin: "global" });
	});

	test("inherits the global value in Project scope until a project key overrides it", () => {
		const snap = snapshot({
			global: { notify: { enabled: true }, price: { currency: { code: "USD" } } },
			project: { notify: { enabled: false }, price: { currency: { code: "CNY" } } },
		});

		expect(viewOf(snap, "project", "notify.enabled")).toMatchObject({ valueLabel: "Off", origin: "project" });
		expect(viewOf(snap, "project", "price.currency.code")).toMatchObject({ value: "CNY", origin: "project" });
		expect(
			viewOf(snapshot({ global: { rewind: { autoSnapshots: false } } }), "project", "rewind.autoSnapshots"),
		).toMatchObject({ value: "false", origin: "inherited" });
	});

	test("shows the loader fallback for an invalid stored value", () => {
		const snap = snapshot({ global: { notify: { enabled: "yes" } } });
		expect(viewOf(snap, "global", "notify.enabled")).toMatchObject({ valueLabel: "Off", origin: "global" });
	});

	test("wraps each row through its curated options", () => {
		expect(nextValue(descriptor("byteflyUi"), "false").value).toBe("true");
		expect(nextValue(descriptor("byteflyUi"), "true").value).toBe("false");
		expect(nextValue(descriptor("notify.enabled"), "false").value).toBe("true");
		expect(nextValue(descriptor("notify.enabled"), "true").value).toBe("false");
		expect(nextValue(descriptor("price.currency.code"), "CNY").value).toBe("USD");
		expect(nextValue(descriptor("price.currency.code"), "USD").value).toBe("CNY");
	});

	test("cycles the delivery method through every surface and wraps", () => {
		const method = descriptor("notify.method");
		expect(nextValue(method, "auto").value).toBe("osc777");
		expect(nextValue(method, "notify-send").value).toBe("auto");
	});

	test("cycles the theme through the names it is given", () => {
		const snap = snapshot({ themes: ["system", "dark", "light", "bytefly-dark"], app: { theme: "system" } });
		const theme = viewOf(snap, "global", "theme");
		expect(nextValue(theme, "system").value).toBe("dark");
		expect(nextValue(theme, "bytefly-dark").value).toBe("system");
	});

	test("keeps the current value when a text row is asked for its next one", () => {
		expect(nextValue(descriptor("price.budget"), "Pinned").value).toBe("Pinned");
	});

	test("states the budget's rule with the loader's own bounds", () => {
		const budget = descriptor("price.budget");
		for (const good of ["0", "5", "2.50", "0.0001", "9999999"]) {
			expect(textError(budget, good), good).toBeUndefined();
		}
		for (const bad of ["", "-1", "5.", ".5", "5.00001", "10000001", "ten"]) {
			expect(textError(budget, bad), bad).toBeDefined();
		}
	});

	test("every text row's fallback passes its own rule", () => {
		for (const entry of SETTING_ROWS) {
			if (entry.kind !== "text") continue;
			expect(textError(entry, entry.fallback), entry.id).toBeUndefined();
		}
	});

	test("refuses to treat a cycling row as text", () => {
		expect(textError(descriptor("notify.enabled"), "true")).toContain("is not a text setting");
	});

	test("maps raw options to their JSON values", () => {
		expect(storedValue(descriptor("byteflyUi"), "false")).toBe(false);
		expect(storedValue(descriptor("byteflyUi"), "true")).toBe(true);
		expect(storedValue(descriptor("notify.enabled"), "true")).toBe(true);
		expect(storedValue(descriptor("notify.method"), "osc99")).toBe("osc99");
		expect(storedValue(descriptor("price.budget"), "3")).toBe(3);
	});

	test("declares a JSON type for every boolean row", () => {
		for (const entry of SETTING_ROWS.filter((candidate) => candidate.kind === "boolean")) {
			expect(entry.json).toBe("boolean");
			expect(entry.options.map((option) => option.value)).toEqual(["false", "true"]);
		}
	});

	test("round-trips every curated option through its stored value", () => {
		for (const entry of SETTING_ROWS.filter((candidate) => candidate.source === "bytefly")) {
			for (const option of entry.options) {
				const snap = snapshot({ global: documentFor(entry, storedValue(entry, option.value)) });
				expect(viewOf(snap, "global", entry.id).value, `${entry.id}=${option.value}`).toBe(option.value);
			}
		}
	});

	test("reads a stored budget from the document", () => {
		const snap = snapshot({ global: { price: { budget: 5 } } });
		expect(viewOf(snap, "global", "price.budget")).toMatchObject({ value: "5", origin: "global" });
	});

	test("reads another extension's leaf as the file states it and labels a curated value", () => {
		const snap = snapshot({ global: { rewind: { autoSnapshots: false }, job: { wakeOnFinish: true } } });
		expect(viewOf(snap, "global", "rewind.autoSnapshots")).toMatchObject({
			value: "false",
			valueLabel: "Off",
			origin: "global",
		});
		expect(viewOf(snap, "global", "job.wakeOnFinish")).toMatchObject({ value: "true", origin: "global" });
	});

	test("inherits another extension's global leaf in Project scope until the project states it", () => {
		const inherited = snapshot({ global: { job: { wakeOnFinish: true } } });
		expect(viewOf(inherited, "project", "job.wakeOnFinish")).toMatchObject({
			value: "true",
			origin: "inherited",
		});
		const overridden = snapshot({
			global: { job: { wakeOnFinish: true } },
			project: { job: { wakeOnFinish: false } },
		});
		expect(viewOf(overridden, "project", "job.wakeOnFinish")).toMatchObject({
			value: "false",
			origin: "project",
		});
	});

	test("shows a hand-edited value the loader would clamp, which reset can clear", () => {
		const snap = snapshot({ global: { job: { wakeOnFinish: "yes" } } });
		expect(viewOf(snap, "global", "job.wakeOnFinish")).toMatchObject({ value: "yes", valueLabel: "yes" });
	});
});

const temps = makeTempTracker();
afterAll(() => temps.flush());

interface RuntimeBootOptions {
	app?: Settings;
	globalDoc?: Record<string, unknown>;
	projectDoc?: Record<string, unknown>;
	trusted?: boolean;
	themes?: readonly string[];
}

function bootRuntime(options: RuntimeBootOptions = {}) {
	const cwd = temps.track(tempDir("bytefly-settings-cwd-"));
	const agentDir = temps.track(tempDir("bytefly-settings-agent-"));
	if (options.globalDoc) {
		writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify(options.globalDoc));
	}
	if (options.projectDoc) {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify(options.projectDoc));
	}
	const trusted = options.trusted ?? true;
	const globalStore = makeStore({ global: options.app ?? {}, trusted });
	const projectStore = makeStore({ trusted });
	const notices: string[] = [];
	const runtime = createSettingsRuntime({
		stores: { global: globalStore.store, project: projectStore.store },
		cwd,
		agentDir,
		trusted,
		themes: options.themes,
		onError: (message) => notices.push(message),
	});
	return {
		runtime,
		globalStore,
		projectStore,
		notices,
		globalPath: join(agentDir, "bytefly.json"),
		projectPath: join(cwd, ".pi", "bytefly.json"),
	};
}

function runtimeValue(runtime: SettingsRuntime, scope: WriteScope, id: string): string {
	const view = runtime.views(scope).find((entry) => entry.id === id);
	if (!view) throw new Error(`missing ${id} in ${scope}`);
	return view.value;
}

const readText = (path: string): string => readFileSync(path, "utf8");
const writeText = (path: string, text: string): void => writeFileSync(path, text);
const exists = (path: string): boolean => existsSync(path);

describe("settings runtime", () => {
	test("resolves the global and project documents", () => {
		expect(configPath("global", "/cwd", "/agent")).toBe(join("/agent", "bytefly.json"));
		expect(configPath("project", "/cwd", "/agent")).toBe(join("/cwd", ".pi", "bytefly.json"));
	});

	test("writes an app row through the global setter, flushes, and marks the screen dirty", async () => {
		const { runtime, globalStore } = bootRuntime();

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true]);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("true");

		await runtime.change("global", "byteflyUi");
		expect(globalStore.calls.setQuietStartup).toEqual([true, false]);
		expect(globalStore.flushCount()).toBe(2);
		expect(runtime.isDirty()).toBe(true);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("false");
	});

	test("refuses an app row in Project scope without touching the global store", async () => {
		const { runtime, globalStore, notices } = bootRuntime();

		await runtime.change("project", "byteflyUi");

		expect(notices.at(-1)).toContain("Global setting");
		expect(globalStore.calls.setQuietStartup).toEqual([]);
		expect(runtime.isDirty()).toBe(false);
	});

	test("writes the theme through the personal setter and flushes", async () => {
		const { runtime, globalStore } = bootRuntime({ themes: ["system", "dark", "light"] });

		await runtime.change("global", "theme");

		expect(globalStore.calls.setTheme).toEqual(["dark"]);
		expect(runtimeValue(runtime, "global", "theme")).toBe("dark");
		expect(globalStore.flushCount()).toBe(1);
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a flush failure and leaves the shown value unchanged", async () => {
		const { runtime, globalStore, notices } = bootRuntime();
		globalStore.failFlush(new Error("disk full"));

		await runtime.change("global", "byteflyUi");

		expect(notices.at(-1)).toContain("Could not save Bytefly startup TUI");
		expect(notices.at(-1)).toContain("disk full");
		expect(runtime.isDirty()).toBe(false);
		expect(runtimeValue(runtime, "global", "byteflyUi")).toBe("false");
	});

	test("writes one key to the global document and preserves siblings and metadata", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				notify: { title: "Pi" },
				memory: { inject: true },
			},
		});

		await runtime.change("global", "notify.enabled");

		expect(JSON.parse(readText(globalPath))).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { title: "Pi", enabled: true },
			memory: { inject: true },
		});
		expect(runtime.isDirty()).toBe(true);
		expect(runtimeValue(runtime, "global", "notify.enabled")).toBe("true");
	});

	test("inherits the global value, then writes an explicit project override", async () => {
		const { runtime, globalPath, projectPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		expect(runtimeValue(runtime, "project", "notify.enabled")).toBe("true");

		await runtime.change("project", "notify.enabled");

		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(JSON.parse(readText(projectPath))).toEqual({ notify: { enabled: false } });
		expect(runtimeValue(runtime, "project", "notify.enabled")).toBe("false");
	});

	test("stores the budget as a number and refuses a value its rule rejects", async () => {
		const { runtime, globalPath, notices } = bootRuntime();

		expect(await runtime.setValue("global", "price.budget", "2.50")).toBe(true);
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 2.5 } });

		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);
		expect(notices.at(-1)).toContain("Out of range");
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 2.5 } });
	});

	test("cycles the currency algorithm and its companion precision in one write", async () => {
		const { runtime, globalPath } = bootRuntime();

		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("CNY");
		await runtime.change("global", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("applies the currency and its companion leaf as one write", async () => {
		const { runtime, globalPath, notices } = bootRuntime();
		const before = "{ not json";
		writeText(globalPath, before);

		await runtime.change("global", "price.currency.code");

		expect(notices.at(-1)).toContain("Could not save Currency");
		expect(readText(globalPath)).toBe(before);
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("CNY");
	});

	test("writes a nested leaf and keeps the section's siblings and metadata", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: {
				$schema: "https://example.test/meta.json",
				version: 1,
				price: { currency: { symbol: "$", decimals: 2 } },
				notify: { enabled: true },
			},
		});

		await runtime.change("global", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "$", code: "USD", decimals: 3 } },
			notify: { enabled: true },
		});
		expect(runtimeValue(runtime, "global", "price.currency.code")).toBe("USD");
	});

	test("writes a nested project override without touching the global document", async () => {
		const { runtime, globalPath, projectPath } = bootRuntime({ globalDoc: { price: { currency: { code: "CNY" } } } });

		expect(runtimeValue(runtime, "project", "price.currency.code")).toBe("CNY");

		await runtime.change("project", "price.currency.code");

		expect(JSON.parse(readText(globalPath))).toEqual({ price: { currency: { code: "CNY" } } });
		expect(JSON.parse(readText(projectPath))).toEqual({ price: { currency: { code: "USD", decimals: 3 } } });
		expect(runtimeValue(runtime, "project", "price.currency.code")).toBe("USD");
	});

	test("writes the delivery method as a string", async () => {
		const { runtime, globalPath } = bootRuntime();

		await runtime.change("global", "notify.method");

		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { method: "osc777" } });
		expect(runtimeValue(runtime, "global", "notify.method")).toBe("osc777");
	});

	test("refuses a project write when the project is untrusted", async () => {
		const { runtime, notices, projectPath } = bootRuntime({ trusted: false });

		await runtime.change("project", "notify.enabled");

		expect(notices.at(-1)).toContain("Project is not trusted");
		expect(exists(projectPath)).toBe(false);
		expect(runtime.isDirty()).toBe(false);
	});

	test("fires a change notification on a successful write and not on a refused one", async () => {
		let changes = 0;
		const { runtime } = bootRuntime();
		runtime.onChange(() => {
			changes += 1;
		});

		await runtime.change("global", "notify.enabled");
		expect(changes).toBe(1);

		await runtime.change("project", "byteflyUi");
		expect(changes).toBe(1);
	});

	test("stores a typed value at its leaf and marks the screen dirty", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: { notify: { enabled: true }, price: { budget: 0 } },
		});

		expect(await runtime.setValue("global", "price.budget", "5")).toBe(true);

		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true }, price: { budget: 5 } });
		expect(runtimeValue(runtime, "global", "price.budget")).toBe("5");
		expect(runtime.isDirty()).toBe(true);
	});

	test("refuses a text value its rule rejects and writes nothing", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("global", "price.budget", "10000001")).toBe(false);

		expect(notices.at(-1)).toContain("Out of range");
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
		expect(runtimeValue(runtime, "global", "price.budget")).toBe("3");
	});

	test("refuses a row that is not a text row", async () => {
		const { runtime, notices } = bootRuntime();
		expect(await runtime.setValue("global", "notify.enabled", "true")).toBe(false);
		expect(notices.at(-1)).toContain("is not a text setting");
	});

	test("setValue refuses in Project scope for the same reason change does", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ trusted: false, globalDoc: { price: { budget: 3 } } });

		expect(await runtime.setValue("project", "price.budget", "4")).toBe(false);

		expect(notices.at(-1)).toBe(UNTRUSTED_SETTINGS_NOTE);
		expect(JSON.parse(readText(globalPath))).toEqual({ price: { budget: 3 } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("deletes the row's leaf on reset, keeps its siblings, and marks the screen dirty", async () => {
		const { runtime, globalPath } = bootRuntime({
			globalDoc: { job: { wakeOnFinish: true, showStatus: false }, notify: { enabled: true } },
		});

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(true);

		expect(JSON.parse(readText(globalPath))).toEqual({ job: { showStatus: false }, notify: { enabled: true } });
		expect(runtimeValue(runtime, "global", "job.wakeOnFinish")).toBe("false");
		expect(runtime.isDirty()).toBe(true);
	});

	test("reports a row that is already at its default without writing", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { rewind: { autoSnapshots: false } } });

		expect(await runtime.reset("global", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe("Wake when a job finishes is already at its default.");
		expect(JSON.parse(readText(globalPath))).toEqual({ rewind: { autoSnapshots: false } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("says an inherited project value is not a default", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		expect(await runtime.reset("project", "notify.enabled")).toBe(false);

		expect(notices.at(-1)).toBe(
			"Desktop notifications is inherited from Global; there is nothing to reset in Project.",
		);
		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses an app row, which Pi has no unset for", async () => {
		const { runtime, notices } = bootRuntime();

		expect(await runtime.reset("global", "byteflyUi")).toBe(false);

		expect(notices.at(-1)).toContain("Pi has no unset");
		expect(runtime.isDirty()).toBe(false);
	});

	test("refuses a Project reset when the project is untrusted", async () => {
		const { runtime, notices, globalPath } = bootRuntime({
			trusted: false,
			globalDoc: { job: { wakeOnFinish: true } },
		});

		expect(await runtime.reset("project", "job.wakeOnFinish")).toBe(false);

		expect(notices.at(-1)).toBe(UNTRUSTED_SETTINGS_NOTE);
		expect(JSON.parse(readText(globalPath))).toEqual({ job: { wakeOnFinish: true } });
	});

	test("reports an unknown id from every write path without touching a file", async () => {
		const { runtime, notices, globalPath } = bootRuntime({ globalDoc: { notify: { enabled: true } } });

		await runtime.change("global", "missing");
		expect(await runtime.setValue("global", "missing", "1")).toBe(false);
		expect(await runtime.reset("global", "missing")).toBe(false);

		expect(notices).toEqual(["missing is not a setting.", "missing is not a setting."]);
		expect(JSON.parse(readText(globalPath))).toEqual({ notify: { enabled: true } });
		expect(runtime.isDirty()).toBe(false);
	});

	test("reads the section from the scope the pane names", () => {
		const { runtime } = bootRuntime({
			globalDoc: { rewind: { autoSnapshots: false } },
			projectDoc: { job: { wakeOnFinish: true } },
		});

		expect(runtime.sectionDocument("global", "rewind")).toEqual({ autoSnapshots: false });
		expect(runtime.sectionDocument("project", "job")).toEqual({ wakeOnFinish: true });
		expect(runtime.sectionDocument("global", "watch")).toBeUndefined();
	});
});

describe("shipped themes", () => {
	function shipped(name: string): { name: string; path: string } {
		return { name, path: join(SHIPPED_THEMES_DIR, `${name}.json`) };
	}

	test("keeps this package's palettes and drops every other theme", () => {
		const names = shippedThemeNames([
			{ name: "dark", path: "/pi/themes/dark.json" },
			shipped("bytefly-dark"),
			{ name: "bytefly-light" },
			{ name: "mine", path: "/home/me/.pi/agent/themes/mine.json" },
			shipped("bytefly-light"),
			{ name: "bytefly-dark", path: "/pkg/node_modules/bytefly/themes/bytefly-dark.json" },
		]);

		expect(names).toEqual(["bytefly-dark", "bytefly-light"]);
	});

	test("matches the directory, not the name, so a look-alike stays out", () => {
		expect(
			shippedThemeNames([
				{ name: "bytefly-dark", path: join(SHIPPED_THEMES_DIR, "vendor", "bytefly-dark.json") },
				{ name: "bytefly", path: SHIPPED_THEMES_DIR },
			]),
		).toEqual([]);
	});

	test("resolves the package's own themes directory and the manifest glob", () => {
		expect(pkg.pi.themes).toEqual(["./themes/*.json"]);
		const names = shippedThemeNames(["bytefly-dark", "bytefly-light"].map((name) => shipped(name)));
		expect(names).toEqual(["bytefly-dark", "bytefly-light"]);
	});
});

describe("panel entries", () => {
	test("interleaves group headings and rows in model order", () => {
		const model = buildPanelModel({
			items: [topLevel("/agent/extensions/a.ts"), packageItem("plan")],
			reports: [],
			agentDir: "/agent",
		});
		const entries = entriesOf(model);

		expect(entries.map((entry) => entry.kind)).toEqual(["group", "row", "group", "row"]);
		expect(entries[1] && entryKey(entries[1])).toBe(resourceKey(packageItem("plan")));
		expect(entries[3] && entryKey(entries[3])).toBe("auto:/agent/extensions/a.ts");
	});

	test("builds the Settings list flat, in catalogue order, with no headings", () => {
		const entries = settingEntries(settingViews(snapshot(), "global"));

		expect(entries).toHaveLength(14);
		expect(entries.every((entry) => entry.kind === "setting")).toBe(true);
		expect(entryKey(entries[0])).toBe("byteflyUi");
		expect(entryKey(entries.at(-1))).toBe("price.budget");
	});

	test("marks only rows selectable and skips headings when stepping", () => {
		const entries = entriesOf(
			buildPanelModel({
				items: [topLevel("/agent/extensions/a.ts"), packageItem("plan")],
				reports: [],
				agentDir: "/agent",
			}),
		);

		expect(isSelectable(entries[0])).toBe(false);
		expect(isSelectable(entries[1])).toBe(true);
		expect(nextRow(entries, 0, 1)).toBe(1);
		expect(nextRow(entries, 1, 1)).toBe(3);
		expect(nextRow(entries, 1, -1)).toBeUndefined();
		expect(nextRow(entries, 3, 1)).toBeUndefined();
	});

	test("counts a window in selectable rows, not display entries", () => {
		const entries = entriesOf(
			buildPanelModel({
				items: [topLevel("/agent/extensions/a.ts"), packageItem("plan")],
				reports: [],
				agentDir: "/agent",
			}),
		);

		expect(selectableRange(entries, { start: 0, end: 2 })).toEqual({ start: 0, end: 1, total: 2 });
		expect(selectableRange(entries, { start: 2, end: 4 })).toEqual({ start: 1, end: 2, total: 2 });
		expect(selectableRange(entries, { start: 0, end: 4 })).toEqual({ start: 0, end: 2, total: 2 });
	});
});

describe("panel cursor arithmetic", () => {
	const model = buildPanelModel({
		items: [packageItem("alpha"), topLevel("/agent/extensions/a.ts"), packageItem("zulu")],
		reports: [],
		agentDir: "/agent",
	});
	const entries = entriesOf(model);
	const cursor = (): ListCursor => new ListCursor(() => {});

	test("finds the first and last selectable row", () => {
		expect(firstRow(entries)).toBe(1);
		expect(lastRow(entries)).toBe(entries.length - 1);
		expect(firstRow([{ kind: "group", key: "g", label: "g", count: 0 }])).toBeUndefined();
		expect(lastRow([{ kind: "group", key: "g", label: "g", count: 0 }])).toBeUndefined();
	});

	test("keeps the focus on the same key across a rebuild", () => {
		const list = cursor();
		list.selected = 0;
		const remembered = entryKey(entries[4]);
		retainFocus(entries, list, remembered);
		expect(entryKey(entries[list.selected])).toBe(remembered);

		// A row that is already focused is left alone.
		const rowKey = entryKey(entries[1]);
		list.selected = 1;
		retainFocus(entries, list, "missing");
		expect(entryKey(entries[list.selected])).toBe(rowKey);
	});

	test("clamps to the nearest row above, then below", () => {
		const list = cursor();

		list.selected = 3;
		clampSelection(entries, list);
		expect(list.selected).toBe(2);

		list.selected = 0;
		clampSelection(entries, list);
		expect(list.selected).toBe(1);

		list.selected = entries.length + 5;
		clampSelection(entries, list);
		expect(list.selected).toBe(entries.length - 1);
	});

	test("moves by rows while skipping headings and clamping at the end", () => {
		const list = cursor();
		list.selected = 1;
		moveRows(entries, list, 1);
		expect(list.selected).toBe(2);

		moveRows(entries, list, 99);
		expect(list.selected).toBe(lastRow(entries)!);

		const before = list.selected;
		moveRows(entries, list, 0);
		expect(list.selected).toBe(before);
	});
});

describe("panel frame arithmetic", () => {
	test("reads terminal rows from a number or a getter and rejects nonsense", () => {
		expect(totalRows(24)).toBe(24);
		expect(totalRows(() => 40)).toBe(40);
		for (const bad of [undefined, 0, -1, Number.NaN]) expect(totalRows(bad)).toBeUndefined();
	});

	test("sizes the detail pane from the free height", () => {
		expect(detailRows(false, undefined)).toBe(3);
		expect(detailRows(true, undefined)).toBe(8);
		expect(detailRows(false, 24)).toBe(3);
		expect(detailRows(true, 24)).toBe(14);
		expect(detailRows(false, 10)).toBe(0);
		expect(detailRows(true, 10)).toBe(0);
		expect(detailRows(false, 11)).toBe(1);
	});

	test("drops the range row, note, detail blank, and detail pane in that order", () => {
		const input = {
			body: ["note", "r1", "r2", "r3", "r4"],
			note: "note",
			range: "range",
			detail: ["d1", "d2"],
		};

		const roomy = fitOptionalLines({ ...input, viewportRows: 20 });
		expect(roomy).toMatchObject({ range: "range", noteShown: true, detailBlank: true });
		expect(roomy.detail).toEqual(["d1", "d2"]);

		const rangeDropped = fitOptionalLines({ ...input, viewportRows: 14 });
		expect(rangeDropped.range).toBeUndefined();
		expect(rangeDropped.noteShown).toBe(true);
		expect(rangeDropped.detail).toEqual(["d1", "d2"]);

		const noteDropped = fitOptionalLines({ ...input, viewportRows: 13 });
		expect(noteDropped.noteShown).toBe(false);
		expect(noteDropped.body).toEqual(["r1", "r2", "r3", "r4"]);
		expect(noteDropped.detailBlank).toBe(true);

		const blankDropped = fitOptionalLines({ ...input, viewportRows: 12 });
		expect(blankDropped.detailBlank).toBe(false);
		expect(blankDropped.detail).toEqual(["d1", "d2"]);

		const paneDropped = fitOptionalLines({ ...input, viewportRows: 11 });
		expect(paneDropped.detail).toEqual([]);
	});

	test("keeps every optional row when the height is unknown", () => {
		const fitted = fitOptionalLines({
			body: ["note"],
			note: "note",
			range: "range",
			detail: ["d1"],
			viewportRows: undefined,
		});

		expect(fitted).toMatchObject({ noteShown: true, detailBlank: true, range: "range" });
	});

	test("draws the section bar with the active section accented", () => {
		const bar = sectionBar(
			coloringTheme,
			90,
			"settings",
			countsLine(coloringTheme, 80, settingsSummarySegments("global", 14)),
		);

		expect(bar).toContain("[dim]Extensions");
		expect(bar).toContain("[accent]Settings");
		expect(bar).toContain("[accent]Global");
		expect(bar).toContain("[muted]14 settings");
		expect(visibleWidth(bar)).toBeLessThanOrEqual(90);
	});

	test("drops whole count segments on a narrow line", () => {
		const wide = countsLine(fakeTheme, 80, settingsSummarySegments("global", 14));
		const narrow = countsLine(fakeTheme, 12, settingsSummarySegments("global", 14));

		expect(wide).toContain("14 settings");
		expect(narrow).toContain("Global");
		expect(narrow).not.toContain("14 settings");
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(12);
	});

	test("sanitizes a group heading and clips it to the width", () => {
		const line = groupLine(fakeTheme, 40, { label: "bad\u001b[31mgroup", count: 12 });

		expect(line).toContain("group");
		expect(line).toContain("(12)");
		expect(line).not.toContain("\u001b");
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("clips a notice like the hint it replaces", () => {
		const line = noticeLine(fakeTheme, 24, `refused: ${"a path ".repeat(10)}`);

		expect(line).toContain("refused");
		expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	test("adds the saved marker only after a change", () => {
		expect(savedLine(fakeTheme, 80, false)).toEqual([]);
		const line = savedLine(coloringTheme, 80, true)[0];
		expect(line).toContain("[warning]Saved · reload to apply");
		expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(80);
	});

	test("matches the body offset the click mapping relies on", () => {
		expect(BODY_START).toBe(3);
	});
});

describe("extensions view", () => {
	const model = textModel([packageItem("plan"), packageItem("todo")]);

	test("abbreviates the summary under 72 columns", () => {
		expect(extensionSummary(fakeTheme, 96, model, "global", undefined)).toContain("2 extensions");
		expect(extensionSummary(fakeTheme, 44, model, "global", undefined)).toContain("2 ext");
		expect(extensionSummary(fakeTheme, 96, model, "global", "plan")).toContain("plan only");
	});

	test("draws checkbox, health glyph, name, and verdict on one row", () => {
		const missing = findRow(model, "plan/index.ts");
		const clean = findRow(model, "todo/index.ts");

		expect(extensionRow(fakeTheme, 80, missing, false)).toContain(GLYPHS.boxOn);
		expect(extensionRow(fakeTheme, 80, missing, false)).toContain(GLYPHS.cross);
		expect(extensionRow(fakeTheme, 80, missing, false)).toContain("1 missing");
		expect(extensionRow(fakeTheme, 80, clean, false)).not.toContain(GLYPHS.cross);
	});

	test("accents the focused label and dims a disabled one", () => {
		const focused = extensionRow(coloringTheme, 80, findRow(model, "plan/index.ts"), true);
		const disabled = extensionRow(
			coloringTheme,
			80,
			findRow(textModel([packageItem("plan"), packageItem("zulu", false)]), "zulu/index.ts"),
			false,
		);

		expect(focused).toContain("[accent]plan/index.ts");
		expect(disabled).toContain("[dim]zulu/index.ts");
		expect(disabled).toContain("off");
	});

	test("reserves the checkbox column for a report with no item", () => {
		const reported = buildPanelModel({ items: [], reports: [makeReport("bytefly")], agentDir: "/agent" }).rows[0];
		if (!reported) throw new Error("expected a row");
		const line = extensionRow(fakeTheme, 80, reported, false);

		expect(line).toContain("bytefly");
		expect(line).not.toContain(GLYPHS.boxOn);
		expect(line).not.toContain(GLYPHS.boxOff);
	});

	test("keeps a clean verdict quiet and colors a problem", () => {
		const clean = findRow(
			buildPanelModel({ items: [packageItem("todo")], reports: [makeReport("todo")], agentDir: "/agent" }),
			"todo/index.ts",
		);
		expect(extensionRow(coloringTheme, 80, clean, false)).toContain("[dim]ok");
		expect(extensionRow(coloringTheme, 80, findRow(model, "plan/index.ts"), false)).toContain("[error]1 missing");
	});

	test("shows the resource path in the detail pane for an unreported row", () => {
		const row = findRow(textModel([packageItem("memory")]), "memory/index.ts");
		const detail = extensionDetail(fakeTheme, 80, row, 3, false, false);

		expect(detail.join("\n")).toContain("/pkg/extensions/memory/index.ts");
	});

	test("shows findings in the detail pane, with the saved marker while dirty", () => {
		const row = findRow(model, "plan/index.ts");
		const detail = extensionDetail(fakeTheme, 80, row, 3, false, true).join("\n");

		expect(detail).toContain("git");
		expect(detail).toContain("Saved · reload to apply");
	});

	test("keeps informational notes collapsed until expanded", () => {
		const row = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("platform", "info", "TUI only")])],
			agentDir: "/agent",
		}).rows[0];
		if (!row) throw new Error("expected a row");

		expect(extensionDetail(fakeTheme, 80, row, 4, false, false).join("\n")).not.toContain("TUI only");
		expect(extensionDetail(fakeTheme, 80, row, 4, true, false).join("\n")).toContain("TUI only");
	});

	test("hints the expansion, project override, and refresh states", () => {
		const texts = (hints: ReturnType<typeof extensionHints>): string[] =>
			hints.map((hint) => (typeof hint === "string" ? hint : hint.text));

		const collapsed = texts(extensionHints({ expanded: false, refreshing: false, projectScope: false }));
		const expanded = texts(extensionHints({ expanded: true, refreshing: true, projectScope: true }));

		expect(collapsed).toContain("Enter detail");
		expect(collapsed).not.toContain("x inherit");
		expect(collapsed).toContain("r refresh");
		expect(expanded).toContain("Enter collapse");
		expect(expanded).toContain("x inherit");
		expect(expanded).toContain("refreshing…");
	});
});

describe("settings view", () => {
	test("states the scope and the settings count", () => {
		expect(settingsSummary(fakeTheme, 80, "global", 14)).toContain("Global");
		expect(settingsSummary(fakeTheme, 80, "global", 14)).toContain("14 settings");
		expect(settingsSummary(fakeTheme, 80, "project", 12)).toContain("Project");
	});

	test("notes that app settings are Global only", () => {
		const line = projectNote(coloringTheme, 80);
		expect(line).toContain("[dim]App settings are Global only.");
		expect(visibleWidth(line)).toBeLessThanOrEqual(80);
	});

	test("draws a checkbox for a boolean row and a plain value for an enum", () => {
		const off = viewOf(snapshot(), "global", "notify.enabled");
		const on = viewOf(snapshot({ global: { notify: { enabled: true } } }), "global", "notify.enabled");
		const theme = viewOf(snapshot(), "global", "theme");

		expect(settingRow(fakeTheme, 80, off, false)).toContain(GLYPHS.boxOff);
		expect(settingRow(fakeTheme, 80, on, false)).toContain(GLYPHS.boxOn);
		expect(settingRow(fakeTheme, 80, theme, false)).not.toContain(GLYPHS.boxOff);
		expect(settingRow(fakeTheme, 80, theme, false)).toContain("system");
	});

	test("accents the focused setting and puts its value beside the label", () => {
		const line = settingRow(coloringTheme, 120, viewOf(snapshot(), "global", "notify.turnFinished"), true);

		expect(line).toContain("[accent]Turn finished");
		expect(line).toContain("On");
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	test("keeps the label and the caret while editing a long value at a narrow width", () => {
		const line = settingRow(
			fakeTheme,
			30,
			viewOf(snapshot({ global: { price: { budget: 0 } } }), "global", "price.budget"),
			true,
			{
				buffer: "1234567890",
				caret: 10,
			},
		);

		expect(line).toContain("Session");
		expect(line).toContain("▏");
		expect(line).toContain("…");
		expect(visibleWidth(line)).toBeLessThanOrEqual(30);
	});

	test("names the source, description, and origin of the focused setting", () => {
		const detail = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: viewOf(snapshot({ app: { quietStartup: true } as Settings }), "global", "byteflyUi"),
			budget: 3,
			dirty: false,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("Bytefly startup TUI — Pi setting");
		expect(text).toContain("Use bytefly's startup header");
		expect(text).toContain(`Global · ${join("/agent", "settings.json")}`);
	});

	test("names an inherited project value and a project override with their file", () => {
		const inherited = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: viewOf(snapshot({ global: { job: { wakeOnFinish: true } } }), "project", "job.wakeOnFinish"),
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		}).join("\n");
		expect(inherited).toContain(`Inherited from Global · ${join("/agent", "bytefly.json")}`);

		const overridden = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: viewOf(snapshot({ project: { job: { wakeOnFinish: true } } }), "project", "job.wakeOnFinish"),
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		}).join("\n");
		expect(overridden).toContain(`Project · ${join("/proj", ".pi", "bytefly.json")}`);
	});

	test("keeps the saved marker when the detail body collapses", () => {
		const detail = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: viewOf(snapshot(), "global", "byteflyUi"),
			budget: 0,
			dirty: true,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});

		expect(detail).toHaveLength(1);
		expect(detail[0]).toContain("Saved · reload to apply");
	});

	test("shows the focused row's section as stored, with its scope file", () => {
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "job",
			document: { wakeOnFinish: true },
			budget: 4,
			dirty: false,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("job");
		expect(text).toContain(`Global · ${join("/agent", "bytefly.json")}`);
		expect(text).toContain('"wakeOnFinish": true');
	});

	test("says when the focused section is not set in this scope", () => {
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "job",
			document: undefined,
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		});

		expect(detail.join("\n")).toContain("Not set in this scope.");
	});

	test("counts the JSON lines it hides and keeps the saved marker", () => {
		const doctor = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`key${index}`, `value ${index}`]));
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "doctor",
			document: doctor,
			budget: 3,
			dirty: true,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("more lines");
		expect(text).toContain("Saved · reload to apply");
	});

	test("names the JSON toggle and the editor keys", () => {
		expect(settingsHints().join(" ")).toContain("J JSON");
		expect(settingsHints(true).join(" ")).toContain("J hide");
		expect(editHints().join(" ")).toContain("Esc cancel");
		expect(editHints().join(" ")).toContain("Enter save");
	});
});

describe("panel text editing", () => {
	const state = (buffer: string, caret = buffer.length): EditingState => ({ id: "price.budget", buffer, caret });

	test("Esc and Ctrl+C cancel and Enter commits", () => {
		expect(applyEditKey("\u001b", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\u0003", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\r", state("Pi"), 40)).toEqual({ kind: "commit" });
	});

	test("Backspace and Delete edit around the caret", () => {
		const middle = state("Pilot", 2);
		expect(applyEditKey("\u007f", middle, 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Plot", caret: 1 },
			changed: true,
		});
		expect(applyEditKey("\u001b[3~", middle, 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Piot", caret: 2 },
			changed: true,
		});
	});

	test("a Backspace at the start changes nothing", () => {
		expect(applyEditKey("\u007f", state("Pi", 0), 40)).toEqual({
			kind: "update",
			state: state("Pi", 0),
			changed: false,
		});
	});

	test("Left and Right clamp at the ends", () => {
		expect(applyEditKey("\u001b[D", state("Pi", 0), 40)).toEqual({
			kind: "update",
			state: state("Pi", 0),
			changed: false,
		});
		expect(applyEditKey("\u001b[C", state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi"), changed: false });
		expect(applyEditKey("\u001b[D", state("Pi"), 40)).toEqual({
			kind: "update",
			state: state("Pi", 1),
			changed: true,
		});
	});

	test("Home/End and their Ctrl spellings move the caret", () => {
		for (const key of ["\u001b[H", "\u0001"]) {
			expect(applyEditKey(key, state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi", 0), changed: true });
		}
		for (const key of ["\u001b[F", "\u0005"]) {
			expect(applyEditKey(key, state("Pi", 0), 40)).toEqual({ kind: "update", state: state("Pi"), changed: true });
		}
	});

	test("Ctrl+U clears the buffer", () => {
		expect(applyEditKey("\u0015", state("Pi"), 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "", caret: 0 },
			changed: true,
		});
	});

	test("inserts a printable character at the caret", () => {
		expect(applyEditKey("x", state("Pi", 1), 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Pxi", caret: 2 },
			changed: true,
		});
	});

	test("strips bracketed-paste markers", () => {
		expect(applyEditKey("\x1b[200~4.5\x1b[201~", state("Pi"), 40)).toEqual({
			kind: "update",
			state: state("Pi4.5"),
			changed: true,
		});
	});

	test("refuses control characters and text past the row's limit", () => {
		expect(applyEditKey("\u0007", state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi"), changed: false });
		expect(applyEditKey("t", state("Pi"), 2)).toEqual({ kind: "update", state: state("Pi"), changed: false });
		expect(applyEditKey("t", state("Pi"), 3)).toEqual({
			kind: "update",
			state: state("Pit"),
			changed: true,
		});
	});

	test("refuses text on a row with no text rule", () => {
		expect(applyEditKey("x", state("Pi"), undefined)).toEqual({ kind: "update", state: state("Pi"), changed: false });
	});
});

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

	test("draws the bytefly header and a checkbox column", () => {
		const { component } = build({ items: [packageItem("plan")], reports: [] });

		const lines = component.render(60);
		expect(lines[0]).toContain("bytefly");
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

	test("keeps every line within the width in both sections at 80, 48, and 40", () => {
		for (const section of ["extensions", "settings"] as const) {
			const { component } = build({ items: [packageItem("plan")], reports: [], section });
			for (const width of [80, 48, 40]) {
				for (const line of component.render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
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

	test("expands only the focused row and remembers it", () => {
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

		component.render(80);
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 5 } as any)).toEqual({ handled: true });
		expect(selectedLine(component)).toContain("beta/index.ts");

		component.handleMouse({ type: "click", button: "left", x: 10, y: 4 } as any);
		expect(selectedLine(component)).toContain("alpha/index.ts");
	});

	test("ignores a click on the frame or a group header", () => {
		const { component } = build({ items: [packageItem("alpha"), packageItem("beta")], reports: [] });

		component.render(80);
		const before = selectedLine(component);
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 0 } as any)).toBeUndefined();
		expect(component.handleMouse({ type: "click", button: "left", x: 10, y: 3 } as any)).toBeUndefined();
		expect(selectedLine(component)).toBe(before);
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

		component.render(60);
		component.handleInput("j");
		expect(component.render(60).join("\n")).toContain("[accent]plan/extra.ts");

		items = [packageItem("alpha"), packageItem("plan"), makeItem({ path: "/home/me/.pi/extensions/plan/extra.ts" })];
		expect(component.render(60).join("\n")).toContain("[accent]plan/extra.ts");
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
		expect(text).toContain("14 settings");
		expect(text).toContain("Bytefly startup TUI");
		expect(text).toContain("Desktop notifications");
		expect(text).toContain("Delivery method");
		expect(text).toContain("Watcher matched");
		expect(text).not.toContain("plan/index.ts");
	});

	test("switches sections with the arrow keys and keeps the extension focus", () => {
		const { component } = build({ items: [packageItem("alpha"), packageItem("beta")], reports: [] });

		component.render(80);
		component.handleInput("j");
		expect(selectedLine(component)).toContain("beta/index.ts");

		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Global · 14 settings");

		component.handleInput("\u001b[D");
		expect(selectedLine(component)).toContain("beta/index.ts");
	});

	test("keeps the scope switch working in Settings", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings" });

		component.handleInput("\t");

		const text = component.render(80).join("\n");
		expect(text).toContain("Project · 12 settings");
		expect(text).toContain("App settings are Global only.");
		expect(text).not.toContain("Bytefly startup TUI");
	});

	test("keeps the focus near the dropped row when a scope switch removes it", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings" });

		component.render(80);
		focus(component, "Theme");

		component.handleInput("\t");
		expect(component.render(80).join("\n")).toContain("Project · 12 settings");
		expect(selectedLine(component)).toContain("Turn finished");
	});

	test("refuses the project scope in Settings when the project is untrusted", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", trusted: false });

		component.handleInput("\t");

		const refused = component.render(80).join("\n");
		expect(refused).toContain("Project is not trusted");
		expect(refused).toContain("Global · 14 settings");
		expect(refused).not.toContain("Esc close");

		component.handleInput("j");
		const restored = component.render(80).join("\n");
		expect(restored).not.toContain("Project is not trusted");
		expect(restored).toContain("Esc close");
	});

	test("shows a refused setting change in the frame", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews(snapshot(), scope),
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

		focus(component, "Desktop notifications");
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
	test("opens the editor on the only text row", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { price: { budget: 5 } } });

		focus(component, "Session budget");
		component.handleInput(" ");

		const text = component.render(80).join("\n");
		expect(text).toContain("5▏");
		expect(text).toContain("Esc cancel");
	});

	test("Enter opens the editor on the stored value and shows the editor keys", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { price: { budget: 5 } } });

		focus(component, "Session budget");
		component.handleInput("\r");

		const text = component.render(80).join("\n");
		expect(text).toContain("5▏");
		expect(text).toContain("Esc cancel");
		expect(text).not.toContain("Esc close");
	});

	test("typing and Enter store the value", async () => {
		const settings = makeSettings({ global: { price: { budget: 0 } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u0015");
		component.handleInput("5");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(settings.changes).toContain("global:price.budget=5");
		expect(component.render(80).join("\n")).toContain("Saved · reload to apply");
	});

	test("Esc cancels without writing", async () => {
		const settings = makeSettings({ global: { price: { budget: 0 } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("9");
		component.handleInput("\u001b");
		await settle();

		expect(settings.changes.filter((change) => change.includes("price.budget"))).toEqual([]);
		expect(component.render(80).join("\n")).not.toContain("9▏");
	});

	test("keeps the editor open when the runtime refuses the value", async () => {
		const base = makeSettings({ global: { price: { budget: 0 } } });
		const refusing: SettingsSurface = { ...base.surface, setValue: async () => false };
		const { component } = build({ items: [], section: "settings", settings: refusing });

		focus(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("9");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(component.render(80).join("\n")).toContain("9▏");
	});

	test("inserts at the caret and refuses characters past the limit", () => {
		const { component } = build({ items: [], section: "settings", globalDoc: { price: { budget: 12 } } });

		focus(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u001b[D");
		component.handleInput("3");
		expect(component.render(80).join("\n")).toContain("13▏2");

		component.handleInput("\u0005");
		for (let step = 0; step < 20; step += 1) component.handleInput("9");
		const text = component.render(80).join("\n");
		expect(text).toContain("132");
		expect(text).not.toContain("9".repeat(14));
	});

	test("strips bracketed-paste markers from a pasted value", async () => {
		const settings = makeSettings({ global: { price: { budget: 0 } } });
		const { component } = build({ items: [], section: "settings", settings: settings.surface });

		focus(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u0015");
		component.handleInput("\x1b[200~4.5\x1b[201~");

		const text = component.render(80).join("\n");
		expect(text).toContain("4.5▏");
		expect(text).not.toContain("[200~");

		component.handleInput("\r");
		await settle();
		await settle();
		expect(settings.changes).toContain("global:price.budget=4.5");
	});
});

describe("PanelComponent settings actions", () => {
	test("names the reset and JSON keys, and offers no group key on the flat list", () => {
		const { component } = build({ items: [], section: "settings" });

		const text = component.render(120).join("\n");
		expect(text).toContain("u reset");
		expect(text).toContain("J JSON");
		expect(text).toContain("↑/↓ select");
		expect(text).not.toContain("[ ]");
	});

	test("resets the focused row and marks the screen saved", async () => {
		const { component } = build({
			items: [],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focus(component, "Wake when a job finishes");
		component.handleInput("u");
		await settle();

		const text = component.render(80).join("\n");
		const row = text.split("\n").find((line) => line.includes("Wake when a job finishes"));
		expect(row?.trimEnd().endsWith("Off")).toBe(true);
		expect(text).toContain("Saved");
	});

	test("shows a failed reset in the frame instead of behind it", async () => {
		const surface: SettingsSurface = {
			views: (scope) => settingViews(snapshot(), scope),
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
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focus(component, "Wake when a job finishes");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain("job — ");
		expect(text).toContain('"wakeOnFinish": true');
		expect(text).toContain("J hide");

		component.handleInput("\t");
		const afterScope = component.render(80).join("\n");
		expect(afterScope).not.toContain('"wakeOnFinish": true');
	});

	test("does not reopen the JSON pane after the focus visits a Global-only row", () => {
		const { component } = build({
			items: [],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		focus(component, "Wake when a job finishes");
		component.handleInput("J");
		expect(component.render(80).join("\n")).toContain('"wakeOnFinish": true');

		component.handleInput("g");
		expect(component.render(80).join("\n")).not.toContain('"wakeOnFinish": true');
		focus(component, "Wake when a job finishes");
		expect(component.render(80).join("\n")).not.toContain('"wakeOnFinish": true');
	});

	test("explains that a Pi setting has no section to show", () => {
		const { component } = build({ items: [], section: "settings" });

		focus(component, "Bytefly startup TUI");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain("bytefly.json has no section");
		expect(text).not.toContain("J hide");
	});

	test("leaves the group keys inert on the flat Settings list", () => {
		const { component } = build({ items: [], section: "settings" });

		component.render(80);
		expect(selectedLine(component)).toContain("Bytefly startup TUI");

		component.handleInput("]");
		expect(selectedLine(component)).toContain("Bytefly startup TUI");
		component.handleInput("[");
		expect(selectedLine(component)).toContain("Bytefly startup TUI");

		component.handleInput("G");
		expect(selectedLine(component)).toContain("Session budget");
	});
});

describe("PanelComponent settings review", () => {
	test("keeps the focused setting across a scope switch", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			globalDoc: { notify: { enabled: true } },
		});

		focus(component, "Desktop notifications");
		component.handleInput("\t");
		expect(selectedLine(component)).toContain("Desktop notifications");
		component.handleInput("\t");
		expect(selectedLine(component)).toContain("Desktop notifications");
	});

	test("names the global file for an inherited row and calls a default a default", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			rows: 40,
			globalDoc: { job: { wakeOnFinish: true } },
		});

		component.handleInput("\t");
		focus(component, "Wake when a job finishes");
		let text = component.render(80).join("\n");
		expect(text).toContain(`Inherited from Global · ${join("/agent", "bytefly.json")}`);

		focus(component, "Wake on a match");
		text = component.render(80).join("\n");
		expect(text).toContain(`Default · ${join("/proj", ".pi", "bytefly.json")}`);
		expect(text).not.toContain("Inherited from Global");
	});

	test("names the scope file in the JSON pane, not the value origin", () => {
		const { component } = build({
			items: [packageItem("plan")],
			section: "settings",
			globalDoc: { job: { wakeOnFinish: true } },
		});

		component.handleInput("\t");
		focus(component, "Wake when a job finishes");
		component.handleInput("J");

		const text = component.render(80).join("\n");
		expect(text).toContain(`job — Project · ${join("/proj", ".pi", "bytefly.json")}`);
		expect(text).toContain("Not set in this scope.");
	});

	test("counts the settings it shows in the range row", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", rows: 12 });

		const global = component.render(80).join("\n");
		expect(global).toContain("showing");
		expect(global).toContain("of 14");

		component.handleInput("\t");
		expect(component.render(80).join("\n")).toContain("of 12");
	});

	test("ignores a click below the last body row", () => {
		const { component } = build({ items: [packageItem("plan")], section: "settings", rows: 12 });

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
		const { component } = build({ items: [], section: "settings", globalDoc: { price: { budget: 0 } } });

		focus(component, "Session budget");
		component.handleInput(" ");
		component.handleInput("1234567890");

		const line = component.render(30).find((candidate) => candidate.startsWith("❯")) ?? "";
		expect(line).toContain("Session");
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

describe("PanelComponent settings frame", () => {
	test("shows every curated setting and nothing that left the catalogue", () => {
		const { component } = build({ items: [], section: "settings" });
		const text = component.render(80).join("\n");

		for (const gone of ["Notification title", "Probe timeout", "Rail glyph", "Base ref", "Snapshots kept"]) {
			expect(text, gone).not.toContain(gone);
		}
		expect(text).toContain("Session budget");
	});

	test("fits all fourteen settings on a 24-row terminal with no range row", () => {
		const { component } = build({ items: [], section: "settings", rows: 24 });
		const lines = component.render(80);

		expect(lines).toHaveLength(24);
		expect(lines.join("\n")).not.toContain("showing");
		expect(lines.join("\n")).toContain("Session budget");
	});

	test("stays content-sized on a tall terminal", () => {
		const { component } = build({ items: [], section: "settings", rows: 40 });
		expect(component.render(80)).toHaveLength(24);
	});

	test("keeps a value beside its label on a wide terminal", () => {
		const { component } = build({ items: [], section: "settings" });
		const line = component.render(120).find((candidate) => candidate.includes("Turn finished")) ?? "";

		const labelAt = line.indexOf("Turn finished");
		const valueAt = line.indexOf("On");
		expect(labelAt).toBeGreaterThanOrEqual(0);
		expect(valueAt).toBeGreaterThan(labelAt);
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	test("spends three rows on the focused row's detail", () => {
		const { component } = build({ items: [], section: "settings", rows: 24 });
		const lines = component.render(80);
		const head = lines.findIndex((line) => line.includes("Bytefly startup TUI — Pi setting"));

		expect(head).toBeGreaterThan(0);
		expect(lines[head + 1]).toContain("Use bytefly's startup header");
		expect(lines[head + 2]).toContain("Default · ");
	});
});

describe("PanelComponent theme setting", () => {
	test("renders the Theme row and cycles the resolved names", async () => {
		const { component } = build({
			items: [],
			section: "settings",
			themes: ["system", "bytefly-dark", "bytefly-light"],
			app: { theme: "system" } as Settings,
		});

		focus(component, "Theme");
		expect(component.render(80).join("\n")).toContain("Theme");

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

const extensionItem = (path: string) => makeItem({ path });

function commandDiscovery() {
	return makeDiscovery({ global: [extensionItem("/agent/extensions/one.ts")] }).discovery;
}

/** A doctor runtime double that returns fixed reports and records refreshes. */
function fakeDoctor(reports: ExtensionReport[], refreshes: boolean[] = []): DoctorRuntime {
	return {
		configure: () => {},
		probeRequired: async () => reports,
		probeAll: async (options) => {
			refreshes.push(options?.refresh === true);
			return reports;
		},
		peek: () => reports,
		noteSearchFacts: () => {},
		reset: () => {},
	};
}

/** An update handle double that answers a fixed outcome and records re-checks. */
function fakeUpdate(outcome: UpdateOutcome = { kind: "current" }, checks: number[] = []) {
	return {
		recheck: async () => {
			checks.push(1);
			return outcome;
		},
	};
}

/** A Settings runtime double over an in-memory snapshot. */
function fakeSettings(options: { dirty?: boolean; snapshot?: SettingsSnapshot } = {}): SettingsRuntime {
	const state = options.snapshot ?? snapshot();
	let dirty = options.dirty ?? false;
	return {
		views: (scope) => settingViews(state, scope),
		change: async () => {
			dirty = true;
		},
		setValue: async () => {
			dirty = true;
			return true;
		},
		reset: async () => {
			dirty = true;
			return true;
		},
		sectionDocument: () => undefined,
		isDirty: () => dirty,
		onChange: () => () => {},
	};
}

function bootPanel(options: {
	discover?: () => Promise<ReturnType<typeof commandDiscovery>>;
	reports?: ExtensionReport[];
	settings?: (deps: SettingsRuntimeDeps) => SettingsRuntime;
	update?: { recheck: () => Promise<UpdateOutcome> };
}) {
	const { pi, commands } = makeFakePi();
	registerPanel(pi, {
		doctor: fakeDoctor(options.reports ?? []),
		update: options.update ?? fakeUpdate(),
		discover: options.discover ?? (async () => commandDiscovery()),
		settings: options.settings ?? (() => fakeSettings()),
	});
	return { pi, commands };
}

describe("bytefly panel command", () => {
	test("registers one /bytefly command", () => {
		const { commands } = bootPanel({});

		expect(commands.has("bytefly")).toBe(true);
		expect(commands.has("extensions")).toBe(false);
		expect(commands.has("doctor")).toBe(false);
	});

	test("completes the subcommands, extension names, and refresh", () => {
		const { commands } = bootPanel({});
		const labels = (prefix: string): string[] =>
			(commands.get("bytefly").getArgumentCompletions(prefix) ?? []).map((entry: { label: string }) => entry.label);

		const first = labels("");
		expect(first).toEqual(expect.arrayContaining(["doctor", "settings", "refresh", "plan"]));
		expect(first).not.toContain("header");
		expect(first).not.toContain("footer");
		expect(first).not.toContain("status");

		expect(labels("do")).toEqual(["doctor"]);
		expect(labels("file-")).toEqual(["file-browse", "file-read", "file-open"]);
		expect(commands.get("bytefly").getArgumentCompletions("do")?.[0]?.value).toBe("doctor ");
		expect(labels("doctor ")).toEqual(expect.arrayContaining(["plan", "refresh"]));
		expect(labels("doctor w")).toEqual(expect.arrayContaining(["web-access", "worktree"]));
		expect(commands.get("bytefly").getArgumentCompletions("doctor w")?.[0]?.value).toBe("doctor worktree");
		expect(labels("plan ")).toEqual(["refresh"]);
		expect(commands.get("bytefly").getArgumentCompletions("plan ")?.[0]?.value).toBe("plan refresh");
		expect(commands.get("bytefly").getArgumentCompletions("settings ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("refresh ")).toBeNull();
		expect(commands.get("bytefly").getArgumentCompletions("doctor plan extra")).toBeNull();
	});

	test("rejects an extension name after settings before discovery", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings plan", ctx);

		expect(notifications.at(-1)).toContain("settings takes no extension name");
		expect(notifications.at(-1)).toContain("plan");
	});
});

describe("bytefly panel modes", () => {
	test("prints the grouped listing outside TUI mode", async () => {
		const { commands } = bootPanel({ reports: [makeReport("plan")] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text).toContain("[x] one.ts");
		expect(text).toContain("plan");
	});

	test("prints the doctor report for /bytefly doctor outside TUI mode", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor", ctx);

		const text = notifications.at(-1) ?? "";
		expect(text).toContain("doctor:");
		expect(text).toContain("git: not found on PATH");
	});

	test("prints one extension's findings when narrowed", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
		expect(notifications.at(-1)).toContain("→ install git");
	});

	test("warns on an unknown extension name", async () => {
		const { commands } = bootPanel({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
	});

	test("accepts a report name that is absent from the current scope view", async () => {
		const report = makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")]);
		const { commands } = bootPanel({ reports: [report] });
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("plan", ctx);

		expect(notifications.at(-1)).toContain("git: not found on PATH");
	});

	test("prints the no-report message for a named item with no report", async () => {
		const { commands } = bootPanel({
			discover: async () => makeDiscovery({ global: [makeItem({ path: "/agent/extensions/one/index.ts" })] }).discovery,
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("one", ctx);

		expect(notifications.at(-1)).toContain("one/index.ts");
		expect(notifications.at(-1)).toContain("— no doctor report");
	});

	test("sanitizes the name in the unknown-extension warning", async () => {
		const { commands } = bootPanel({});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("bad\u001b[31m", ctx);

		expect(notifications.at(-1)).not.toContain("\u001b");
		expect(notifications.at(-1)).toContain('no extension named "bad');
	});

	test("reports a discovery failure instead of throwing", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("no settings");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not list extensions: no settings");
	});

	test("reports a probe failure instead of throwing", async () => {
		const { pi, commands } = makeFakePi();
		const doctor: DoctorRuntime = {
			...fakeDoctor([]),
			probeAll: async () => {
				throw new Error("probe exploded");
			},
		};
		registerPanel(pi, {
			doctor,
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(notifications.at(-1)).toContain("Could not probe extensions: probe exploded");
	});

	test("rejects an unknown name before probing the doctor", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("nope", ctx);

		expect(notifications.at(-1)).toContain('no extension named "nope"');
		expect(refreshes).toEqual([]);
	});

	test("prints the settings listing outside TUI mode without resolving extensions", async () => {
		const { commands } = bootPanel({
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
		});
		const { ctx, notifications } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("settings", ctx);

		expect(notifications.at(-1)).toContain("bytefly: Settings · Global · 14 settings");
		expect(notifications.at(-1)).toContain("Bytefly startup TUI: Off");
		expect(notifications.at(-1)).toContain("Delivery method: Auto");
		expect(notifications.at(-1)).toContain("Session budget: 0");
		expect(notifications.at(-1)).toContain("Theme: system");
	});

	test("offers only this package's themes to the settings runtime", async () => {
		let themes: readonly string[] | undefined;
		const { commands } = bootPanel({
			settings: (deps) => {
				themes = deps.themes;
				return fakeSettings();
			},
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });
		(ctx.ui as unknown as { getAllThemes: () => Array<{ name: string; path?: string }> }).getAllThemes = () => [
			{ name: "system" },
			{ name: "dark", path: "/pi/themes/dark.json" },
			{ name: "bytefly-dark", path: join(SHIPPED_THEMES_DIR, "bytefly-dark.json") },
			{ name: "mine", path: "/agent/themes/mine.json" },
			{ name: "bytefly-light", path: join(SHIPPED_THEMES_DIR, "bytefly-light.json") },
		];

		await commands.get("bytefly").handler("settings", ctx);

		expect(themes).toEqual(["bytefly-dark", "bytefly-light"]);
	});

	test("mounts the dock screen on the Settings section in TUI mode", async () => {
		const { commands } = bootPanel({});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);

		expect(rendered).toContain("Global · 14 settings");
		expect(rendered).toContain("Bytefly startup TUI");
	});

	test("mounts the dock screen once in TUI mode", async () => {
		const { commands } = bootPanel({});
		const { ctx, customCalls } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("", ctx);

		expect(customCalls).toHaveLength(1);
	});
});

describe("bytefly panel refresh", () => {
	test("re-probes when refresh is asked for", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("doctor refresh", ctx);
		await commands.get("bytefly").handler("plan refresh", ctx);

		expect(refreshes).toEqual([true, true]);
	});
});

describe("bytefly update command", () => {
	async function runUpdate(outcome: UpdateOutcome, mode = "print") {
		const checks: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(outcome, checks),
			discover: async () => {
				throw new Error("should not resolve extensions");
			},
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode, extra: { isProjectTrusted: () => true } });
		await commands.get("bytefly").handler("update", ctx);
		return { checks, notifications };
	}

	test("reports an available package list with its release URL, resolving nothing", async () => {
		const { checks, notifications } = await runUpdate({
			kind: "available",
			updates: [{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" }],
			ownLatest: "99.0.0",
		});

		expect(checks).toEqual([1]);
		expect(notifications.at(-1)).toContain("1 package update available");
		expect(notifications.at(-1)).toContain(`v${pkg.version} → v99.0.0`);
		expect(notifications.at(-1)).toContain("https://github.com/gavin-hu/my-pi-agent/releases/tag/v99.0.0");
	});

	test("reports an up-to-date session", async () => {
		const { notifications } = await runUpdate({ kind: "current" });
		expect(notifications.at(-1)).toContain("up to date");
	});

	test("reports a failed read as a warning", async () => {
		const { notifications } = await runUpdate({ kind: "failed" });
		expect(notifications.at(-1)).toContain("could not check package updates");
	});

	test("reports a skip when offline", async () => {
		const { notifications } = await runUpdate({ kind: "offline" });
		expect(notifications.at(-1)).toContain("PI_OFFLINE");
	});

	test("accepts a stray refresh token and re-checks once", async () => {
		const checks: number[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate({ kind: "current" }, checks),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "print", extra: { isProjectTrusted: () => true } });

		await commands.get("bytefly").handler("update refresh", ctx);

		expect(checks).toEqual([1]);
	});

	test("takes no second token and is offered first", () => {
		const { commands } = bootPanel({});

		expect(commands.get("bytefly").getArgumentCompletions("update ")).toBeNull();
		const first = (commands.get("bytefly").getArgumentCompletions("") ?? []).map(
			(entry: { label: string }) => entry.label,
		);
		expect(first).toContain("update");
	});
});

describe("bytefly panel probing", () => {
	test("mounts before probing and probes on the first Extensions view", async () => {
		const events: string[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: {
				...fakeDoctor([]),
				peek: () => undefined,
				probeAll: async () => {
					events.push("probe");
					return [];
				},
			},
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			events.push("mount");
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(events).toEqual(["mount", "probe"]);
	});

	test("opens Settings without probing, then probes on the Extensions view", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: { ...fakeDoctor([], refreshes), peek: () => undefined },
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);
		expect(refreshes).toEqual([]);

		component.handleInput("\u001b[D");
		expect(refreshes).toEqual([false]);
	});

	test("reuses the session cache without probing", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let rendered = "";
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			rendered = component.render(80).join("\n");
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(refreshes).toEqual([]);
		expect(rendered).toContain("plan");
		expect(rendered).toContain("ok");
	});

	test("keeps the screen open when the first probe fails", async () => {
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: {
				...fakeDoctor([]),
				peek: () => undefined,
				probeAll: async () => {
					throw new Error("probe exploded");
				},
			},
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			await settle();
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(component.render(80).join("\n")).toContain("Could not refresh: probe exploded");
		expect(notifications).toEqual([]);
	});

	test("shows a runtime toggle failure in the frame", async () => {
		const store = makeStore({ global: { extensions: [] } });
		store.failFlush(new Error("settings locked"));
		const built = makeDiscovery({ global: [extensionItem("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});
		const { ctx, notifications } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		let component: any;
		ctx.ui.custom = async (factory: any) => {
			component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);
		component.handleInput(" ");
		await settle();

		expect(component.render(80).join("\n")).toContain("settings locked");
		expect(notifications).toEqual([]);
	});

	test("forces the first probe when the command asked for refresh", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: { ...fakeDoctor([], refreshes), peek: () => undefined },
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("refresh", ctx);

		expect(refreshes).toEqual([true]);
	});

	test("re-probes a cached session when the command asked for refresh", async () => {
		const refreshes: boolean[] = [];
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([makeReport("plan")], refreshes),
			update: fakeUpdate(),
			discover: async () => commandDiscovery(),
			settings: () => fakeSettings(),
		});
		const { ctx } = fakeCtx({ mode: "tui", extra: { isProjectTrusted: () => true } });
		ctx.ui.custom = async (factory: any) => {
			factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			return undefined;
		};

		await commands.get("bytefly").handler("refresh", ctx);

		expect(refreshes).toEqual([true]);
	});
});

describe("bytefly panel reload", () => {
	test("offers a reload after a change and reloads when confirmed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [extensionItem("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});

		let reloaded = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.handleInput(" ");
			await settle();
			return undefined;
		};

		await commands.get("bytefly").handler("", ctx);

		expect(reloaded).toBe(1);
	});

	test("does not offer a reload when nothing changed", async () => {
		const store = makeStore({ global: { extensions: [] } });
		const built = makeDiscovery({ global: [extensionItem("/agent/extensions/one.ts")], globalStore: store }).discovery;
		const { pi, commands } = makeFakePi();
		registerPanel(pi, {
			doctor: fakeDoctor([]),
			update: fakeUpdate(),
			discover: async () => built,
			settings: () => fakeSettings(),
		});

		let confirmed = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			extra: { isProjectTrusted: () => true, reload: async () => {} },
		});
		ctx.ui.confirm = async () => {
			confirmed += 1;
			return false;
		};
		ctx.ui.custom = async () => undefined;

		await commands.get("bytefly").handler("doctor", ctx);

		expect(confirmed).toBe(0);
	});

	test("offers a reload when only a setting changed", async () => {
		const { commands } = bootPanel({ settings: () => fakeSettings({ dirty: true }) });

		let reloaded = 0;
		const { ctx } = fakeCtx({
			mode: "tui",
			confirm: true,
			extra: {
				isProjectTrusted: () => true,
				reload: async () => {
					reloaded += 1;
				},
			},
		});
		ctx.ui.custom = async (factory: any) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, fakeTheme, {}, () => {});
			component.handleInput("\u001b");
			return undefined;
		};

		await commands.get("bytefly").handler("settings", ctx);

		expect(reloaded).toBe(1);
	});
});
