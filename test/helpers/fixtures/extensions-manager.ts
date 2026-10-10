/**
 * Builders for the extensions-manager suite.
 *
 * `makeItem` produces a resolved extension resource; `makeStore` is an
 * in-memory `SettingsStore` that records writes; `makeDiscovery` pairs them
 * into the `Discovery` the runtime consumes. Value-only, no shared state.
 */

import type { PackageSource, PathMetadata } from "@earendil-works/pi-coding-agent";
import type { Discovery, ResourceItem, Settings, SettingsStore } from "../../../extensions/extensions-manager/types.ts";

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

export interface StoreCalls {
	setExtensionPaths: string[][];
	setPackages: PackageSource[][];
	setProjectExtensionPaths: string[][];
	setProjectPackages: PackageSource[][];
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
		setPackages: [],
		setProjectExtensionPaths: [],
		setProjectPackages: [],
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
			setPackages: (packages) => {
				calls.setPackages.push(packages);
				packageList = packages;
			},
			setProjectExtensionPaths: (paths) => {
				calls.setProjectExtensionPaths.push(paths);
				projectSettings = { ...projectSettings, extensions: paths };
			},
			setProjectPackages: (packages) => {
				calls.setProjectPackages.push(packages);
				packageList = packages;
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
	global?: ResourceItem[];
	effective?: ResourceItem[];
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
	const global = options.global ?? [];
	const effective = options.effective ?? global;
	return {
		discovery: {
			global,
			effective,
			stores: { global: globalStore.store, project: projectStore.store },
			trusted,
		},
		globalStore,
		projectStore,
	};
}
