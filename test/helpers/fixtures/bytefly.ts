import type { MarkdownTransformer, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import type { PricedUsage, StatusSnapshot } from "../../../extensions/bytefly/footer/types.ts";
import bytefly from "../../../extensions/bytefly/index.ts";
import { createFakePi, fakeTheme, type AnyHandler } from "../fakes.ts";
import { withLeaf } from "../config.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { makeFinding, makeReport } from "../fixtures/doctor.ts";
import { type FakeStore, makeDiscovery, makeItem, makeStore, packageExtension } from "../fixtures/picker.ts";
import { registerPanel } from "../../../extensions/bytefly/panel/commands.ts";
import { buildPanelModel } from "../../../extensions/bytefly/panel/join.ts";
import { PanelComponent } from "../../../extensions/bytefly/panel/tui.ts";
import type { SkillInfo } from "../../../extensions/bytefly/panel/types.ts";
import type { ResourceItem, Settings, WriteScope } from "../../../extensions/bytefly/picker/types.ts";
import { createPickerRuntime } from "../../../extensions/bytefly/picker/runtime.ts";
import {
	nextValue,
	SETTING_ROWS,
	type SettingDescriptor,
	type SettingsSnapshot,
	settingViews,
	storedValue,
} from "../../../extensions/bytefly/panel/settings.ts";
import type {
	SettingsRuntime,
	SettingsRuntimeDeps,
	SettingsSurface,
} from "../../../extensions/bytefly/panel/settings-runtime.ts";
import type { DoctorRuntime } from "../../../extensions/bytefly/doctor/runtime.ts";
import type { UpdateHandle } from "../../../extensions/bytefly/update/register.ts";
import type { UpdateOutcome } from "../../../extensions/bytefly/update/state.ts";

export { emit, fakeTheme } from "../fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	renderers: Map<string, any>;
	messageRenderers: Map<string, any>;
	toolRenderers: ToolRendererResolver[];
	markdownTransformers: MarkdownTransformer[];
	appended: Array<{ customType: string; data?: unknown }>;
}

/** Minimal `ExtensionAPI` double covering what the bytefly extension uses. */
export function makeFakePi(options: { settings?: any } = {}): FakePi {
	const fake = createFakePi({ settings: options.settings });
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		handlers: fake.handlers,
		renderers: fake.renderers,
		messageRenderers: fake.messageRenderers,
		toolRenderers: fake.toolRenderers,
		markdownTransformers: fake.markdownTransformers,
		appended: fake.appended,
	};
}

/**
 * Update-check deps that make the check inert: offline, with an empty cache, so a
 * test that boots bytefly never reads npm and never writes the agent directory.
 */
export const OFFLINE_UPDATE = {
	fetchLatest: async () => undefined,
	readUpdates: async () => [],
	isOffline: () => true,
	cache: { read: () => undefined, write: () => {} },
	suppress: () => ({ check: async () => [], restore: () => {} }),
};

/** Boot bytefly over `deps`, with the update check inert. */
export function bootBytefly(pi: any, deps: Record<string, unknown> = {}): void {
	bytefly(pi, { update: OFFLINE_UPDATE, ...deps } as any);
}

export interface FakeCtxOptions {
	mode?: string;
	cwd?: string;
	home?: string;
	branch?: string | null;
	entries?: unknown[];
	statuses?: Array<[string, string]>;
	model?: any;
	thinkingLevel?: string | null;
	sessionName?: string;
	context?: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	providerCount?: number;
	leafId?: string;
	/** Whether the project is trusted; the panel command reads it. */
	trusted?: boolean;
}

export interface FakeFooterCtx {
	ctx: any;
	footerData: any;
	footers: any[];
	headers: any[];
	statuses: Map<string, string>;
	/** Messages passed to `ui.setWorkingMessage`, in order. */
	workingMessages: Array<string | undefined>;
}

