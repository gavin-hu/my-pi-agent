/**
 * Builders for the bytefly resource-picker suite.
 *
 * `makeItem` and `skillItem` produce a resolved resource; `makeStore` is an
 * in-memory `SettingsStore` that records writes; `makeDiscovery` pairs them
 * into the `Discovery` the runtime consumes. Value-only, no shared state.
 */

import type { PackageSource, PathMetadata, QuietStartup } from "@earendil-works/pi-coding-agent";
import type { Discovery, ResourceItem, Settings, SettingsStore } from "../../../extensions/bytefly/picker/types.ts";

export interface ItemOverrides {
	path?: string;
	enabled?: boolean;
	metadata?: Partial<PathMetadata>;
}

/** A resolved extension resource with sensible defaults. */
export function makeItem(overrides: ItemOverrides = {}): ResourceItem {
	const { path = "/agent/extensions/hello.ts", enabled = true, metadata } = overrides;
	return {
		path,
		enabled,
		metadata: { source: "auto", scope: "user", origin: "top-level", ...metadata },
	};
}

/** A resolved user skill: the `SKILL.md` Pi resolves for `~/.pi/agent/skills/<name>`. */
export function skillItem(name: string, enabled = true): ResourceItem {
	return makeItem({ path: `/agent/skills/${name}/SKILL.md`, enabled });
}

/** A skill this package ships: the `SKILL.md` Pi resolves from its `skills/<name>/`. */
export function packageSkill(name: string, enabled = true): ResourceItem {
	return makeItem({
		path: `/pkg/skills/${name}/SKILL.md`,
		enabled,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg" },
	});
}

/** A package extension item for an extension directory name. */
export function packageExtension(name: string, enabled: boolean): ResourceItem {
	return makeItem({
		path: `/pkg/extensions/${name}/index.ts`,
		enabled,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});
}

export interface StoreCalls {
	setExtensionPaths: string[][];
	setSkillPaths: string[][];
	setPackages: PackageSource[][];
	setProjectExtensionPaths: string[][];
	setProjectSkillPaths: string[][];
	setProjectPackages: PackageSource[][];
	setQuietStartup: QuietStartup[];
	setTheme: string[];
}

export interface FakeStore {
	store: SettingsStore;
	calls: StoreCalls;
	flushCount(): number;
	global(): Settings;
	project(): Settings;
	/** The merged list Pi's `getPackages()` reads: the project document if it sets one. */
	packages(): PackageSource[];
	failFlush(error: Error): void;
	/** Record a write failure the way Pi does — on `drainErrors()`, not by throwing. */
	recordError(error: Error, path?: string): void;
}

export interface StoreOptions {
	/** The personal document, as `~/.pi/agent/settings.json` holds it. */
	global?: Settings;
	/** The project document, as `.pi/settings.json` holds it. */
	project?: Settings;
	/** The personal document's `packages`, written into `global` under its own key. */
	packages?: PackageSource[];
	/** The project document's own `packages`; absent leaves the key unset. */
	projectPackages?: PackageSource[];
	/** Why the file could not be read, as `loadErrors()` reports it. */
	loadErrors?: string[];
	trusted?: boolean;
}

/** An in-memory `SettingsStore` recording every write, over two documents. */
export function makeStore(options: StoreOptions = {}): FakeStore {
	let globalSettings: Settings = { ...options.global, ...(options.packages ? { packages: options.packages } : {}) };
	let projectSettings: Settings = {
		...options.project,
		...(options.projectPackages ? { packages: options.projectPackages } : {}),
	};
	let recorded: Array<{ error: Error; path?: string }> = [];
	const loadErrors = options.loadErrors ?? [];
	let flushes = 0;
	let flushError: Error | undefined;

	/** What Pi's merged settings document holds under `packages`, which replaces wholesale. */
	const mergedPackages = (): PackageSource[] => projectSettings.packages ?? globalSettings.packages ?? [];

	const calls: StoreCalls = {
		setExtensionPaths: [],
		setSkillPaths: [],
		setPackages: [],
		setProjectExtensionPaths: [],
		setProjectSkillPaths: [],
		setProjectPackages: [],
		setQuietStartup: [],
		setTheme: [],
	};

	const fake: FakeStore = {
		calls,
		flushCount: () => flushes,
		global: () => globalSettings,
		project: () => projectSettings,
		packages: () => mergedPackages(),
		failFlush: (error) => {
			flushError = error;
		},
		recordError: (error, path) => {
			recorded = [...recorded, { error, ...(path ? { path } : {}) }];
		},
		store: {
			globalSettings: () => globalSettings,
			projectSettings: () => projectSettings,
			packages: () => mergedPackages(),
			loadErrors: () => loadErrors.map((message) => ({ error: new Error(message) })),
			setExtensionPaths: (paths) => {
				calls.setExtensionPaths.push(paths);
				globalSettings = { ...globalSettings, extensions: paths };
			},
			setSkillPaths: (paths) => {
				calls.setSkillPaths.push(paths);
				globalSettings = { ...globalSettings, skills: paths };
			},
			setPackages: (packages) => {
				calls.setPackages.push(packages);
				globalSettings = { ...globalSettings, packages };
			},
			setProjectExtensionPaths: (paths) => {
				calls.setProjectExtensionPaths.push(paths);
				projectSettings = { ...projectSettings, extensions: paths };
			},
			setProjectSkillPaths: (paths) => {
				calls.setProjectSkillPaths.push(paths);
				projectSettings = { ...projectSettings, skills: paths };
			},
			setProjectPackages: (packages) => {
				calls.setProjectPackages.push(packages);
				projectSettings = { ...projectSettings, packages };
			},
			setQuietStartup: (quiet) => {
				calls.setQuietStartup.push(quiet);
				globalSettings = { ...globalSettings, quietStartup: quiet };
			},
			setTheme: (theme) => {
				calls.setTheme.push(theme);
				globalSettings = { ...globalSettings, theme };
			},
			isProjectTrusted: () => options.trusted ?? true,
			flush: async () => {
				flushes += 1;
				if (flushError) throw flushError;
			},
			drainErrors: () => {
				const drained = recorded;
				recorded = [];
				return drained;
			},
		},
	};
	return fake;
}

export interface DiscoveryOptions {
	extensions?: ResourceItem[];
	effectiveExtensions?: ResourceItem[];
	skills?: ResourceItem[];
	effectiveSkills?: ResourceItem[];
	globalStore?: FakeStore;
	projectStore?: FakeStore;
	trusted?: boolean;
}

/** A `Discovery` plus the stores behind it, for assertions. */
export function makeDiscovery(options: DiscoveryOptions = {}): {
	discovery: Discovery;
	globalStore: FakeStore;
	projectStore: FakeStore;
} {
	const trusted = options.trusted ?? true;
	const globalStore = options.globalStore ?? makeStore();
	// The project view reads one merged document, so its store starts from the personal
	// one, exactly as Pi's `SettingsManager` melds the two files.
	const projectStore = options.projectStore ?? (trusted ? makeStore({ global: globalStore.global() }) : globalStore);
	const extensions = options.extensions ?? [];
	const effectiveExtensions = options.effectiveExtensions ?? extensions;
	const skills = options.skills ?? [];
	const effectiveSkills = options.effectiveSkills ?? skills;
	return {
		discovery: {
			extensions: { global: extensions, effective: effectiveExtensions },
			skills: { global: skills, effective: effectiveSkills },
			stores: { global: globalStore.store, project: projectStore.store },
			trusted,
		},
		globalStore,
		projectStore,
	};
}
