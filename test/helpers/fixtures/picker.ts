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

/**
 * Extensions enabled by default in the maintainer's profile, used by tests to
 * model a realistic list where most rows are disabled. This is a test/doc
 * constant only; it does not change what Pi loads.
 */
export const DEFAULT_ENABLED_EXTENSIONS = ["bytefly", "plan", "todo", "goal", "question", "worktree", "job"] as const;

/** Every extension directory in this package, for default-profile tests. */
export const PACKAGE_EXTENSIONS = [
	"worktree",
	"rewind",
	"question",
	"todo",
	"goal",
	"plan",
	"subagent",
	"job",
	"web-access",
	"file-browse",
	"file-read",
	"file-open",
	"memory",
	"wechat",
	"bytefly",
] as const;

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
	packages(): PackageSource[];
	failFlush(error: Error): void;
}

export interface StoreOptions {
	global?: Settings;
	project?: Settings;
	packages?: PackageSource[];
	trusted?: boolean;
}

/** An in-memory `SettingsStore` recording every write. */
export function makeStore(options: StoreOptions = {}): FakeStore {
	let globalSettings: Settings = options.global ?? {};
	let projectSettings: Settings = options.project ?? {};
	let packageList: PackageSource[] = options.packages ?? [];
	let flushes = 0;
	let flushError: Error | undefined;

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
		packages: () => packageList,
		failFlush: (error) => {
			flushError = error;
		},
		store: {
			globalSettings: () => globalSettings,
			projectSettings: () => projectSettings,
			packages: () => packageList,
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
				packageList = packages;
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
				packageList = packages;
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
			drainErrors: () => [],
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
	const projectStore = options.projectStore ?? (trusted ? makeStore() : globalStore);
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