/** Minimal `ExtensionContext` double for footer install tests. */
export function fakeFooterCtx(options: FakeCtxOptions = {}): FakeFooterCtx {
	const footers: any[] = [];
	const headers: any[] = [];
	const workingMessages: Array<string | undefined> = [];
	const statuses = new Map<string, string>(options.statuses ?? []);
	const cwd = options.cwd ?? "/home/u/repo/project";

	const footerData = {
		getGitBranch: () => (options.branch === undefined ? "main" : options.branch),
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => options.providerCount ?? 1,
		onBranchChange: () => () => {},
	};

	const ctx: any = {
		mode: options.mode ?? "tui",
		cwd,
		isProjectTrusted: () => options.trusted ?? true,
		model:
			options.model === undefined
				? { id: "opus-4.5", provider: "anthropic", contextWindow: 200000, reasoning: true }
				: options.model,
		thinkingLevel: options.thinkingLevel === undefined ? "high" : options.thinkingLevel,
		getContextUsage: () => options.context,
		sessionManager: {
			getEntries: () => options.entries ?? [],
			getBranch: () => options.entries ?? [],
			getSessionId: () => "sess",
			getLeafId: () => options.leafId ?? "leaf",
			getSessionName: () => options.sessionName,
			getCwd: () => cwd,
		},
		ui: {
			theme: fakeTheme,
			setFooter: (factory: any) => footers.push(factory),
			setHeader: (factory: any) => headers.push(factory),
			setWorkingMessage: (message?: string) => workingMessages.push(message),
			notify: () => {},
		},
	};

	return { ctx, footerData, footers, headers, statuses, workingMessages };
}

/** Render a footer factory into its two lines. */
export function renderFooter(factory: any, footerData: any, width = 100): string[] {
	const component = factory({ requestRender: () => {} }, fakeTheme, footerData);
	return component.render(width);
}

/** A separator entry as the store would return it. */
export function separatorEntry(turn: number): unknown {
	return { type: "custom", customType: "bytefly-separator", data: { turn } };
}

/**
 * The session totals a snapshot carries: zeroed, with what the pricer adds.
 *
 * A case that only cares about one number overrides it and gets the rest for free —
 * `unpriced` and `unpricedModels` are part of the shape, not an optional extra.
 */
export function usageOf(overrides: Partial<PricedUsage> = {}): PricedUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0, unpricedModels: [], ...overrides };
}

/** A snapshot with every field populated. */
export function fullSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
	return {
		cwd: "/home/u/repo/project",
		sessionName: null,
		branch: "main",
		statuses: new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
		]),
		model: { id: "opus-4.5", provider: "anthropic", reasoning: true },
		thinkingLevel: "high",
		context: { tokens: 124000, contextWindow: 200000, percent: 62 },
		usage: usageOf({ input: 42000, output: 8000, cacheRead: 96000, cost: 0.31 }),
		currency: { code: "USD", decimals: 2 },
		budget: 0,
		cacheHitRate: 87,
		providerCount: 1,
		delegation: { runs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } },
		...overrides,
	};
}

/**
 * The panel harness: the doubles and builders its capability suites share —
 * resource rows, the settings snapshot and its view, the `PanelComponent` and
 * `/bytefly` boots, and the doctor, update, and settings runtimes behind them.
 *
 * Teardown is not here: a suite that needs temp directories owns its `afterAll`,
 * because a `bun:test` hook is per file.
 */

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

export function settingsSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
	return {
		app: overrides.app ?? {},
		global: overrides.global ?? {},
		project: overrides.project ?? {},
		themes: overrides.themes ?? [],
	};
}

export function settingDescriptor(id: string): SettingDescriptor {
	const found = SETTING_ROWS.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing row ${id}`);
	return found;
}

export function settingView(snap: SettingsSnapshot, scope: WriteScope, id: string) {
	const found = settingViews(snap, scope).find((entry) => entry.id === id);
	if (!found) throw new Error(`missing view ${id}`);
	return found;
}

/** The `bytefly.json` document that states one row's leaf, for a read test. */
export function documentFor(row: SettingDescriptor, value: unknown): Record<string, unknown> {
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
export function fakeSettingsSurface(
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

/** A Settings runtime double over an in-memory snapshot. */
export function fakeSettings(options: { dirty?: boolean; snapshot?: SettingsSnapshot } = {}): SettingsRuntime {
	const state = options.snapshot ?? settingsSnapshot();
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

export function bootPanel(options: {
	discover?: () => Promise<ReturnType<typeof commandDiscovery>>;
	reports?: ExtensionReport[];
	settings?: (deps: SettingsRuntimeDeps) => SettingsRuntime;
	skills?: (paths: readonly string[], cwd: string, agentDir: string) => ReadonlyMap<string, SkillInfo>;
	update?: UpdateHandle;
}) {
	const { pi, commands } = makeFakePi();
	registerPanel(pi, {
		doctor: fakeDoctor(options.reports ?? []),
		update: options.update ?? fakeUpdate(),
		discover: options.discover ?? (async () => commandDiscovery()),
		settings: options.settings ?? (() => fakeSettings()),
		skills: options.skills,
	});
	return { pi, commands };
}
