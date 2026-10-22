/**
 * Stateful core of the resource picker, independent of rendering.
 *
 * Owns the active write scope and the live copies of both kinds' views,
 * computes toggles through the pure `toggle.ts` helpers, and persists them
 * through the scope's `SettingsStore`. The TUI subscribes with `onChange` and
 * reads `items(kind)` on every render, so it stays a derived view of this state.
 */

import { getDisplayName, getPackageResourcePattern, getResourcePattern } from "./resources.ts";
import {
	clearProjectPackages,
	clearProjectTopLevelList,
	nextGlobalPackages,
	nextProjectPackages,
	nextProjectTopLevelList,
	nextTopLevelList,
} from "./toggle.ts";
import type { Discovery, ResourceItem, ResourceKind, Settings, SettingsStore, WriteScope } from "./types.ts";

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
		store.setPackages(nextGlobalPackages(store.packages(), item.metadata.source, pattern, enabled, kind));
	};

	const persistProject = (kind: ResourceKind, item: ResourceItem, enabled: boolean): void => {
		const store = storeFor(discovery, "project");
		const ops = RESOURCE_OPS[kind];
		if (item.metadata.origin === "top-level") {
			const currentPaths = ops.read(store.projectSettings());
			ops.writeProject(store, nextProjectTopLevelList(currentPaths, item, enabled, cwd, agentDir));
			return;
		}
		store.setProjectPackages(nextProjectPackages(store.packages(), item, enabled, cwd, agentDir, kind));
	};

	/**
	 * Drop `item`'s project override, reporting whether anything was written. An
	 * absent override returns `false` without touching the store, so a stray key
	 * press cannot dirty the file.
	 */
	const clearFromStore = (kind: ResourceKind, item: ResourceItem): boolean => {
		const store = storeFor(discovery, "project");
		const ops = RESOURCE_OPS[kind];
		if (item.metadata.origin === "top-level") {
			const paths = ops.read(store.projectSettings());
			const next = clearProjectTopLevelList(paths, item, cwd, agentDir);
			if (next === paths) return false;
			ops.writeProject(store, next);
			return true;
		}
		const packages = store.packages();
		const next = clearProjectPackages(packages, item, cwd, agentDir, kind);
		if (next === packages) return false;
		store.setProjectPackages(next);
		return true;
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
			try {
				if (scope === "global") persistGlobal(kind, item, enabled);
				else persistProject(kind, item, enabled);
				const store = storeFor(discovery, scope);
				await store.flush();
				for (const error of store.drainErrors()) deps.onError?.(error.error.message);
			} catch (error) {
				deps.onError?.(error instanceof Error ? error.message : String(error));
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
			try {
				if (!clearFromStore(kind, item)) {
					deps.onError?.(`No project override for ${getDisplayName(item, kind)}.`);
					return;
				}
				await store.flush();
				for (const error of store.drainErrors()) deps.onError?.(error.error.message);
			} catch (error) {
				deps.onError?.(error instanceof Error ? error.message : String(error));
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
