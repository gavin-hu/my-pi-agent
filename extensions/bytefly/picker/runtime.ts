/**
 * Stateful core of the resource picker, independent of rendering.
 *
 * Owns the active write scope and the live copies of both kinds' views,
 * computes toggles through the pure `toggle.ts` helpers, and persists them
 * through the scope's `SettingsStore`. The TUI subscribes with `onChange` and
 * reads `items(kind)` on every render, so it stays a derived view of this state.
 */

import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { getDisplayName, getPackageResourcePattern, getResourcePattern } from "./resources.ts";
import {
	clearProjectPackages,
	clearProjectTopLevelList,
	nextGlobalPackages,
	nextProjectPackages,
	nextProjectTopLevelList,
	nextTopLevelList,
} from "./toggle.ts";
import type {
	Discovery,
	ResourceItem,
	ResourceKind,
	Settings,
	SettingsFailure,
	SettingsStore,
	WriteScope,
} from "./types.ts";

export interface RuntimeDeps {
	discovery: Discovery;
	cwd: string;
	agentDir: string;
	onError?: (message: string) => void;
}

export interface PickerRuntime {
	scope(): WriteScope;
	setScope(scope: WriteScope): void;
	items(kind: ResourceKind): ResourceItem[];
	disabledCount(kind: ResourceKind): number;
	projectAvailable(): boolean;
	isDirty(): boolean;
	toggle(kind: ResourceKind, item: ResourceItem): Promise<void>;
	/** Drop `item`'s project override in Project scope; a no-op when it has none. */
	clearOverride(kind: ResourceKind, item: ResourceItem): Promise<void>;
	onChange(listener: () => void): () => void;
}

/** The store a scope writes through. */
function storeFor(discovery: Discovery, scope: WriteScope): SettingsStore {
	return scope === "global" ? discovery.stores.global : discovery.stores.project;
}

/** Whether two rows name the same resource, for an inherited-state lookup. */
function sameResource(left: ResourceItem, right: ResourceItem): boolean {
	return left.metadata.source === right.metadata.source && left.path === right.path;
}

/**
 * The package list one document holds, which is what a toggle in that scope edits.
 *
 * Pi's `getPackages()` reads the merged document instead, and a project file that
 * sets no `packages` key reads as the personal list — so a project write starting
 * from it would copy every personal entry into a file people commit.
 */
function packagesIn(store: SettingsStore, scope: WriteScope): PackageSource[] {
	const settings = scope === "global" ? store.globalSettings() : store.projectSettings();
	return settings.packages ?? [];
}

/** A store failure as one line, naming the file it was about when the store knows it. */
function describeFailure(failure: SettingsFailure): string {
	return failure.path ? `${failure.path}: ${failure.error.message}` : failure.error.message;
}

/** How one resource kind is stored: its settings list and the writers beside it. */
interface ResourceOps {
	read(settings: Settings): string[];
	write(store: SettingsStore, paths: string[]): void;
	writeProject(store: SettingsStore, paths: string[]): void;
}

/** The two settings keys the picker toggles, and their setters. */
const RESOURCE_OPS: Record<ResourceKind, ResourceOps> = {
	extensions: {
		read: (settings) => settings.extensions ?? [],
		write: (store, paths) => store.setExtensionPaths(paths),
		writeProject: (store, paths) => store.setProjectExtensionPaths(paths),
	},
	skills: {
		read: (settings) => settings.skills ?? [],
		write: (store, paths) => store.setSkillPaths(paths),
		writeProject: (store, paths) => store.setProjectSkillPaths(paths),
	},
};

/** A fresh copy of one list, so a toggle mutates this runtime's view. */
function copies(items: readonly ResourceItem[]): ResourceItem[] {
	return items.map((item) => ({ ...item }));
}

