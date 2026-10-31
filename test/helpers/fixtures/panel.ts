/**
 * Fixture for bytefly's panel suite: the doubles and builders its capability
 * suites share — resource rows, the model over them, the `PanelComponent` and
 * `/bytefly` boots, and the doctor and update runtimes behind the command.
 *
 * The settings surface and runtime live in `settings.ts`; a suite that drives a
 * settings section imports both.
 *
 * Teardown is not here: a suite that needs temp directories owns its `afterAll`,
 * because a `bun:test` hook is per file.
 */

import { registerPanel } from "../../../extensions/bytefly/panel/commands.ts";
import { buildPanelModel } from "../../../extensions/bytefly/panel/join.ts";
import type {
	SettingsRuntime,
	SettingsRuntimeDeps,
	SettingsSurface,
} from "../../../extensions/bytefly/panel/settings-runtime.ts";
import { PanelComponent } from "../../../extensions/bytefly/panel/tui.ts";
import type { SkillInfo } from "../../../extensions/bytefly/panel/types.ts";
import type { ResourceItem, Settings } from "../../../extensions/bytefly/picker/types.ts";
import { createPickerRuntime } from "../../../extensions/bytefly/picker/runtime.ts";
import type { DoctorRuntime } from "../../../extensions/bytefly/doctor/runtime.ts";
import type { UpdateHandle } from "../../../extensions/bytefly/update/register.ts";
import type { UpdateOutcome } from "../../../extensions/bytefly/update/state.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { fakeTheme } from "../fakes.ts";
import { makeByteflyPi } from "./boot.ts";
import { makeFinding, makeReport } from "./doctor.ts";
import { type FakeStore, makeDiscovery, makeItem, makeStore, packageExtension } from "./picker.ts";
import { fakeSettings, fakeSettingsSurface } from "./settings.ts";

export const enabledItem = (name: string, enabled = true): ResourceItem =>
	packageExtension(name, enabled) as ResourceItem;
export const pathRow = (path: string): ResourceItem => makeItem({ path });
export const userRow = (name: string, fileName = "index.ts"): ResourceItem =>
	makeItem({ path: `/home/me/.pi/extensions/${name}/${fileName}` });

export function textModel(
	items: ResourceItem[] = [enabledItem("plan"), enabledItem("todo"), enabledItem("memory", false)],
) {
	return buildPanelModel({
		items,
		reports: [makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")])],
		agentDir: "/agent",
	});
}

export function findRow(model: ReturnType<typeof textModel>, label: string) {
	const row = model.rows.find((candidate) => candidate.label === label);
	if (!row) throw new Error(`missing row ${label}`);
	return row;
}

/** Skill metadata keyed by the resolved path, as the loader hands it over. */
export function skillIndex(entries: Record<string, SkillInfo>): ReadonlyMap<string, SkillInfo> {
	return new Map(Object.entries(entries));
}

export const SKILLS_INDEX = () =>
	skillIndex({
		"/agent/skills/pdf/SKILL.md": {
			name: "pdf",
			description: "Extract text and tables from PDF files.",
			modelHidden: false,
		},
		"/agent/skills/quiet/SKILL.md": {
			name: "quiet",
			description: "Reachable by name only.",
			modelHidden: true,
		},
		"/agent/skills/broken/SKILL.md": {
			description: "",
			modelHidden: false,
			problem: "missing description",
		},
	});

type SkillLoader = () => ReadonlyMap<string, SkillInfo>;

export function buildPanel(options: {
	items: ResourceItem[];
	skills?: ResourceItem[];
	skillIndex?: SkillLoader;
	reports?: ExtensionReport[];
	trusted?: boolean;
	store?: FakeStore;
	rows?: number;
	theme?: unknown;
	filter?: string;
	section?: "extensions" | "skills" | "settings";
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
		extensions: options.items,
		skills: options.skills,
		globalStore: store,
		trusted: options.trusted ?? true,
	});
	// Mirrors the command: a runtime refusal or write failure lands in the frame.
	const holder: { component?: PanelComponent } = {};
	const runtime = createPickerRuntime({
		discovery,
		cwd: "/proj",
		agentDir: "/agent",
		onError: (message) => holder.component?.notify(message),
	});
	let closed = 0;
	const reports = options.reports ?? [];
	const settings =
		options.settings ??
		fakeSettingsSurface({
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
		skills: () => options.skillIndex?.() ?? new Map(),
		refresh: options.refresh ?? (() => {}),
		reload: () => {},
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
export function focusPanel(component: PanelComponent, label: string): void {
	component.render(80);
	for (let step = 0; step < 40; step += 1) {
		const line = component.render(80).find((candidate) => candidate.startsWith("❯"));
		if (line?.includes(label)) return;
		component.handleInput("j");
	}
	throw new Error(`never reached ${label}`);
}

export const selectedLine = (component: PanelComponent): string | undefined =>
	component.render(80).find((line) => line.startsWith("❯"));

export function commandDiscovery() {
	return makeDiscovery({ extensions: [pathRow("/agent/extensions/one.ts")] }).discovery;
}

/** A doctor runtime double that returns fixed reports and records refreshes. */
export function fakeDoctor(reports: ExtensionReport[], refreshes: boolean[] = []): DoctorRuntime {
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
export function fakeUpdate(outcome: UpdateOutcome = { kind: "current" }, checks: number[] = []) {
	return {
		recheck: async () => {
			checks.push(1);
			return outcome;
		},
		apply: async (): Promise<UpdateOutcome> => {
			checks.push(1);
			return { kind: "updated", pending: false };
		},
	};
}

export function bootPanel(options: {
	discover?: () => Promise<ReturnType<typeof commandDiscovery>>;
	reports?: ExtensionReport[];
	settings?: (deps: SettingsRuntimeDeps) => SettingsRuntime;
	skills?: (paths: readonly string[], cwd: string, agentDir: string) => ReadonlyMap<string, SkillInfo>;
	update?: UpdateHandle;
}) {
	const { pi, commands } = makeByteflyPi();
	registerPanel(pi, {
		doctor: fakeDoctor(options.reports ?? []),
		update: options.update ?? fakeUpdate(),
		discover: options.discover ?? (async () => commandDiscovery()),
		settings: options.settings ?? (() => fakeSettings()),
		skills: options.skills,
	});
	return { pi, commands };
}
