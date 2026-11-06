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
	/** Fail the queued write the way Pi does: nothing reaches the file, nothing throws, and the reason comes back from `drainErrors()`. */
	recordError(error: Error, path?: string): void;
	/** Stop being able to read the file: `reload()` reports this from then on. */
	failRead(message: string, path?: string): void;
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
	/** Why the file cannot be read, as `reload()` reports it — from the start, until `failRead` changes it. */
	loadErrors?: string[];
	trusted?: boolean;
}

/** An in-memory `SettingsStore` recording every write, over two documents and the file each is saved to. */
export function makeStore(options: StoreOptions = {}): FakeStore {
	let globalSettings: Settings = { ...options.global, ...(options.packages ? { packages: options.packages } : {}) };
	let projectSettings: Settings = {
		...options.project,
		...(options.projectPackages ? { packages: options.projectPackages } : {}),
	};
	// What each file holds. The setters move the documents ahead of it, the way
	// Pi's do, and only a clean `flush()` puts them on disk — so a write that
	// failed leaves the documents showing a value the file never took.
	let globalFile: Settings = globalSettings;
	let projectFile: Settings = projectSettings;
	let recorded: Array<{ error: Error; path?: string }> = [];
	let pending: { error: Error; path?: string } | undefined;
	let readErrors: Array<{ error: Error; path?: string }> = (options.loadErrors ?? []).map((message) => ({
		error: new Error(message),
	}));
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
		failRead: (message, path) => {
			readErrors = [{ error: new Error(message), ...(path ? { path } : {}) }];
		},
		recordError: (error, path) => {
			pending = { error, ...(path ? { path } : {}) };
		},
		store: {
			globalSettings: () => globalSettings,
			projectSettings: () => projectSettings,
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
				if (pending) {
					recorded = [...recorded, pending];
					pending = undefined;
					return;
				}
				globalFile = globalSettings;
				projectFile = projectSettings;
			},
			reload: async () => {
				// Pi's two branches: a file it cannot read leaves its document alone and says
				// why, and a file it can read replaces the document with what it holds.
				if (readErrors.length > 0) return readErrors;
				globalSettings = globalFile;
				projectSettings = projectFile;
				return [];
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