export function createPickerRuntime(deps: RuntimeDeps): PickerRuntime {
	const { discovery, cwd, agentDir } = deps;
	let scope: WriteScope = "global";
	let dirty = false;
	const listeners = new Set<() => void>();
	const views: Record<WriteScope, Record<ResourceKind, ResourceItem[]>> = {
		global: { extensions: copies(discovery.extensions.global), skills: copies(discovery.skills.global) },
		project: { extensions: copies(discovery.extensions.effective), skills: copies(discovery.skills.effective) },
	};

	const current = (kind: ResourceKind): ResourceItem[] => views[scope][kind];

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	const persistGlobal = (kind: ResourceKind, item: ResourceItem, enabled: boolean): void => {
		const store = storeFor(discovery, "global");
		const ops = RESOURCE_OPS[kind];
		if (item.metadata.origin === "top-level") {
			const pattern = getResourcePattern(item, cwd, agentDir);
			ops.write(store, nextTopLevelList(ops.read(store.globalSettings()), pattern, enabled));
			return;
		}
		const pattern = getPackageResourcePattern(item);
		store.setPackages(nextGlobalPackages(packagesIn(store, "global"), item.metadata.source, pattern, enabled, kind));
	};

	const persistProject = (kind: ResourceKind, item: ResourceItem, enabled: boolean): void => {
		const store = storeFor(discovery, "project");
		const ops = RESOURCE_OPS[kind];
		if (item.metadata.origin === "top-level") {
			const currentPaths = ops.read(store.projectSettings());
			ops.writeProject(store, nextProjectTopLevelList(currentPaths, item, enabled, cwd, agentDir));
			return;
		}
		store.setProjectPackages(nextProjectPackages(packagesIn(store, "project"), item, enabled, cwd, agentDir, kind));
	};

	/**
	 * The write that drops `item`'s project override, or `undefined` when it has none:
	 * an absent override must not dirty the file on a stray key press.
	 */
	const overrideWrite = (kind: ResourceKind, item: ResourceItem): (() => void) | undefined => {
		const store = storeFor(discovery, "project");
		const ops = RESOURCE_OPS[kind];
		if (item.metadata.origin === "top-level") {
			const paths = ops.read(store.projectSettings());
			const next = clearProjectTopLevelList(paths, item, cwd, agentDir);
			return next === paths ? undefined : () => ops.writeProject(store, next);
		}
		const packages = packagesIn(store, "project");
		const next = clearProjectPackages(packages, item, cwd, agentDir, kind);
		return next === packages ? undefined : () => store.setProjectPackages(next);
	};

	/**
	 * Write through `store`, and say why the write did not land.
	 *
	 * `flush()` never rejects — Pi records a failed write on `drainErrors()` — so the
	 * only proof a write landed is that nothing comes back from it. A file that could not be read is refused before the store is touched, because
	 * Pi would take the write in memory and then drop it on the way to the file.
	 */
	const land = async (store: SettingsStore, write: () => void): Promise<string | undefined> => {
		const unreadable = store.loadErrors()[0];
		if (unreadable !== undefined) return describeFailure(unreadable);
		try {
			write();
			await store.flush();
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		const rejected = store.drainErrors()[0];
		return rejected === undefined ? undefined : describeFailure(rejected);
	};

	return {
		scope: () => scope,
		setScope: (next) => {
			if (next === "project" && !discovery.trusted) return;
			if (next === scope) return;
			scope = next;
			emit();
		},
		items: current,
		disabledCount: (kind) => current(kind).filter((item) => !item.enabled).length,
		projectAvailable: () => discovery.trusted,
		isDirty: () => dirty,
		toggle: async (kind, item) => {
			const enabled = !item.enabled;
			const store = storeFor(discovery, scope);
			const failure = await land(store, () => {
				if (scope === "global") persistGlobal(kind, item, enabled);
				else persistProject(kind, item, enabled);
			});
			if (failure !== undefined) {
				deps.onError?.(failure);
				return;
			}
			item.enabled = enabled;
			dirty = true;
			emit();
		},
		clearOverride: async (kind, item) => {
			if (scope !== "project") {
				deps.onError?.("Overrides are cleared in Project scope; switch with Tab.");
				return;
			}
			const store = storeFor(discovery, "project");
			const write = overrideWrite(kind, item);
			if (write === undefined) {
				deps.onError?.(`No project override for ${getDisplayName(item, kind)}.`);
				return;
			}
			const failure = await land(store, write);
			if (failure !== undefined) {
				deps.onError?.(failure);
				return;
			}
			// With the override gone the row shows the inherited state again; a
			// project-only resource has no global twin and keeps its value.
			const inherited = views.global[kind].find((entry) => sameResource(entry, item));
			if (inherited) item.enabled = inherited.enabled;
			dirty = true;
			emit();
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
